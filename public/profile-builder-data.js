import { isListingMetaField } from "./listing-meta.js";

export const STORAGE_KEY = "lotflow.category-profiles.v1";
export const PROFILE_SCHEMA_VERSION = 6;

export function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

export function categoryOf(item) {
  return String(item?.category_name ?? item?.category ?? item?.category_id ?? "unknown").toLowerCase();
}

export function catalogFromParams(payload) {
  const rawParams = Array.isArray(payload) ? payload : payload?.params ?? payload?.data?.params ?? [];
  const params = Array.isArray(rawParams) ? rawParams : rawParams && typeof rawParams === "object" ? Object.values(rawParams) : [];
  const grouped = new Map();
  for (const param of params) {
    const name = String(param?.base ?? param?.name ?? "").replace(/\[\]$/, "").replace(/_(?:min|max)$/, "");
    if (!name || grouped.has(name)) continue;
    const rawName = String(param?.name ?? "");
    const autoEligible = !isListingMetaField(name) && /origin|service|type|region|country|platform|access|subscription|renew|expire|rank|level|count|amount|balance|followers|premium|top|tank|game|skin|character/i.test(name);
    const required = /^(origin|service|account_type|platform|region|email_access)$/.test(name);
    grouped.set(name, {
      field: name,
      label: String(param?.description ?? param?.title ?? name.replaceAll("_", " ")),
      type: /_(?:min|max)$/.test(rawName) ? "number" : rawName.endsWith("[]") ? "list" : "text",
      targetCoverage: 0,
      marketCoverage: 0,
      examples: [],
      apiFilter: true,
      autoEligible,
      suggestedPriority: required ? "required" : "important",
      suggestedRule: required
        ? { mode: "exact", weight: 3, missing: "penalize", required: true, search: true }
        : { mode: /length|count|level|amount|balance|followers|premium|top/i.test(name) ? "range" : "similarity", weight: 2, missing: "penalize", required: false, search: true, tolerancePercent: 50, toleranceAbsolute: 1 }
    });
  }
  return [...grouped.values()];
}

export function readStoredProfiles() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function isLegacyWotTankRule(rule) {
  return rule?.mode === "overlap" && rule?.missing === "penalize" && Number(rule?.weight) === 4;
}

export function migrateStoredProfile(category, profile, base, allowedFields = []) {
  const original = deepCopy(profile ?? {});
  const version = Number(original.schemaVersion) || 0;
  if (version >= PROFILE_SCHEMA_VERSION) return { changed: false, profile: original };
  const neutralizeVisualMeta = fields => {
    for (const [field, rule] of Object.entries(fields ?? {})) {
      if (isListingMetaField(field)) fields[field] = { ...rule, mode: "ignore", weight: 0, missing: "ignore", required: false, search: false };
    }
  };
  if (version >= 3) {
    neutralizeVisualMeta(original.fields ?? {});
    original.automatic ??= true;
    original.schemaVersion = PROFILE_SCHEMA_VERSION;
    return { changed: true, profile: original };
  }
  if (version < 2 && !allowedFields.length) return { changed: false, pending: true, profile: original };

  const next = original;
  // Keep the browser editor consistent with the server-side safety layer. A
  // saved volatile asset such as a clan emblem must visibly become "Не важно",
  // rather than merely being ignored later during server analysis.
  neutralizeVisualMeta(next.fields ?? {});
  if (version < 2) {
    const allowed = new Set(allowedFields);
    next.fields = Object.fromEntries(Object.entries(next.fields ?? {}).filter(([field]) => allowed.has(field)));
    next.fixedPriceRules = (next.fixedPriceRules ?? []).map(rule => ({
      ...rule,
      conditions: (rule.conditions ?? []).filter(condition => allowed.has(condition.field))
    })).filter(rule => rule.conditions.length);
  }

  const legacyWotFields = category === "world-of-tanks" && isLegacyWotTankRule(next.fields?.tanks);
  if ((version < 2 || legacyWotFields) && Number(next.minSimilarity) >= 0.85 && Number.isFinite(Number(base?.minSimilarity))) {
    next.minSimilarity = Number(base.minSimilarity);
  }
  if (legacyWotFields && base?.fields?.tanks) next.fields.tanks = deepCopy(base.fields.tanks);

  if (category === "world-of-tanks" && Array.isArray(next.fixedPriceRules)) {
    const noTopsRule = base?.fixedPriceRules?.find(rule => rule.id === "wot-no-tops");
    if (noTopsRule && !next.fixedPriceRules.some(rule => rule?.id === noTopsRule.id)) next.fixedPriceRules.push(deepCopy(noTopsRule));
  }
  next.schemaVersion = PROFILE_SCHEMA_VERSION;
  next.activeEstimator ??= "weightedMedian";
  next.automatic ??= true;
  return { changed: true, profile: next };
}

