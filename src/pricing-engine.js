import { isSafeAttributeValue, sameItemIds } from "./api-normalizer.js";
import { normalizeItem } from "./item-normalizer.js";
import { activeEstimatorLabel, activeMarketPrice, coherentPriceCluster, diversifyCandidates, isPlaceholderPrice, median } from "./market-estimator.js";
import { matchingFixedPriceRule, profileFromSettings } from "./profile-config.js";

const SOLD_STATES = new Set(["sold", "paid", "closed", "closed_inactive"]);
const SAFE_DIFFERENCE_FIELDS = new Set(["cookie_login", "email_access", "phone_linked", "sessions"]);
const SENSITIVE_FIELD = /(?:^|_)(?:password|passwd|pass|login|login_data|email_login_data|token|secret|cookie|session_data|auth|proxy|credential|information)(?:_|$)/i;

export { flattenAttributes, normalizeItem } from "./item-normalizer.js";

function isMissing(value) {
  return value === undefined || value === null || value === "";
}

function numericSimilarity(a, b) {
  a = Math.max(0, Number(a)); b = Math.max(0, Number(b));
  if (a === b) return 1;
  return Math.max(0, 1 - Math.abs(Math.log1p(a) - Math.log1p(b)) / 3);
}

function tokenSet(value) {
  const values = Array.isArray(value) ? value : String(value).toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return new Set(values.map(String).map(x => x.toLowerCase()).filter(Boolean));
}

function jaccard(a, b) {
  const left = tokenSet(a); const right = tokenSet(b);
  if (!left.size && !right.size) return 1;
  const common = [...left].filter(value => right.has(value)).length;
  return common / (left.size + right.size - common || 1);
}

function valueSimilarity(a, b) {
  if (isMissing(a) || isMissing(b)) return null;
  if (typeof a === "number" && typeof b === "number") return numericSimilarity(a, b);
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b) ? 1 : 0;
  if (Array.isArray(a) || Array.isArray(b)) return jaccard(a, b);
  const left = String(a).toLowerCase(); const right = String(b).toLowerCase();
  return left === right ? 1 : jaccard(left, right);
}

function bucketSimilarity(a, b, boundaries) {
  const buckets = [...(boundaries ?? []), Infinity];
  const bucket = value => buckets.findIndex(upper => Number(value) < upper);
  return bucket(a) === bucket(b) ? 1 : 0;
}

function rangeSimilarity(a, b, rule) {
  const left = Number(a); const right = Number(b);
  if (![left, right].every(Number.isFinite)) return { score: valueSimilarity(a, b), rejected: false, difference: null, allowed: null };
  const allowed = Math.max(Number(rule.toleranceAbsolute) || 0, Math.abs(left) * (Number(rule.tolerancePercent) || 0) / 100);
  const difference = Math.abs(left - right);
  if (!allowed) return { score: difference === 0 ? 1 : 0, rejected: difference !== 0, difference, allowed };
  if (difference > allowed) return { score: 0, rejected: true, difference, allowed };
  return { score: Math.max(0.5, 1 - difference / allowed / 2), rejected: false, difference, allowed };
}

function compareConfiguredField(a, b, rule) {
  if (isMissing(a)) return { skipped: true, rejected: false, score: null };
  if (isMissing(b)) {
    if (rule.missing === "ignore") return { skipped: true, rejected: false, score: null };
    return { skipped: false, rejected: rule.missing === "reject", score: 0 };
  }
  if (rule.mode === "exact") {
    const equal = String(a) === String(b);
    return { skipped: false, rejected: !equal && rule.required !== false, score: equal ? 1 : 0 };
  }
  if (rule.mode === "range") {
    const comparison = rangeSimilarity(a, b, rule);
    if (comparison.rejected && rule.required === false) {
      return { ...comparison, rejected: false, score: numericSimilarity(a, b) };
    }
    return { skipped: false, ...comparison };
  }
  if (rule.mode === "overlap") {
    const preferred = new Set((rule.preferredValues ?? []).map(value => String(value).trim().toLowerCase()).filter(Boolean));
    const targetValues = [...tokenSet(a)];
    const candidateValues = [...tokenSet(b)];
    const targetPreferred = preferred.size ? targetValues.filter(value => preferred.has(value)) : [];
    const candidatePreferred = preferred.size ? candidateValues.filter(value => preferred.has(value)) : [];
    const score = targetPreferred.length ? jaccard(targetPreferred, candidatePreferred) : jaccard(a, b);
    return { skipped: false, rejected: score === 0 && rule.required !== false, score };
  }
  if (rule.mode === "bucket") return { skipped: false, rejected: false, score: bucketSimilarity(a, b, rule.buckets) };
  return { skipped: false, rejected: false, score: valueSimilarity(a, b) };
}

function shortValue(value) {
  if (!isSafeAttributeValue("comparison", value)) return "скрыто";
  if (Array.isArray(value)) return value.slice(0, 4).join(", ") || "пусто";
  if (typeof value === "boolean") return value ? "да" : "нет";
  return isMissing(value) ? "нет данных" : String(value).slice(0, 80);
}

