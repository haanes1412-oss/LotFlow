import { normalizeItem, itemSimilarity } from "./pricing-engine.js";
import { profileFromSettings } from "./profile-config.js";
import { activeMarketPrice, coherentPriceCluster, diversifyCandidates, isPlaceholderPrice, median } from "./market-estimator.js";

const SOLD_STATES = new Set(["sold", "paid", "closed", "closed_inactive"]);
const ESTIMATORS = ["lowerQuartile", "lowest", "median", "weightedMedian"];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function quantile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * clamp(ratio, 0, 1);
  const lower = Math.floor(position); const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function validMarketItem(item, excludedPrices) {
  return item.price > 0 && !excludedPrices.has(item.price) && !isPlaceholderPrice(item.price);
}

function numericTolerance(field, items) {
  const values = items.map(item => Number(item.attributes?.[field])).filter(Number.isFinite).sort((left, right) => left - right);
  if (!values.length) return { tolerancePercent: 35, toleranceAbsolute: 1 };
  const lower = quantile(values, .25); const upper = quantile(values, .75); const center = quantile(values, .5) || 0;
  const distinct = [...new Set(values)];
  const steps = distinct.slice(1).map((value, index) => value - distinct[index]).filter(value => value > 0);
  const minimumStep = steps.length ? Math.max(1, quantile(steps, .25)) : 1;
  const absolute = Math.max(minimumStep, Math.round(Math.max(0, upper - lower) * .15));
  return {
    tolerancePercent: center < 10 ? 35 : center < 100 ? 30 : 25,
    toleranceAbsolute: Math.max(1, absolute)
  };
}

function selectedRule(entry, baseRule, allItems) {
  const suggested = entry.suggestedRule ?? {};
  const mode = suggested.mode === "ignore" ? baseRule?.mode ?? "ignore" : suggested.mode;
  const score = clamp((entry.priceSignal ?? 0) * .65 + Math.min(entry.targetCoverage ?? 0, entry.marketCoverage ?? 0) * .35, 0, 1);
  const weight = Math.round(clamp(Math.max(Number(baseRule?.weight) || 0, 1 + score * 4), .6, 5) * 10) / 10;
  const highCoverage = (entry.targetCoverage ?? 0) >= .8 && (entry.marketCoverage ?? 0) >= .75;
  const structuralExact = mode === "exact" && (
    baseRule?.missing === "reject"
    || entry.field === "origin"
    || ((entry.priceSignal ?? 0) >= .28 && entry.distinctValues >= 2 && entry.distinctValues <= 12 && highCoverage)
  );
  // An automatic profile may use dozens of useful API characteristics, but
  // numeric distance and list overlap must rank neighbours instead of deleting
  // the whole market. Only a validated structural split remains a hard gate.
  const required = mode === "exact" && structuralExact;
  const rule = {
    label: baseRule?.label ?? entry.label ?? entry.field.replaceAll("_", " "),
    mode,
    weight,
    missing: required && highCoverage ? "reject" : highCoverage ? "penalize" : "ignore",
    required,
    search: suggested.search === true,
    tolerancePercent: Number(suggested.tolerancePercent) || 0,
    toleranceAbsolute: Number(suggested.toleranceAbsolute) || 0,
    ...(suggested.buckets?.length ? { buckets: suggested.buckets } : {})
  };
  if (mode === "range") Object.assign(rule, numericTolerance(entry.field, allItems));
  return rule;
}

function numericSeries(field, items) {
  return items.map(item => {
    const value = item.attributes?.[field];
    return Array.isArray(value) ? value.length : Number(value);
  });
}

