// Live "strictness" estimator for the profile builder.
//
// Pure and DOM-free: it re-uses the same hard-gate semantics as the pricing engine
// (reject on exact/range/overlap mismatch and on missing:"reject") to estimate,
// entirely from cards ALREADY loaded in memory, what share of market analogs the
// current draft profile would throw away. Zero extra API calls.

import { isListingMetaField } from "./listing-meta.js";

function categoryOf(item) {
  return String(item?.category_name ?? item?.category ?? item?.category_id ?? "unknown").toLowerCase();
}

function isMissing(value) {
  return value === undefined || value === null || value === "";
}

function tokenSet(value) {
  const values = Array.isArray(value) ? value : String(value).toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return new Set(values.map(entry => String(entry).toLowerCase()).filter(Boolean));
}

function overlapScore(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size && !right.size) return 1;
  const common = [...left].filter(value => right.has(value)).length;
  return common / (left.size + right.size - common || 1);
}

// Mirror of pricing-engine reject semantics for a single configured field.
function fieldRejects(targetValue, candidateValue, rule) {
  if (isMissing(targetValue)) return false;
  if (isMissing(candidateValue)) return rule.missing === "reject";
  if (rule.mode === "exact") return String(targetValue) !== String(candidateValue) && rule.required !== false;
  if (rule.mode === "range") {
    if (rule.required === false) return false;
    const left = Number(targetValue);
    const right = Number(candidateValue);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    const allowed = Math.max(Number(rule.toleranceAbsolute) || 0, Math.abs(left) * (Number(rule.tolerancePercent) || 0) / 100);
    const difference = Math.abs(left - right);
    return allowed ? difference > allowed : difference !== 0;
  }
  if (rule.mode === "overlap") return overlapScore(targetValue, candidateValue) === 0 && rule.required !== false;
  return false;
}

function classify(rule) {
  if (!rule || rule.mode === "ignore" || Number(rule.weight) <= 0) return "ignore";
  if (rule.required === true || rule.missing === "reject") return "required";
  return "important";
}

function levelFor({ rejectRate, requiredCount }) {
  if (rejectRate == null) return "no-market";
  if (rejectRate > 0.85) return "high";
  if (rejectRate > 0.6 || requiredCount > 5) return "warn";
  return "ok";
}

export function computeStrictness({ targets = [], market = [], profile = {}, category, limit = {} } = {}) {
  const targetLimit = Number(limit.targets) || 80;
  const marketLimit = Number(limit.market) || 250;
  const cat = String(category ?? profile.category ?? "").toLowerCase();
  const minAnalogs = Math.max(1, Math.round(Number(profile.minAnalogs) || 1));

  const fieldEntries = Object.entries(profile.fields ?? {})
    .filter(([field, rule]) => rule && rule.mode !== "ignore" && Number(rule.weight) > 0 && !isListingMetaField(field));
  const requiredCount = fieldEntries.filter(([, rule]) => classify(rule) === "required").length;
  const importantCount = fieldEntries.filter(([, rule]) => classify(rule) === "important").length;
  const configuredCount = fieldEntries.length;

  const catTargets = targets.filter(item => (cat ? categoryOf(item) === cat : true)).slice(0, targetLimit);
  const catMarket = market.filter(item => (cat ? categoryOf(item) === cat : true)).slice(0, marketLimit);
  const hasMarket = catMarket.length > 0 && catTargets.length > 0;

  const base = { requiredCount, importantCount, configuredCount, sampleSize: catTargets.length, marketSize: catMarket.length, hasMarket };

  // A manual profile with no active field rejects everything (same as the engine).
  if (!configuredCount && profile.automatic === false) {
    return { ...base, rejectRate: hasMarket ? 1 : null, tooFewCount: catTargets.length, level: "empty" };
  }
  if (!hasMarket) return { ...base, rejectRate: null, tooFewCount: 0, level: configuredCount ? "no-market" : "empty" };

  let totalPairs = 0;
  let rejectedPairs = 0;
  let tooFewCount = 0;
  for (const target of catTargets) {
    const targetAttrs = target?.attributes ?? {};
    let survivors = 0;
    for (const candidate of catMarket) {
      const candidateAttrs = candidate?.attributes ?? {};
      totalPairs += 1;
      const rejected = fieldEntries.some(([field, rule]) => fieldRejects(targetAttrs[field], candidateAttrs[field], rule));
      if (rejected) rejectedPairs += 1;
      else survivors += 1;
    }
    if (survivors < minAnalogs) tooFewCount += 1;
  }
  const rejectRate = totalPairs ? rejectedPairs / totalPairs : null;
  return { ...base, rejectRate, tooFewCount, level: levelFor({ rejectRate, requiredCount }) };
}