function fieldDifference(field, label, targetValue, candidateValue, rule, comparison) {
  if (!SAFE_DIFFERENCE_FIELDS.has(field) && SENSITIVE_FIELD.test(field)) return `${label}: значения различаются`;
  if (isMissing(candidateValue)) return `${label}: у аналога нет данных`;
  if (rule.mode === "range" && Number.isFinite(comparison.allowed)) {
    const allowed = Math.round(comparison.allowed * 100) / 100;
    return `${label}: ${shortValue(targetValue)} → ${shortValue(candidateValue)}, допуск ±${allowed}`;
  }
  if (rule.mode === "overlap") return `${label}: нет общих значений`;
  return `${label}: ${shortValue(targetValue)} ≠ ${shortValue(candidateValue)}`;
}

export function itemSimilarity(target, candidate, profileOverride) {
  target = normalizeItem(target); candidate = normalizeItem(candidate);
  if (target.category !== candidate.category) return { score: 0, rawScore: 0, rejected: true, matches: [], differences: ["Другая категория"] };
  if (target.category === "world-of-tanks" && Boolean(Number(target.attributes.wot_blitz)) !== Boolean(Number(candidate.attributes.wot_blitz))) {
    return { score: 0, rawScore: 0, rejected: true, matches: [], differences: ["WoT Blitz и обычный WoT — разные рынки"] };
  }
  const profile = profileOverride?.fields ? profileOverride : profileFromSettings(target.category, profileOverride);
  const configuredFields = Object.entries(profile.fields).filter(([, rule]) => rule.mode !== "ignore" && rule.weight > 0);
  if (profile.automatic === false && !configuredFields.length) {
    return { score: 0, rawScore: 0, rejected: true, matches: [], differences: ["В профиле не выбраны важные поля"] };
  }
  const fields = new Map(configuredFields);
  if (profile.useUnconfiguredFields) {
    for (const field of new Set([...Object.keys(target.attributes), ...Object.keys(candidate.attributes)])) {
      if (!fields.has(field)) fields.set(field, { label: field.replaceAll("_", " "), mode: "similarity", weight: 0.35, missing: "ignore" });
    }
  }
  let weighted = 0; let total = 0;
  const matches = []; const differences = []; let rejected = false;
  for (const [field, rule] of fields) {
    const targetValue = target.attributes[field];
    const candidateValue = candidate.attributes[field];
    const comparison = compareConfiguredField(targetValue, candidateValue, rule);
    const label = rule.label ?? field.replaceAll("_", " ");
    if (comparison.rejected) {
      rejected = true;
      differences.push(fieldDifference(field, label, targetValue, candidateValue, rule, comparison));
    }
    if (comparison.skipped || comparison.score === null) continue;
    weighted += comparison.score * rule.weight; total += rule.weight;
    if (comparison.score >= 0.82) matches.push(label);
    else if (!comparison.rejected && rule.weight >= 1) differences.push(fieldDifference(field, label, targetValue, candidateValue, rule, comparison));
  }
  const rawScore = total ? weighted / total : jaccard(target.title, candidate.title) * 0.6;
  return { score: rejected ? 0 : rawScore, rawScore, rejected, matches, differences };
}

function priceAfterDiscount(price, percent) {
  return Math.max(1, Math.round(price * (1 - Math.min(99, Math.max(0, percent)) / 100)));
}

function categoryAdjustment(item, price, approximate) {
  if (item.category === "telegram" && item.attributes.spam_block === true && approximate) return Math.max(1, Math.round(price * .2));
  return price;
}

function isSoldItem(item) {
  return SOLD_STATES.has(String(item.state ?? "").toLowerCase());
}

function relatedItemIds(item) {
  return new Set(sameItemIds([item, item?.raw]));
}

function fixedPriceResult(target, profile, minimumPrice) {
  const fixedRule = matchingFixedPriceRule(target.attributes, profile);
  if (!fixedRule) return null;
  const fixedPrice = Math.max(minimumPrice, Math.round(fixedRule.price));
  return {
    item: target,
    proposedPrice: fixedPrice,
    confidence: 0.99,
    status: "ready",
    source: `Ценовое правило: ${fixedRule.name}`,
    reason: `Сработал профиль «${profile.name}»`,
    priceRange: { min: fixedPrice, max: fixedPrice },
    analogs: [],
    nearMisses: [],
    diagnostics: { profile: profile.name, fixedRule: fixedRule.id }
  };
}

