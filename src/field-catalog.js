import { ATTRIBUTE_ALIASES, isAutomaticPricingAttributeKey, normalizeAttributeKey } from "./api-normalizer.js";
import { canonicalCategory } from "./category-profiles.js";
import { glossaryEntry } from "../public/field-glossary.js";
import { isListingMetaField } from "../public/listing-meta.js";
import { normalizeItem } from "./pricing-engine.js";
import { profileFromSettings } from "./profile-config.js";
import { safeAttributes } from "./public-snapshot.js";
import { isPlaceholderPrice, median } from "./market-estimator.js";

function typeOf(value) {
  if (Array.isArray(value)) return "list";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "text";
}

function exampleValue(value) {
  if (Array.isArray(value)) return value.slice(0, 5);
  return typeof value === "string" ? value.slice(0, 80) : value;
}

function schemaMatches(field, schema) {
  const aliases = new Set([field, ...(ATTRIBUTE_ALIASES[field] ?? [])]);
  return (schema ?? []).filter(param => {
    const name = String(param.name ?? "").replace(/\[\]$/, "");
    return aliases.has(name) || aliases.has(param.base);
  });
}

function numericBuckets(values) {
  const sorted = [...new Set(values.map(Number).filter(Number.isFinite).filter(value => value > 0))].sort((a, b) => a - b);
  if (sorted.length < 4) return [];
  return [0.25, 0.5, 0.75].map(quantile => sorted[Math.floor((sorted.length - 1) * quantile)]).filter((value, index, all) => value > 0 && value !== all[index - 1]);
}

const AUTO_FIELD = /(?:^|_)(?:activity|age|balance|ban|battle|badges?|cape|clan|coin|country|credit|followers?|following|game|gold|inventory|level|like|live|loss|mobile|points?|post|premium|rank|rating|region|score|silver|spam|status|tier|top|verified|win)(?:_|$)/i;
const ignoredRule = { mode: "ignore", weight: 0, missing: "ignore", required: false, tolerancePercent: 0, toleranceAbsolute: 0, search: false };

function quantile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, ratio));
  const lower = Math.floor(position); const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function logPriceSignal(observations, type) {
  const usable = observations.filter(entry => Number.isFinite(entry.price) && entry.price > 0 && !isPlaceholderPrice(entry.price));
  if (usable.length < 6) return 0;
  const overall = usable.map(entry => Math.log1p(entry.price));
  const center = median(overall);
  const spread = median(overall.map(value => Math.abs(value - center))) || .25;
  const categoricalSignal = entries => {
    const groups = new Map();
    for (const entry of entries) {
      const key = JSON.stringify(entry.value);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(Math.log1p(entry.price));
    }
    const supported = [...groups.values()].filter(values => values.length >= 2);
    if (supported.length < 2 || supported.length > 20) return 0;
    const centers = supported.map(values => median(values));
    return Math.min(1, (quantile(centers, .9) - quantile(centers, .1)) / Math.max(.5, spread * 4));
  };
  if (type === "number") {
    const sorted = usable.filter(entry => Number.isFinite(Number(entry.value))).sort((left, right) => Number(left.value) - Number(right.value));
    if (sorted.length < 6) return 0;
    const distinct = new Set(sorted.map(entry => Number(entry.value))).size;
    if (distinct < 2) return 0;
    if (distinct <= 8) return categoricalSignal(sorted);
    const buckets = [[], [], [], []];
    sorted.forEach((entry, index) => buckets[Math.min(3, Math.floor(index * 4 / sorted.length))].push(Math.log1p(entry.price)));
    const centers = buckets.map(values => median(values)).filter(Number.isFinite);
    if (centers.length < 2) return 0;
    return Math.min(1, (Math.max(...centers) - Math.min(...centers)) / Math.max(.5, spread * 4));
  }
  if (type === "list") {
    return logPriceSignal(usable.map(entry => ({ value: Array.isArray(entry.value) ? entry.value.length : 0, price: entry.price })), "number");
  }
  return categoricalSignal(usable);
}

function suggestedRule(stat, targetTotal, marketTotal, priceSignal) {
  const targetCoverage = targetTotal ? stat.targetCount / targetTotal : 0;
  const marketCoverage = marketTotal ? stat.marketCount / marketTotal : 0;
  const coverage = Math.min(targetCoverage, marketCoverage || targetCoverage);
  const missing = targetCoverage >= .75 && marketCoverage >= .65 ? "penalize" : "ignore";
  const weight = Math.round((1 + coverage * 1.5 + priceSignal * 2) * 10) / 10;
  if (!stat.targetCount || marketCoverage < .12) return { mode: "ignore", weight: 0, missing: "ignore", required: false, tolerancePercent: 0, toleranceAbsolute: 0 };
  if (stat.type === "boolean") return { mode: "exact", weight, missing, required: false, tolerancePercent: 0, toleranceAbsolute: 0 };
  if (stat.type === "list") return { mode: "overlap", weight, missing, required: false, tolerancePercent: 0, toleranceAbsolute: 0 };
  if (stat.type === "number") {
    const values = stat.numericValues;
    const distinctNumbers = new Set(values.map(Number).filter(Number.isFinite));
    const categorical = distinctNumbers.size >= 2 && distinctNumbers.size <= 3 && [...distinctNumbers].every(value => Number.isInteger(value) && Math.abs(value) <= 1);
    if (categorical) return { mode: "exact", weight, missing, required: false, tolerancePercent: 0, toleranceAbsolute: 0 };
    const median = values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : 0;
    return { mode: "range", weight, missing, required: false, tolerancePercent: 35, toleranceAbsolute: median < 10 ? 1 : median < 100 ? 5 : 10, buckets: numericBuckets(values) };
  }
  if (stat.type !== "text") return { mode: "ignore", weight: 0, missing: "ignore", required: false, tolerancePercent: 0, toleranceAbsolute: 0 };
  const observed = stat.targetCount + stat.marketCount;
  const probablyIdentifier = observed >= 8 && stat.distinct.size >= Math.min(12, Math.ceil(observed * .7));
  return probablyIdentifier
    ? { mode: "ignore", weight: 0, missing: "ignore", required: false, tolerancePercent: 0, toleranceAbsolute: 0 }
    : { mode: "exact", weight, missing, required: false, tolerancePercent: 0, toleranceAbsolute: 0 };
}