function numericCorrelation(leftField, rightField, items) {
  const left = numericSeries(leftField, items); const right = numericSeries(rightField, items);
  const pairs = left.map((value, index) => [value, right[index]]).filter(pair => pair.every(Number.isFinite));
  if (pairs.length < 10) return 0;
  const transformed = pairs.map(([a, b]) => [Math.log1p(Math.max(0, a)), Math.log1p(Math.max(0, b))]);
  const leftMean = transformed.reduce((sum, pair) => sum + pair[0], 0) / transformed.length;
  const rightMean = transformed.reduce((sum, pair) => sum + pair[1], 0) / transformed.length;
  let numerator = 0; let leftVariance = 0; let rightVariance = 0;
  for (const [a, b] of transformed) {
    numerator += (a - leftMean) * (b - rightMean);
    leftVariance += (a - leftMean) ** 2; rightVariance += (b - rightMean) ** 2;
  }
  return leftVariance && rightVariance ? Math.abs(numerator / Math.sqrt(leftVariance * rightVariance)) : 0;
}

function chooseFields(category, targets, market, catalog, base) {
  const allItems = [...targets, ...market];
  const candidates = catalog.map(entry => {
    const baseRule = base.fields?.[entry.field];
    const baseEnabled = baseRule && baseRule.mode !== "ignore" && Number(baseRule.weight) > 0;
    const coverage = Math.min(entry.targetCoverage ?? 0, entry.marketCoverage ?? 0);
    const exactDiscriminator = entry.suggestedRule?.mode === "exact" && entry.distinctValues >= 2 && entry.distinctValues <= 16;
    const predictive = Number(entry.priceSignal) >= (exactDiscriminator ? .06 : .1);
    const canonical = baseEnabled || ["origin", "region", "email_access"].includes(entry.field);
    const usable = entry.autoEligible && coverage >= .2 && entry.suggestedRule?.mode !== "ignore" && (predictive || canonical);
    const score = (entry.priceSignal ?? 0) * .65 + coverage * .25 + (entry.apiFilter ? .05 : 0) + (entry.source === "known" ? .05 : 0) + (exactDiscriminator ? .05 : 0);
    const typePriority = entry.type === "number" ? .04 : entry.type === "boolean" || entry.type === "text" ? .02 : 0;
    const priority = score + Math.min(5, Number(baseRule?.weight) || 0) * .12 + typePriority;
    return { entry, baseRule, baseEnabled, usable, score, priority };
  });
  const ordered = candidates
    .filter(candidate => candidate.usable)
    .sort((left, right) => Number(right.baseEnabled) - Number(left.baseEnabled) || right.priority - left.priority);
  const selected = [];
  for (const candidate of ordered) {
    if (selected.length >= 8) break;
    const quantitative = new Set(["number", "list"]);
    const redundant = quantitative.has(candidate.entry.type) && selected.some(existing =>
      quantitative.has(existing.entry.type) && numericCorrelation(candidate.entry.field, existing.entry.field, allItems) >= .96
    );
    if (!redundant) selected.push(candidate);
  }
  const fields = {};
  for (const candidate of selected) fields[candidate.entry.field] = selectedRule(candidate.entry, candidate.baseRule, allItems);
  if (!Object.keys(fields).length && base.fields?.origin) fields.origin = { ...base.fields.origin };
  return {
    fields,
    report: selected.map(candidate => ({
      field: candidate.entry.field,
      label: candidate.entry.label,
      mode: fields[candidate.entry.field].mode,
      required: fields[candidate.entry.field].required === true,
      weight: fields[candidate.entry.field].weight,
      priceSignal: Number(candidate.entry.priceSignal) || 0,
      coverage: Math.min(candidate.entry.targetCoverage ?? 0, candidate.entry.marketCoverage ?? 0),
      apiFilter: candidate.entry.apiFilter === true
    }))
  };
}

function evenlySpacedSample(items, maximum = 80) {
  const sorted = [...items].sort((left, right) => left.price - right.price || left.id.localeCompare(right.id));
  if (sorted.length <= maximum) return sorted;
  return Array.from({ length: maximum }, (_, index) => sorted[Math.floor(index * (sorted.length - 1) / (maximum - 1))]);
}