function pricingCandidates(target, rawMarket, options) {
  const { profile, targetHistoryIds, ownIds, excludedPrices, minSimilarity } = options;
  const accepted = []; const nearMisses = [];
  const addNearMiss = candidate => {
    const score = candidate.similarity.rawScore ?? candidate.similarity.score;
    const index = nearMisses.findIndex(item => (item.similarity.rawScore ?? item.similarity.score) < score);
    if (index === -1) nearMisses.push(candidate);
    else nearMisses.splice(index, 0, candidate);
    if (nearMisses.length > 5) nearMisses.pop();
  };
  const funnel = { checked: rawMarket.length, accepted: 0, sameAccount: 0, wrongCategory: 0, invalidPrice: 0, ownItem: 0, technicalPrice: 0, placeholderPrice: 0, sameSeller: 0, hardMismatch: 0, belowSimilarity: 0 };
  for (const rawCandidate of rawMarket) {
    const candidate = normalizeItem(rawCandidate);
    if (candidate.id === target.id) { funnel.ownItem += 1; continue; }
    if (candidate.category !== target.category) { funnel.wrongCategory += 1; continue; }
    if (!(candidate.price > 0)) { funnel.invalidPrice += 1; continue; }
    const sameAccount = targetHistoryIds.has(candidate.id) && isSoldItem(candidate);
    if (sameAccount) {
      funnel.sameAccount += 1;
      accepted.push({ ...candidate, sameAccount, similarity: { score: 1, rawScore: 1, rejected: false, matches: ["Тот же аккаунт"], differences: [] } });
      continue;
    }
    if (ownIds.has(candidate.id)) { funnel.ownItem += 1; continue; }
    if (excludedPrices.has(candidate.price)) { funnel.technicalPrice += 1; continue; }
    if (profile.filterPriceOutliers && !isSoldItem(candidate) && isPlaceholderPrice(candidate.price)) { funnel.placeholderPrice += 1; continue; }
    if (candidate.sellerId && target.sellerId && candidate.sellerId === target.sellerId) { funnel.sameSeller += 1; continue; }
    const similarity = itemSimilarity(target, candidate, profile);
    const ranked = { ...candidate, sameAccount: false, similarity };
    if (similarity.rejected) {
      funnel.hardMismatch += 1;
      addNearMiss(ranked);
    } else if (similarity.score < minSimilarity) {
      funnel.belowSimilarity += 1;
      addNearMiss({ ...ranked, similarity: { ...similarity, differences: [...similarity.differences, `Сходство ${Math.round(similarity.score * 100)}% ниже порога ${Math.round(minSimilarity * 100)}%`] } });
    } else accepted.push(ranked);
  }
  accepted.sort((left, right) => right.similarity.score - left.similarity.score);
  funnel.accepted = accepted.length;
  return { accepted, nearMisses, funnel };
}

function selectMarketData(candidates, options) {
  const { strategy, activeEstimator, filterPriceOutliers, priceOutlierRatio, minSimilarity, similarityWindow, maxAnalogs, preferLowerSupported } = options;
  const keepBestTier = values => {
    if (!values.length) return [];
    const best = Math.max(...values.map(value => value.similarity.score));
    return values.filter(value => value.similarity.score >= Math.max(minSimilarity, best - similarityWindow));
  };
  const activePool = candidates.filter(item => !isSoldItem(item));
  // Cheap no-top WoT accounts frequently have a single listing whose optional
  // gold/stat values produce a marginally better similarity score. Restricting
  // the pool to that one score tier hid the real supported cheap segment and
  // then caused either 100+ ₽ guesses or mass manual review. For this narrowly
  // defined low-value segment, cluster the entire already-profile-matched pool
  // and deliberately keep its lowest supported price tier.
  const activeTier = preferLowerSupported ? activePool : keepBestTier(activePool);
  const diversity = diversifyCandidates(activeTier);
  const cluster = filterPriceOutliers
    ? coherentPriceCluster(diversity.candidates, priceOutlierRatio, { preferLowerSupported })
    : { candidates: diversity.candidates, rejected: [], gapRatio: 1, keptSide: "all" };
  const active = cluster.candidates.slice(0, maxAnalogs);
  const sold = keepBestTier(candidates.filter(isSoldItem)).sort((left, right) => right.soldAt - left.soldAt).slice(0, maxAnalogs);
  const exactSold = candidates
    .filter(item => item.sameAccount && isSoldItem(item))
    .sort((left, right) => right.price - left.price || right.soldAt - left.soldAt);
  const activeBase = activeMarketPrice(active, activeEstimator);
  const soldBase = sold[0]?.price ?? null;
  const activeLabel = activeEstimatorLabel(activeEstimator);
  let basePrice;
  let source;
  if (exactSold.length) {
    basePrice = exactSold[0].price;
    source = "Максимальная цена прошлых продаж этого аккаунта";
  } else if (strategy === "active") {
    basePrice = activeBase;
    source = `Активный рынок · ${activeLabel}`;
  } else if (strategy === "lastSold") {
    basePrice = soldBase;
    source = "Последний проданный аналог";
  } else {
    basePrice = median([activeBase, soldBase]);
    source = activeBase && soldBase ? `Активный рынок (${activeLabel}) + история продаж` : activeBase ? `Активный рынок · ${activeLabel}` : "История продаж";
  }
  const combined = [...active, ...sold].sort((left, right) => right.similarity.score - left.similarity.score);
  const evidencePool = exactSold.length ? exactSold : strategy === "active" ? active : strategy === "lastSold" ? sold : combined;
  return {
    basePrice,
    source,
    exactSold,
    activeCount: active.length,
    soldCount: sold.length,
    priceCluster: { gapRatio: cluster.gapRatio, keptSide: cluster.keptSide, rejected: cluster.rejected.length, duplicateCandidates: diversity.rejected.length, preferLowerSupported },
    priceOutliers: cluster.rejected.slice(0, 5),
    evidence: evidencePool.slice(0, maxAnalogs)
  };
}