export function mergeProfile(base, custom) {
  if (!custom) return deepCopy(base);
  return {
    ...deepCopy(base),
    ...deepCopy(custom),
    fields: { ...base.fields, ...custom.fields },
    fixedPriceRules: Array.isArray(custom.fixedPriceRules) ? deepCopy(custom.fixedPriceRules) : deepCopy(base.fixedPriceRules ?? [])
  };
}

export function inferredFieldRule(field, values) {
  const sample = values.find(value => value !== undefined && value !== null && value !== "");
  const label = field.replaceAll("_", " ");
  if (field === "origin") return { label: "Происхождение", mode: "exact", weight: 3, missing: "ignore", required: true, tolerancePercent: 0, toleranceAbsolute: 0 };
  if (Array.isArray(sample)) return { label, mode: "overlap", weight: 1, missing: "penalize", required: false, tolerancePercent: 0, toleranceAbsolute: 0 };
  if (typeof sample === "boolean") return { label, mode: "exact", weight: 1, missing: "penalize", required: false, tolerancePercent: 0, toleranceAbsolute: 0 };
  if (typeof sample === "number") return { label, mode: "similarity", weight: 1, missing: "penalize", required: false, tolerancePercent: 50, toleranceAbsolute: 1 };
  return { label, mode: "similarity", weight: 1, missing: "penalize", required: false, tolerancePercent: 0, toleranceAbsolute: 0 };
}

export function inactiveFieldRule(field, values) {
  return { ...inferredFieldRule(field, values), mode: "ignore", weight: 0, missing: "ignore", required: false, search: false };
}

export function simplePriority(rule = {}) {
  if (rule.mode === "ignore" || Number(rule.weight) <= 0) return "ignore";
  if (rule.required === true || rule.missing === "reject") return "required";
  return "important";
}

export function simpleFieldRule(priority, type, current = {}) {
  const base = {
    ...current,
    label: current.label,
    search: current.search === true,
    preferredValues: Array.isArray(current.preferredValues) ? current.preferredValues : []
  };
  if (priority === "ignore") return {
    ...base,
    mode: "ignore",
    weight: 0,
    missing: "ignore",
    required: false,
    search: false
  };
  if (priority === "important") return {
    ...base,
    mode: "similarity",
    weight: 2,
    missing: "penalize",
    required: false
  };
  const mode = type === "number" ? "range" : type === "list" ? "overlap" : "exact";
  return {
    ...base,
    mode,
    weight: 5,
    missing: "reject",
    required: true,
    tolerancePercent: type === "number" ? Number(current.tolerancePercent) || 20 : 0,
    toleranceAbsolute: type === "number" ? Number(current.toleranceAbsolute) || 1 : 0
  };
}

export function generatedProfile(category, targets) {
  const categoryItems = targets.filter(item => categoryOf(item) === category);
  const fieldValues = new Map();
  for (const item of categoryItems) for (const [field, value] of Object.entries(item.attributes ?? {})) {
    if (!fieldValues.has(field)) fieldValues.set(field, []);
    fieldValues.get(field).push(value);
  }
  const fields = Object.fromEntries([...fieldValues].map(([field, values]) => [field, inactiveFieldRule(field, values)]));
  if (!fields.origin) fields.origin = inactiveFieldRule("origin", []);
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION, category, name: `${category} — мой профиль`, strategy: "inherit", activeEstimator: "weightedMedian", automatic: false,
    discountPercent: null,
    minSimilarity: 0.55, minAnalogs: 1, maxAnalogs: 5, manualThreshold: 0.5,
    similarityWindow: 0.15, allowCategoryFallback: false, priceMultiplier: 100,
    filterPriceOutliers: true, priceOutlierRatio: 6,
    priceMin: null, priceMax: null, useUnconfiguredFields: false, fields, fixedPriceRules: []
  };
}

export function discoveredFields(category, targets, profile) {
  const values = new Map(Object.keys(profile.fields ?? {}).map(field => [field, []]));
  for (const item of targets.filter(target => categoryOf(target) === category)) {
    for (const [field, value] of Object.entries(item.attributes ?? {})) {
      if (!values.has(field)) values.set(field, []);
      values.get(field).push(value);
    }
  }
  return values;
}