function candidateRows(sample, market, profile) {
  return sample.map(target => {
    const candidates = [];
    for (const candidate of market) {
      if (candidate.id === target.id) continue;
      if (target.sellerId && candidate.sellerId && target.sellerId === candidate.sellerId) continue;
      const similarity = itemSimilarity(target, candidate, profile);
      if (!similarity.rejected && similarity.score >= .32) candidates.push({ ...candidate, similarity });
    }
    candidates.sort((left, right) => right.similarity.score - left.similarity.score);
    return { target, candidates };
  });
}

function estimateRow(row, estimator, threshold, window, profile) {
  if (!row.candidates.length) return null;
  const best = row.candidates[0].similarity.score;
  const tier = row.candidates.filter(candidate => candidate.similarity.score >= Math.max(threshold, best - window));
  const diversified = diversifyCandidates(tier).candidates;
  const cluster = coherentPriceCluster(diversified, profile.priceOutlierRatio);
  if (cluster.keptSide === "conflict") return null;
  const evidence = cluster.candidates.slice(0, profile.maxAnalogs);
  if (evidence.length < profile.minAnalogs) return null;
  return activeMarketPrice(evidence, estimator);
}

function calibrationCandidate(rows, estimator, threshold, window, profile) {
  const losses = []; let overPredictions = 0;
  for (const row of rows) {
    const prediction = estimateRow(row, estimator, threshold, window, profile);
    if (!(prediction > 0)) continue;
    const difference = Math.log(prediction / row.target.price);
    if (difference > 0) overPredictions += 1;
    losses.push(Math.abs(difference) + Math.max(0, difference) * .8);
  }
  const coverage = rows.length ? losses.length / rows.length : 0;
  const medianError = median(losses) ?? 10;
  const p75Error = quantile(losses, .75) ?? 10;
  const overRate = losses.length ? overPredictions / losses.length : 1;
  return {
    estimator, threshold, window, predictions: losses.length, coverage, medianError, p75Error, overRate,
    score: medianError + p75Error * .3 + (1 - coverage) * .85 + overRate * .2
  };
}

function calibrate(category, market, profile) {
  const active = market.filter(item => !SOLD_STATES.has(String(item.state).toLowerCase()));
  const sample = evenlySpacedSample(active);
  if (sample.length < 6) return {
    status: "unavailable", sampleSize: sample.length, predictions: 0, coverage: 0,
    medianError: 2, p75Error: 3, confidenceFactor: .35, estimator: "lowerQuartile"
  };
  const rows = candidateRows(sample, active, profile);
  const thresholds = [...new Set([.4, .5, .58, .66, Number(profile.minSimilarity)].map(value => Math.round(clamp(value, .3, .8) * 100) / 100))];
  const windows = [...new Set([.08, .14, .22, Number(profile.similarityWindow)].map(value => Math.round(clamp(value, .04, .35) * 100) / 100))];
  const trials = [];
  for (const estimator of ESTIMATORS) for (const threshold of thresholds) for (const window of windows) {
    trials.push(calibrationCandidate(rows, estimator, threshold, window, profile));
  }
  const viable = trials.filter(trial => trial.predictions >= Math.max(5, Math.ceil(sample.length * .2)));
  const best = (viable.length ? viable : trials).sort((left, right) => left.score - right.score)[0];
  const reliable = best.predictions >= 10
    && best.coverage >= .4
    && best.medianError <= .42
    && best.p75Error <= .75
    && best.overRate <= .7;
  const confidenceFactor = clamp(.3 + best.coverage * .3 + (1 - Math.min(1, best.medianError / .9)) * .4, .35, .95);
  return {
    status: reliable ? "reliable" : best.predictions >= 5 ? "limited" : "unavailable",
    sampleSize: sample.length,
    predictions: best.predictions,
    coverage: Math.round(best.coverage * 1_000) / 1_000,
    medianError: Math.round(best.medianError * 1_000) / 1_000,
    p75Error: Math.round(best.p75Error * 1_000) / 1_000,
    overRate: Math.round(best.overRate * 1_000) / 1_000,
    confidenceFactor: Math.round(confidenceFactor * 1_000) / 1_000,
    estimator: best.estimator,
    threshold: best.threshold,
    window: best.window,
    validationScore: Math.round(best.score * 1_000) / 1_000,
    category
  };
}