function categoryFallbackPrice(target, rawMarket, excludedPrices, filterPriceOutliers = true) {
  const prices = rawMarket.map(normalizeItem).filter(item =>
    item.category === target.category && item.price > 0 && !excludedPrices.has(item.price) &&
    (!filterPriceOutliers || isSoldItem(item) || !isPlaceholderPrice(item.price)) &&
    (!target.attributes.origin || !item.attributes.origin || item.attributes.origin === target.attributes.origin)
  ).map(item => item.price);
  return median(prices);
}

function publicCandidate(candidate) {
  return {
    id: candidate.id, title: candidate.title, price: candidate.price, state: candidate.state, soldAt: candidate.soldAt,
    similarity: candidate.similarity.score, rawSimilarity: candidate.similarity.rawScore ?? candidate.similarity.score,
    reason: candidate.similarity.differences[0] ?? "Ниже порога профиля", differences: candidate.similarity.differences.slice(0, 4), url: candidate.url
  };
}

function noDataResult(target, targetHistoryIds, marketItemsChecked, candidateReport, profile) {
  const reason = targetHistoryIds.size
    ? `Найдено ${targetHistoryIds.size} ID прошлых объявлений, но API не вернул цену продажи; подходящих аналогов тоже нет`
    : "История этого аккаунта и подходящие рыночные аналоги не найдены";
  return {
    item: target,
    proposedPrice: null,
    confidence: 0,
    status: "manual",
    source: profile.automaticResolved ? "Категория ещё не настроена" : profile.automatic === false ? "Нет аналогов по вашему профилю" : "Нет данных",
    reason: profile.automaticResolved
      ? `${reason}. Настройте важные поля категории в конструкторе`
      : profile.automatic === false ? `${reason}. Ослабьте одно обязательное поле или проверьте лот вручную` : reason,
    diagnostics: {
      historyIds: targetHistoryIds.size,
      marketItemsChecked,
      profile: profile.name,
      automaticProfile: profile.automaticResolved === true,
      calibration: profile.calibration,
      calibrationBlocked: profile.automaticResolved === true,
      candidateFunnel: candidateReport.funnel
    },
    analogs: [],
    nearMisses: candidateReport.nearMisses.map(publicCandidate)
  };
}

function conservativeWotFallback(item) {
  const attributes = normalizeItem(item).attributes ?? {};
  const top = Math.max(0, Number(attributes.top_count) || 0);
  const premium = Math.max(0, Number(attributes.premium_count) || 0);
  const tanks = Array.isArray(attributes.tanks) ? attributes.tanks.length : 0;
  const gold = Math.max(0, Number(attributes.gold) || 0);
  const silver = Math.max(0, Number(attributes.silver ?? attributes.wot_credits) || 0);
  // This is only a last-resort estimate when the market has no trustworthy
  // analogs. Keep it deliberately conservative: the previous non-linear curve
  // invented 2–4k prices from the top count alone (for example 49 tops → 3764 ₽).
  // A genuinely expensive account may still be priced higher when supported by
  // several market analogs, but the fallback itself must never fake that proof.
  const topValue = top * 8;
  return Math.max(1, Math.min(1_000, Math.round(topValue + premium * .5 + tanks * 1.5 + gold / 1_000 + silver / 2_000_000)));
}

function conservativeMinecraftFallback(item) {
  const attributes = normalizeItem(item).attributes ?? {};
  const number = key => Math.max(0, Number(attributes[key]) || 0);
  const flag = key => attributes[key] === true || Number(attributes[key]) === 1;
  const nowSeconds = Date.now() / 1000;
  const created = number("minecraft_created_at");
  const ageYears = created > 0 && created < nowSeconds ? Math.min(15, (nowSeconds - created) / 31_557_600) : 0;
  const capes = number("minecraft_capes_count") || (Array.isArray(attributes.minecraft_capes) ? attributes.minecraft_capes.length : 0);
  const hypixelLevel = number("minecraft_hypixel_level");
  const achievements = number("minecraft_hypixel_achievement");
  const minecoins = number("minecraft_minecoins");
  let price = flag("minecraft_has_paid_license") ? 25 : 20;
  price += flag("minecraft_java") ? 5 : 0;
  price += flag("minecraft_bedrock") ? 5 : 0;
  price += flag("minecraft_can_change_nickname") ? 15 : 0;
  price += Math.min(100, capes * 15);
  price += Math.min(30, ageYears * 2);
  price += Math.min(80, hypixelLevel * 2);
  price += Math.min(30, achievements / 100);
  price += String(attributes.minecraft_hypixel_rank ?? "").trim() ? 25 : 0;
  price += flag("minecraft_dungeons") ? 10 : 0;
  price += flag("minecraft_legends") ? 10 : 0;
  price += Math.min(30, minecoins / 100);
  price += number("minecraft_subscription_ends") > nowSeconds ? 20 : 0;
  return Math.max(25, Math.min(1_500, Math.round(price)));
}