// Title-inferred heuristic signals (populated by normalizeItem from the listing
// title) power the built-in WoT similarity profile, but they must never surface
// as automatic or constructor fields: they are derived guesses, not real API
// attributes, and letting them train automatic profiles would both pollute the
// field catalog and displace genuine discriminators such as wot_blitz.
const INFERRED_ONLY_FIELDS = new Set(["tanks", "silver"]);

function observe(stats, item, source) {
  const normalizedItem = normalizeItem(item);
  for (const [field, value] of Object.entries(safeAttributes(normalizeItem(item).attributes))) {
    if (value === undefined || value === null || value === "") continue;
    if (INFERRED_ONLY_FIELDS.has(field)) continue;
    if (!stats.has(field)) stats.set(field, { field, targetCount: 0, marketCount: 0, types: new Set(), examples: [], distinct: new Set(), numericValues: [], marketObservations: [] });
    const stat = stats.get(field);
    stat[`${source}Count`] += 1;
    stat.types.add(typeOf(value));
    if (stat.examples.length < 3) {
      const example = exampleValue(value);
      const key = JSON.stringify(example);
      if (!stat.examples.some(entry => JSON.stringify(entry) === key)) stat.examples.push(example);
    }
    if (stat.distinct.size <= 50) stat.distinct.add(JSON.stringify(value));
    if (typeof value === "number" && stat.numericValues.length < 5_000) stat.numericValues.push(value);
    if (source === "market" && stat.marketObservations.length < 5_000 && normalizedItem.price > 0) stat.marketObservations.push({ value, price: normalizedItem.price });
  }
}

export function buildFieldCatalog(targets = [], market = [], schemas = {}, categoryProfiles = {}) {
  const schemaByCategory = new Map(Object.entries(schemas ?? {}).map(([category, schema]) => [canonicalCategory(category), schema]));
  const categories = new Set([...targets, ...market].map(item => normalizeItem(item).category));
  const catalog = {};
  for (const category of categories) {
    const categoryTargets = targets.filter(item => normalizeItem(item).category === category);
    const categoryMarket = market.filter(item => normalizeItem(item).category === category);
    const stats = new Map();
    categoryTargets.forEach(item => observe(stats, item, "target"));
    categoryMarket.forEach(item => observe(stats, item, "market"));
    const schema = schemaByCategory.get(category) ?? [];
    const profile = profileFromSettings(category, categoryProfiles);
    catalog[category] = [...stats.values()].map(stat => {
      stat.type = stat.types.size === 1 ? [...stat.types][0] : "mixed";
      const params = schemaMatches(stat.field, schema);
      const source = ATTRIBUTE_ALIASES[stat.field] ? "known" : params.length ? "schema" : "dynamic";
      const targetCoverage = categoryTargets.length ? stat.targetCount / categoryTargets.length : 0;
      const marketCoverage = categoryMarket.length ? stat.marketCount / categoryMarket.length : 0;
      const lowCardinalityNumber = stat.type === "number" && stat.distinct.size >= 2 && stat.distinct.size <= 8 && targetCoverage >= .5 && marketCoverage >= .5;
      const priceSignal = logPriceSignal(stat.marketObservations, stat.type);
      const configured = profile.fields?.[stat.field];
      const profileEligible = configured && configured.mode !== "ignore" && Number(configured.weight) > 0;
      const meta = isListingMetaField(stat.field, params[0]);
      const autoEligible = !meta && isAutomaticPricingAttributeKey(stat.field) && Boolean(source !== "dynamic" || AUTO_FIELD.test(normalizeAttributeKey(stat.field)) || lowCardinalityNumber || priceSignal >= .12 || profileEligible);
      const suggested = autoEligible ? suggestedRule(stat, categoryTargets.length, categoryMarket.length, priceSignal) : ignoredRule;
      const profileLabel = profile.fields?.[stat.field]?.label;
      const schemaLabel = params.find(param => param.description)?.description;
      return {
        field: stat.field,
        label: profileLabel ?? schemaLabel ?? glossaryEntry(stat.field)?.label ?? stat.field.replaceAll("_", " "),
        type: stat.type,
        meta,
        targetCount: stat.targetCount,
        targetTotal: categoryTargets.length,
        marketCount: stat.marketCount,
        marketTotal: categoryMarket.length,
        targetCoverage,
        marketCoverage,
        distinctValues: stat.distinct.size,
        priceSignal: Math.round(priceSignal * 1_000) / 1_000,
        examples: stat.examples,
        apiFilter: params.length > 0,
        searchParams: params.map(param => param.name).filter(Boolean).slice(0, 10),
        source,
        autoEligible,
        suggestedRule: { ...suggested, search: params.length > 0 }
      };
    }).sort((left, right) => right.targetCoverage - left.targetCoverage || right.marketCoverage - left.marketCoverage || left.field.localeCompare(right.field)).slice(0, 200);
  }
  return catalog;
}