function calibrationRank(calibration) {
  const status = { reliable: 0, limited: 1, unavailable: 2 }[calibration.status] ?? 3;
  return [status, Number(calibration.validationScore) || 99, -(Number(calibration.predictions) || 0)];
}

function compareRank(left, right) {
  const a = calibrationRank(left); const b = calibrationRank(right);
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function profileVariants(draft, selection) {
  const entries = Object.entries(draft.fields);
  const required = entries.filter(([, rule]) => rule.required === true);
  const optional = entries.filter(([, rule]) => rule.required !== true);
  const sizes = [...new Set([2, 4, 6, optional.length].map(size => Math.min(optional.length, size)).filter(size => size > 0))];
  const variants = sizes.map(size => {
    const fields = Object.fromEntries([...required, ...optional.slice(0, size)]);
    return {
      ...draft,
      fields,
      autoSelectedFields: Object.keys(fields),
      selectionReport: selection.report.filter(field => field.field in fields)
    };
  });
  return variants.length ? variants : [{ ...draft, selectionReport: selection.report }];
}

export function resolveAutomaticProfiles({ targets = [], market = [], fieldCatalog = {}, categoryProfiles = {}, excludedPrices = [] } = {}) {
  const normalizedTargets = targets.map(normalizeItem);
  const normalizedMarket = market.map(normalizeItem);
  const excluded = new Set([99_999, 9_999, ...excludedPrices].map(Number));
  const categories = [...new Set(normalizedTargets.map(item => item.category))];
  const profiles = { ...categoryProfiles };
  const report = {};
  for (const category of categories) {
    const base = profileFromSettings(category, categoryProfiles);
    if (base.automatic === false) {
      profiles[category] = base;
      report[category] = { mode: "manual", name: base.name, selectedFields: [], calibration: null };
      continue;
    }
    const categoryTargets = normalizedTargets.filter(item => item.category === category);
    const categoryMarket = normalizedMarket.filter(item => item.category === category && validMarketItem(item, excluded));
    const selection = chooseFields(category, categoryTargets, categoryMarket, fieldCatalog[category] ?? [], base);
    const draft = {
      ...base,
      name: `${category} — автоматический профиль`,
      automatic: true,
      automaticResolved: true,
      strategy: "inherit",
      activeEstimator: "lowerQuartile",
      minSimilarity: .5,
      minAnalogs: Math.max(2, base.minAnalogs),
      maxAnalogs: Math.max(6, base.maxAnalogs),
      // A numeric recommendation is already blocked unless the automatic
      // profile passes out-of-sample market calibration. Once it does, two or
      // more strong neighbours should not be hidden by a stricter legacy
      // category threshold (WoT used 0.65 and turned valid top lots manual).
      manualThreshold: .58,
      similarityWindow: .14,
      allowCategoryFallback: false,
      filterPriceOutliers: true,
      priceOutlierRatio: Math.min(5, base.priceOutlierRatio),
      useUnconfiguredFields: false,
      fields: selection.fields,
      autoSelectedFields: selection.report.map(field => field.field)
    };
    const calibrated = profileVariants(draft, selection).map(variant => ({
      variant,
      calibration: calibrate(category, categoryMarket, variant)
    })).sort((left, right) => compareRank(left.calibration, right.calibration))[0];
    const calibration = calibrated.calibration;
    const selectedDraft = calibrated.variant;
    const resolved = {
      ...selectedDraft,
      activeEstimator: calibration.estimator,
      minSimilarity: calibration.threshold ?? draft.minSimilarity,
      similarityWindow: calibration.window ?? draft.similarityWindow,
      calibration
    };
    profiles[category] = resolved;
    report[category] = {
      mode: "automatic",
      name: resolved.name,
      marketItems: categoryMarket.length,
      selectedFields: selectedDraft.selectionReport,
      calibration
    };
  }
  return { profiles, report };
}