function conservativeVpnFallback(item) {
  const normalized = normalizeItem(item);
  const attributes = normalized.attributes ?? {};
  const now = new Date();
  let endYear = 0;
  const unixEnd = Number(attributes.subscription_ends ?? attributes.expires_at ?? attributes.expire_at) || 0;
  if (unixEnd > 1_000_000_000) endYear = new Date(unixEnd * 1000).getUTCFullYear();
  if (!endYear) {
    const years = [...String(normalized.title ?? "").matchAll(/\b(20\d{2})\b/g)].map(match => Number(match[1]));
    endYear = years.length ? Math.max(...years) : 0;
  }
  if (!endYear) return 36;
  const remainingYears = Math.max(0, endYear - now.getUTCFullYear() + .5);
  return Math.max(30, Math.min(500, Math.round(30 + remainingYears * 35)));
}

function noDataEstimate(target, rawMarket, excludedPrices, minimumPrice, discountPercent, profile, targetHistoryIds, candidateReport) {
  // Steam cannot be safely priced from a broad category median. Game count,
  // profile level and country have weak or highly conditional market value,
  // while raw inventory totals can contain broken item prices. Without analogs
  // accepted by the cautious Steam profile, return only the configured minimum
  // as an explicitly low-confidence placeholder instead of a fake market price.
  const categoryBase = target.category === "steam"
    ? null
    : categoryFallbackPrice(target, rawMarket, excludedPrices, profile.filterPriceOutliers);
  const modelBase = target.category === "world-of-tanks" ? conservativeWotFallback(target)
    : target.category === "minecraft" ? conservativeMinecraftFallback(target)
    : target.category === "vpn" ? conservativeVpnFallback(target)
    : categoryBase;
  const basePrice = Math.max(1, Number(modelBase) || Number(categoryBase) || Number(minimumPrice) || 1);
  const categoryMinimum = Math.max(minimumPrice, Number(profile.priceMin) || 1);
  const categoryMaximum = Number(profile.priceMax) || Infinity;
  const multiplied = basePrice * profile.priceMultiplier / 100;
  const proposedPrice = Math.min(categoryMaximum, Math.max(categoryMinimum,
    priceAfterDiscount(categoryAdjustment(target, multiplied, true), discountPercent)));
  return {
    item: target,
    proposedPrice,
    priceRange: { min: proposedPrice, max: proposedPrice },
    basePrice: Math.round(basePrice),
    confidence: modelBase ? .18 : .05,
    status: "ready",
    source: modelBase ? "Ориентировочно · модель категории" : "Ориентировочно · минимальная цена",
    reason: modelBase
      ? "Точных аналогов нет: показан осторожный ориентир по характеристикам категории"
      : target.category === "steam"
        ? "Для Steam недостаточно надёжных параметров: количество игр, уровень и страна не использованы как самостоятельные признаки цены"
      : "Рынок не вернул аналогов: показана минимальная допустимая цена, чтобы лот не остался без результата",
    diagnostics: {
      historyIds: targetHistoryIds.size,
      marketItemsChecked: rawMarket.length,
      profile: profile.name,
      automaticProfile: profile.automaticResolved === true,
      roughEstimate: true,
      noExactAnalogs: true,
      candidateFunnel: candidateReport.funnel
    },
    analogs: [],
    nearMisses: candidateReport.nearMisses.map(publicCandidate)
  };
}

function marketPricingContext(target, rawMarket, options) {
  const { profile, strategy, targetHistoryIds, ownIds, excludedPrices, minSimilarity } = options;
  const candidateReport = pricingCandidates(target, rawMarket, {
    profile, targetHistoryIds, ownIds, excludedPrices, minSimilarity
  });
  const selected = selectMarketData(candidateReport.accepted, {
    strategy,
    activeEstimator: profile.activeEstimator,
    filterPriceOutliers: profile.filterPriceOutliers,
    priceOutlierRatio: profile.priceOutlierRatio,
    minSimilarity,
    similarityWindow: profile.similarityWindow,
    maxAnalogs: profile.maxAnalogs,
    // A no-top account with neither named tanks nor meaningful gold/silver is
    // the mass premium-only segment. It should use the lowest *supported*
    // market tier, not a lone richer-looking listing. Loaded garages keep the
    // normal estimator and can still be correctly valued higher.
    preferLowerSupported: target.category === "world-of-tanks"
      && Math.max(0, Number(target.attributes?.top_count) || 0) === 0
      && Math.max(0, Number(target.attributes?.gold) || 0) <= 2_500
      && Math.max(0, Number(target.attributes?.silver ?? target.attributes?.wot_credits) || 0) < 5_000_000
      && (!Array.isArray(target.attributes?.tanks) || target.attributes.tanks.length === 0)
  });
  if (selected.basePrice || !profile.allowCategoryFallback) return { candidateReport, marketData: selected, approximate: false };
  return {
    candidateReport,
    approximate: true,
    marketData: {
      ...selected,
      basePrice: categoryFallbackPrice(target, rawMarket, excludedPrices, profile.filterPriceOutliers),
      source: "Медиана категории"
    }
  };
}

function confidenceFromEvidence(evidence, exactSold, profile, approximate) {
  const average = evidence.length ? evidence.reduce((sum, item) => sum + item.similarity.score, 0) / evidence.length : .15;
  const evidenceFactor = Math.min(1, .7 + Math.min(evidence.length, 4) * .075);
  const calibrationFactor = profile.automaticResolved && profile.calibration ? Number(profile.calibration.confidenceFactor) || .35 : 1;
  const confidence = exactSold.length
    ? Math.min(.98, Math.max(.88, average))
    : Math.min(.98, average * evidenceFactor * (approximate ? .42 : 1) * calibrationFactor);
  return { confidence, evidenceFactor, calibrationFactor };
}

// "One weak signal can't form the whole price." A World of Tanks account with
// real value (tops, premiums, named tanks, gold) must never be confidently
// priced from analogs that are far weaker accounts — that is exactly how an IS-7
// garage ends up quoted at 10 ₽ next to empty "123 Wargaming" lots. We measure a
// coarse value signal and, when the target clearly outweighs its evidence, hand
// the lot to manual review instead of publishing a junk price. Gated to WoT so
// categories that already work are untouched.
export function wotValueSignal(item) {
  const attributes = normalizeItem(item).attributes ?? {};
  const gold = Math.max(0, Number(attributes.gold) || 0);
  const silver = Math.max(0, Number(attributes.silver) || 0);
  const premium = Math.max(0, Number(attributes.premium_count) || 0);
  const top = Math.max(0, Number(attributes.top_count) || 0);
  const tanks = Array.isArray(attributes.tanks) ? attributes.tanks.length : 0;
  return top * 3 + premium * 1.5 + tanks * 1.2 + gold / 1_000 + silver / 5_000_000;
}

function accountLooksEmpty(item) {
  const attributes = normalizeItem(item).attributes ?? {};
  const gold = Math.max(0, Number(attributes.gold) || 0);
  const top = Math.max(0, Number(attributes.top_count) || 0);
  const tanks = Array.isArray(attributes.tanks) ? attributes.tanks.length : 0;
  return gold <= 100 && top <= 1 && tanks === 0;
}

function valueMismatchAgainstEvidence(target, evidence) {
  if (target.category !== "world-of-tanks") return false;
  if (!evidence.length) return false;
  const targetValue = wotValueSignal(target);
  const attributes = normalizeItem(target).attributes ?? {};
  const targetGold = Math.max(0, Number(attributes.gold) || 0);
  const targetSilver = Math.max(0, Number(attributes.silver ?? attributes.wot_credits) || 0);
  const targetTops = Math.max(0, Number(attributes.top_count) || 0);
  const targetPremiums = Math.max(0, Number(attributes.premium_count) || 0);
  const targetTanks = Array.isArray(attributes.tanks) ? attributes.tanks.length : 0;
  // Do not confuse a lot of ordinary premium counters with a demonstrably
  // loaded garage. The previous 500-gold threshold was the reason many
  // otherwise priceable premium-only lots went to manual review. Keep the
  // guard for actual high-value signals: several tops, named tanks, or a
  // substantial currency balance.
  const targetHasRealValue = targetTops >= 2 || targetTanks >= 1 || targetGold >= 5_000 || targetSilver >= 5_000_000;
  const evidenceValues = evidence.map(candidate => wotValueSignal(candidate)).filter(Number.isFinite);
  if (!evidenceValues.length) return false;
  const typicalEvidence = median(evidenceValues) ?? 0;
  // A loaded garage does not need an identical twin to be priceable. If the
  // evidence contains a materially loaded garage too, it is a market anchor:
  // e.g. 3–6 tops or 40–60 premiums for a 6-top/100-premium target.
  const hasComparableGarage = evidence.some(candidate => {
    const comparable = normalizeItem(candidate).attributes ?? {};
    const tops = Math.max(0, Number(comparable.top_count) || 0);
    const premiums = Math.max(0, Number(comparable.premium_count) || 0);
    const gold = Math.max(0, Number(comparable.gold) || 0);
    const silver = Math.max(0, Number(comparable.silver ?? comparable.wot_credits) || 0);
    return (targetTops >= 2 && tops >= Math.max(1, Math.ceil(targetTops * .35)))
      || (targetPremiums >= 20 && premiums >= Math.ceil(targetPremiums * .4))
      || (targetGold >= 5_000 && gold >= targetGold * .35)
      || (targetSilver >= 5_000_000 && silver >= targetSilver * .35);
  });
  if (hasComparableGarage) return false;
  // Case A: the target vastly outweighs the typical analog in the evidence set.
  if (targetHasRealValue && targetValue >= 6 && targetValue >= (typicalEvidence + 1) * 2.5) return true;
  // Case B: the target carries real value but every analog is an empty account
  // (this is the IS-7-garage-priced-like-a-junk-lot case the tester reported).
  if (targetHasRealValue && evidence.every(accountLooksEmpty)) return true;
  return false;
}

export function analyzeItem(rawTarget, rawMarket, settings = {}) {
  const target = normalizeItem(rawTarget);
  const profile = profileFromSettings(target.category, settings.categoryProfiles);
  const discountPercent = Number(profile.discountPercent ?? settings.discountPercent ?? 0);
  const strategy = profile.strategy === "inherit" ? settings.strategy ?? "blended" : profile.strategy;
  const minSimilarity = Number(profile.minSimilarity);
  const excludedPrices = new Set([99_999, 9_999, ...(settings.excludedPrices ?? [])].map(Number));
  const ownIds = new Set((settings.ownItemIds ?? []).map(String));
  const minimumPrice = Math.max(1, Number(settings.minimumPrice ?? 1) || 1);
  const targetHistoryIds = relatedItemIds(target);
  const fixedResult = fixedPriceResult(target, profile, minimumPrice);
  if (fixedResult) return fixedResult;

  const { candidateReport, marketData, approximate } = marketPricingContext(target, rawMarket, {
    profile, strategy, targetHistoryIds, ownIds, excludedPrices, minSimilarity
  });
  const { basePrice, source } = marketData;
  if (!basePrice) {
    if (settings.lowConfidenceAction === "approximate") {
      return noDataEstimate(target, rawMarket, excludedPrices, minimumPrice, discountPercent, profile, targetHistoryIds, candidateReport);
    }
    return noDataResult(target, targetHistoryIds, rawMarket.length, candidateReport, profile);
  }

  const { exactSold, evidence } = marketData;
  const { confidence, evidenceFactor, calibrationFactor } = confidenceFromEvidence(evidence, exactSold, profile, approximate);
  const insufficientAnalogs = !exactSold.length && !approximate && evidence.length < profile.minAnalogs;
  const suspiciousSingleWotListing = insufficientAnalogs
    && target.category === "world-of-tanks"
    && (Math.max(0, Number(target.attributes?.top_count) || 0) === 0 || basePrice >= 1_000);
  const priceConflict = marketData.priceCluster.keptSide === "conflict";
  // A single live listing is not a market. This was the direct source of the
  // 8 647–8 648 ₽ recommendations in the tester dataset: one parked listing
  // passed similarity and became a numeric recommendation despite the profile
  // requiring two analogs. A sharp split with only one or two retained WoT
  // analogs is equally unsafe: do not choose a side for a low-information
  // market, leave it for review instead.
  const unstableWotMarket = !exactSold.length
    && target.category === "world-of-tanks"
    && !marketData.priceCluster.preferLowerSupported
    && marketData.priceCluster.rejected > 0
    && marketData.priceCluster.gapRatio >= profile.priceOutlierRatio
    && evidence.length < 3;
  const calibrationBlocked = !exactSold.length
    && profile.automaticResolved
    && profile.calibration?.status !== "reliable";
  const valueMismatch = !exactSold.length && valueMismatchAgainstEvidence(target, evidence);
  const wotModelPrice = target.category === "world-of-tanks" ? conservativeWotFallback(target) : null;
  const minecraftModelPrice = target.category === "minecraft" ? conservativeMinecraftFallback(target) : null;
  const vpnModelPrice = target.category === "vpn" ? conservativeVpnFallback(target) : null;
  const wotModelMismatch = settings.lowConfidenceAction === "approximate"
    && !exactSold.length
    && target.category === "world-of-tanks"
    && basePrice > Math.max(wotModelPrice * 3, wotModelPrice + 40);
  const lowConfidence = confidence < profile.manualThreshold || insufficientAnalogs || priceConflict || calibrationBlocked || valueMismatch || unstableWotMarket || wotModelMismatch;
  const forceApproximate = settings.lowConfidenceAction === "approximate";
  const status = lowConfidence && !forceApproximate ? "manual" : "ready";
  const categoryMinimum = Math.max(minimumPrice, Number(profile.priceMin) || 1);
  const categoryMaximum = Number(profile.priceMax) || Infinity;
  const adjustedPrice = price => {
    const multiplied = Number(price) * profile.priceMultiplier / 100;
    return Math.min(categoryMaximum, Math.max(categoryMinimum, priceAfterDiscount(categoryAdjustment(target, multiplied, approximate), discountPercent)));
  };
  const unsafeAutomaticEstimate = calibrationBlocked || priceConflict || valueMismatch || suspiciousSingleWotListing || unstableWotMarket || wotModelMismatch || (forceApproximate && insufficientAnalogs && target.category === "world-of-tanks");
  // Sparse live search repeatedly reused one listing for almost half the batch,
  // producing both 5 ₽ whale garages and inflated small garages. In the
  // always-price mode, keep every non-historical WoT estimate inside a broad
  // model corridor. Real market evidence still moves the price, but cannot
  // multiply or divide it by tens without an exact sale of the same account.
  const categoryModelPrice = wotModelPrice ?? minecraftModelPrice ?? vpnModelPrice;
  const modelGuarded = forceApproximate && categoryModelPrice !== null && !exactSold.length;
  const modelFloorFactor = target.category === "minecraft" ? .7 : target.category === "vpn" ? .75 : .5;
  const conservativeBasePrice = modelGuarded
    ? Math.min(categoryModelPrice * 1.5, Math.max(categoryModelPrice * modelFloorFactor, basePrice))
    : basePrice;
  const proposedPrice = adjustedPrice(conservativeBasePrice);
  const evidencePrices = evidence.map(item => adjustedPrice(item.price));
  const priceRange = evidencePrices.length ? { min: Math.min(...evidencePrices), max: Math.max(...evidencePrices) } : { min: proposedPrice, max: proposedPrice };
  return {
    item: target,
    proposedPrice: ((unsafeAutomaticEstimate && !forceApproximate) || (lowConfidence && settings.lowConfidenceAction === "manual")) ? null : proposedPrice,
    priceRange: unsafeAutomaticEstimate && !forceApproximate ? null : priceRange,
    basePrice: unsafeAutomaticEstimate && !forceApproximate ? null : Math.round(basePrice), confidence, status,
    source: unsafeAutomaticEstimate
      ? (forceApproximate ? "Ориентировочно · низкая уверенность" : valueMismatch ? "Аналоги слабее аккаунта — нужна ручная пр��верка" : suspiciousSingleWotListing ? "Недостаточно независимых аналогов" : unstableWotMarket ? "Рынок WoT слишком разрознен — нужна ручная проверка" : "Категория ещё не настроена")
      : source,
    reason: exactSold.length ? `${exactSold.length} прошлых продаж этого же аккаунта` : evidence.length ? `${evidence.length} похожих лотов; совпало: ${evidence[0].similarity.matches.slice(0, 3).join(", ") || "общие параметры"}${profile.automaticResolved ? `; автопрофиль проверен на ${profile.calibration?.predictions ?? 0} рыночных примерах` : ""}${insufficientAnalogs ? `; профиль требует минимум ${profile.minAnalogs}; цена оставлена на ручную проверку` : ""}${marketData.priceCluster.rejected ? `; отброшено ценовых выбросов: ${marketData.priceCluster.rejected}` : ""}${priceConflict ? "; рынок разделился на несовместимые ценовые уровни" : ""}${unstableWotMarket ? "; разрыв цен слишком велик для малого числа аналогов — цена оставлена на ручную проверку" : ""}${calibrationBlocked ? "; автопрофиль не прошёл калибровку — цена оставлена для ручной проверки" : ""}${valueMismatch ? `; аналоги заметно слабее этого аккаунта (${evidence.length} шт.) — цена оставлена на ручную проверку` : ""}` : target.category === "telegram" && target.attributes.spam_block === true ? "Приблизительная оценка по категории с учётом спамблока (−80%)" : "Приблизительная оценка по категории",
    diagnostics: {
      profile: profile.name,
      profileSchemaVersion: profile.schemaVersion,
      strategy,
      activeEstimator: profile.activeEstimator,
      filterPriceOutliers: profile.filterPriceOutliers,
      priceOutlierRatio: profile.priceOutlierRatio,
      activeCandidates: marketData.activeCount,
      soldCandidates: marketData.soldCount,
      priceCluster: marketData.priceCluster,
      evidenceCount: evidence.length,
      evidenceFactor,
      calibrationFactor,
      automaticProfile: profile.automaticResolved === true,
      calibration: profile.calibration,
      calibrationBlocked,
      unstableWotMarket,
      wotModelMismatch,
      wotModelPrice,
      minecraftModelPrice,
      vpnModelPrice,
      modelGuarded,
      roughEstimate: forceApproximate && lowConfidence,
      observedBasePrice: Math.round(basePrice),
      autoSelectedFields: profile.autoSelectedFields,
      minSimilarity: profile.minSimilarity,
      similarityWindow: profile.similarityWindow,
      minAnalogs: profile.minAnalogs,
      manualThreshold: profile.manualThreshold,
      candidateFunnel: candidateReport.funnel
    },
    analogs: evidence.map(x => ({ id: x.id, title: x.title, price: x.price, state: x.state, soldAt: x.soldAt, similarity: x.similarity.score, url: x.url })),
    nearMisses: [
      ...marketData.priceOutliers.map(candidate => publicCandidate({
        ...candidate,
        similarity: {
          ...candidate.similarity,
          differences: [`Цена отделена от выбранного рыночного уровня в ${Math.round(marketData.priceCluster.gapRatio * 10) / 10}×`, ...candidate.similarity.differences]
        }
      })),
      ...candidateReport.nearMisses.map(publicCandidate)
    ].slice(0, 5)
  };
}

export function analyzeBatch(targets, market, settings = {}) {
  const ownItemIds = targets.map(item => String(item.item_id ?? item.id));
  // Seller-confirmed entries are treated as additional sold evidence. They are
  // opt-in and kept in the browser, so the seller can build a portable private
  // reference library without hard-coding somebody else's prices into the app.
  const references = Array.isArray(settings.referenceItems) ? settings.referenceItems.slice(0, 2_000) : [];
  return targets.map(target => analyzeItem(target, [...market, ...references], { ...settings, ownItemIds }));
}
