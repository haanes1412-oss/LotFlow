import { canonicalCategory, resolveProfile } from "./category-profiles.js";
import { isPricingAttributeKey } from "./api-normalizer.js";
import { isListingMetaField } from "../public/listing-meta.js";

export const PROFILE_SCHEMA_VERSION = 6;

const FIELD_MODES = new Set(["ignore", "similarity", "exact", "range", "overlap", "bucket"]);
const MISSING_MODES = new Set(["ignore", "penalize", "reject"]);
const CONDITION_OPERATORS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "between", "contains", "present", "missing"]);
const STRATEGIES = new Set(["inherit", "active", "lastSold", "blended"]);
const ACTIVE_ESTIMATORS = new Set(["lowest", "lowerQuartile", "median", "weightedMedian"]);
const FIELD_NAME = /^[\w.-]{1,80}$/u;

const commonFields = {
  origin: { label: "Происхождение", mode: "exact", weight: 3, missing: "ignore" }
};

const BUILTIN_PROFILES = {
  "world-of-tanks": {
    name: "WoT — безопасная оценка",
    minSimilarity: 0.58,
    strategy: "inherit",
    activeEstimator: "weightedMedian",
    minAnalogs: 2,
    maxAnalogs: 5,
    manualThreshold: 0.65,
    similarityWindow: 0.12,
    allowCategoryFallback: false,
    priceMultiplier: 100,
    filterPriceOutliers: true,
    priceOutlierRatio: 6,
    useUnconfiguredFields: false,
    fields: {
      ...commonFields,
      region: { label: "Регион", mode: "exact", weight: 3, missing: "reject" },
      email_access: { label: "Доступ к почте", mode: "exact", weight: 3, missing: "penalize" },
      top_count: { label: "Топы", mode: "range", weight: 4, tolerancePercent: 40, toleranceAbsolute: 4, missing: "reject" },
      premium_count: { label: "Премы", mode: "range", weight: 3.5, tolerancePercent: 45, toleranceAbsolute: 3, missing: "penalize" },
      gold: { label: "Золото", mode: "similarity", weight: 1.4, missing: "penalize" },
      tanks: { label: "Ценные танки", mode: "similarity", weight: 4, missing: "ignore" },
      battles: { label: "Бои", mode: "similarity", weight: 0.7, missing: "ignore" },
      phone_linked: { label: "Привязка", mode: "exact", weight: 1.2, missing: "ignore" }
    },
    fixedPriceRules: [{
      id: "wot-empty",
      name: "Без топов и золота",
      enabled: true,
      price: 1,
      conditions: [
        { field: "top_count", operator: "eq", value: 0 },
        { field: "gold", operator: "eq", value: 0 }
      ]
    }, {
      id: "wot-low-tier",
      name: "Без топов, до 3 премов и мало золота",
      enabled: true,
      price: 2,
      conditions: [
        { field: "top_count", operator: "eq", value: 0 },
        { field: "premium_count", operator: "lte", value: 3 },
        { field: "gold", operator: "lte", value: 2500 }
      ]
    }, {
      id: "wot-no-tops",
      name: "Без топов",
      enabled: true,
      price: 1,
      conditions: [
        { field: "top_count", operator: "eq", value: 0 }
      ]
    }]
  },
  tiktok: {
    name: "TikTok — по диапазону подписчиков",
    minSimilarity: 0.6,
    strategy: "inherit",
    activeEstimator: "weightedMedian",
    minAnalogs: 2,
    maxAnalogs: 5,
    manualThreshold: 0.62,
    similarityWindow: 0.12,
    allowCategoryFallback: false,
    priceMultiplier: 100,
    filterPriceOutliers: true,
    priceOutlierRatio: 6,
    useUnconfiguredFields: true,
    fields: {
      ...commonFields,
      followers: { label: "Подписчики", mode: "bucket", weight: 4, missing: "reject", buckets: [100, 1_000, 5_000, 10_000, 20_000, 50_000, 100_000, 500_000] },
      cookie_login: { label: "Cookie", mode: "exact", weight: 2, missing: "reject" },
      live: { label: "Стримы", mode: "exact", weight: 0.8, missing: "ignore" },
      phone_linked: { label: "Телефон", mode: "exact", weight: 0.5, missing: "ignore" }
    },
    fixedPriceRules: []
  },
  telegram: {
    name: "Telegram — базовый",
    minSimilarity: 0.56,
    strategy: "inherit",
    activeEstimator: "weightedMedian",
    minAnalogs: 2,
    maxAnalogs: 5,
    manualThreshold: 0.58,
    similarityWindow: 0.15,
    allowCategoryFallback: true,
    priceMultiplier: 100,
    filterPriceOutliers: true,
    priceOutlierRatio: 6,
    useUnconfiguredFields: true,
    fields: {
      ...commonFields,
      spam_block: { label: "Спамблок", mode: "exact", weight: 3, missing: "reject" },
      inactivity_days: { label: "Отлёга", mode: "range", weight: 2.5, tolerancePercent: 50, toleranceAbsolute: 7, missing: "penalize" },
      country: { label: "Страна", mode: "exact", weight: 0.8, missing: "ignore" },
      sessions: { label: "Сессии", mode: "similarity", weight: 0.4, missing: "ignore" }
    },
    fixedPriceRules: []
  },
  minecraft: {
    name: "Minecraft — базовый",
    minSimilarity: 0.56,
    strategy: "inherit",
    activeEstimator: "weightedMedian",
    minAnalogs: 2,
    maxAnalogs: 5,
    manualThreshold: 0.58,
    similarityWindow: 0.15,
    allowCategoryFallback: false,
    priceMultiplier: 100,
    filterPriceOutliers: true,
    priceOutlierRatio: 6,
    useUnconfiguredFields: true,
    fields: {
      ...commonFields,
      banned: { label: "Баны", mode: "exact", weight: 3, missing: "reject" },
      email_relinked: { label: "Почта перевязана", mode: "exact", weight: 2.5, missing: "reject" },
      capes: { label: "Плащи", mode: "similarity", weight: 2.2, missing: "penalize" },
      hypixel_level: { label: "Hypixel", mode: "range", weight: 1.5, tolerancePercent: 40, toleranceAbsolute: 5, missing: "penalize" }
    },
    fixedPriceRules: []
  }
};

function clampNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function safeText(value, fallback, maxLength = 120) {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, maxLength);
}

function safeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizedCalibration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    status: ["reliable", "limited", "unavailable"].includes(value.status) ? value.status : "unavailable",
    sampleSize: Math.round(clampNumber(value.sampleSize, 0, 0, 10_000)),
    predictions: Math.round(clampNumber(value.predictions, 0, 0, 10_000)),
    coverage: clampNumber(value.coverage, 0, 0, 1),
    medianError: clampNumber(value.medianError, 2, 0, 10),
    p75Error: clampNumber(value.p75Error, 3, 0, 10),
    overRate: clampNumber(value.overRate, 1, 0, 1),
    confidenceFactor: clampNumber(value.confidenceFactor, .45, .2, 1),
    estimator: ACTIVE_ESTIMATORS.has(value.estimator) ? value.estimator : "lowerQuartile"
  };
}

function scalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value) ? value : "";
}

function genericProfile(category) {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    category,
    name: `${category} — пользовательский профиль`,
    minSimilarity: 0.55,
    strategy: "inherit",
    activeEstimator: "weightedMedian",
    minAnalogs: 1,
    maxAnalogs: 5,
    manualThreshold: 0.5,
    similarityWindow: 0.15,
    allowCategoryFallback: true,
    priceMultiplier: 100,
    filterPriceOutliers: true,
    priceOutlierRatio: 6,
    priceMin: null,
    priceMax: null,
    useUnconfiguredFields: true,
    fields: { ...commonFields },
    fixedPriceRules: []
  };
}

function normalizedField(field, fallback = {}) {
  const mode = FIELD_MODES.has(field?.mode) ? field.mode : fallback.mode ?? "similarity";
  const missing = MISSING_MODES.has(field?.missing) ? field.missing : fallback.missing ?? "penalize";
  const requiredByDefault = ["exact", "range", "overlap"].includes(mode);
  const buckets = Array.isArray(field?.buckets) ? field.buckets.map(Number).filter(Number.isFinite).filter(value => value > 0).sort((a, b) => a - b).slice(0, 30) : fallback.buckets;
  const preferredValues = Array.isArray(field?.preferredValues)
    ? field.preferredValues.map(value => safeText(value, "", 100)).filter(Boolean).slice(0, 100)
    : Array.isArray(fallback.preferredValues) ? fallback.preferredValues.slice(0, 100) : [];
  return {
    label: safeText(field?.label, fallback.label ?? "Поле", 80),
    mode,
    weight: clampNumber(field?.weight, fallback.weight ?? 1, 0, 20),
    missing,
    required: safeBoolean(field?.required, fallback.required ?? requiredByDefault),
    search: safeBoolean(field?.search, fallback.search ?? true),
    tolerancePercent: clampNumber(field?.tolerancePercent, fallback.tolerancePercent ?? 0, 0, 10_000),
    toleranceAbsolute: clampNumber(field?.toleranceAbsolute, fallback.toleranceAbsolute ?? 0, 0, 1_000_000_000),
    ...(buckets?.length ? { buckets } : {}),
    ...(preferredValues.length ? { preferredValues } : {})
  };
}

function normalizedCondition(condition) {
  if (!FIELD_NAME.test(String(condition?.field ?? "")) || !isPricingAttributeKey(condition.field) || !CONDITION_OPERATORS.has(condition?.operator)) return null;
  return {
    field: String(condition.field),
    operator: condition.operator,
    value: scalar(condition.value),
    valueTo: scalar(condition.valueTo)
  };
}

function normalizedFixedRule(rule, index) {
  const conditions = (rule?.conditions ?? []).map(normalizedCondition).filter(Boolean).slice(0, 8);
  if (!conditions.length) return null;
  return {
    id: safeText(rule.id, `rule-${index + 1}`, 80).replace(/[^\w.-]/gu, "-"),
    name: safeText(rule.name, `Правило ${index + 1}`, 100),
    enabled: rule.enabled !== false,
    price: clampNumber(rule.price, 1, 1, 1_000_000_000),
    conditions
  };
}

function isLegacyWotTankRule(rule) {
  return rule?.mode === "overlap" && rule?.missing === "penalize" && Number(rule?.weight) === 4;
}

function migrateProfileOverride(category, builtin, override) {
  if (!override || typeof override !== "object" || Array.isArray(override) || !Object.keys(override).length) return {};
  const version = Number(override.schemaVersion) || 0;
  if (version >= PROFILE_SCHEMA_VERSION) return override;
  const migrated = { ...override };
  // v1.0.5 introduced the volatile-asset blacklist. Bump every older profile
  // through normalization so a previously saved required clan emblem can never
  // survive as a hard analog filter.
  if (version < 6 && override.fields && typeof override.fields === "object") {
    migrated.fields = { ...override.fields };
  }
  if (version >= 3) {
    migrated.automatic ??= true;
    migrated.schemaVersion = PROFILE_SCHEMA_VERSION;
    return migrated;
  }
  const fields = override.fields && typeof override.fields === "object" && !Array.isArray(override.fields)
    ? { ...override.fields }
    : null;
  const legacyWotFields = category === "world-of-tanks" && isLegacyWotTankRule(fields?.tanks);
  if (((version > 0 && version < 2) || legacyWotFields) && Number(migrated.minSimilarity) >= 0.85) migrated.minSimilarity = builtin.minSimilarity;
  if (legacyWotFields) {
    fields.tanks = { ...builtin.fields.tanks };
    migrated.fields = fields;
  }
  if (category === "world-of-tanks" && Array.isArray(override.fixedPriceRules)) {
    const rules = override.fixedPriceRules.map(rule => ({ ...rule }));
    const noTopsRule = builtin.fixedPriceRules.find(rule => rule.id === "wot-no-tops");
    if (noTopsRule && !rules.some(rule => rule?.id === noTopsRule.id)) rules.push(structuredClone(noTopsRule));
    migrated.fixedPriceRules = rules;
  }
  if (version < 4 && migrated.automatic === undefined) migrated.automatic = true;
  migrated.schemaVersion = PROFILE_SCHEMA_VERSION;
  return migrated;
}

export function normalizeCategoryProfile(categoryValue, override = {}) {
  const category = canonicalCategory(categoryValue);
  const builtin = BUILTIN_PROFILES[category] ?? genericProfile(category);
  override = migrateProfileOverride(category, builtin, override);
  const legacy = resolveProfile(category);
  const sourceFields = override?.fields && typeof override.fields === "object" ? override.fields : {};
  const fieldNames = override?.automaticResolved === true || override?.automatic === false
    ? new Set(Object.keys(sourceFields))
    : new Set([...Object.keys(builtin.fields), ...Object.keys(sourceFields)]);
  const fields = {};
  for (const fieldName of [...fieldNames].slice(0, 200)) {
    if (!FIELD_NAME.test(fieldName) || !isPricingAttributeKey(fieldName)) continue;
    const fallback = builtin.fields[fieldName] ?? { label: legacy.labels?.[fieldName] ?? fieldName.replaceAll("_", " "), mode: "similarity", weight: legacy.weights?.[fieldName] ?? 1, missing: "penalize" };
    const normalized = normalizedField(sourceFields[fieldName], fallback);
    // Defensive layer: listing-metadata fields (e.g. edit_date) must never hard-filter
    // analogs, even if they arrive as required from an older localStorage profile.
    fields[fieldName] = isListingMetaField(fieldName)
      ? { ...normalized, mode: "ignore", weight: 0, missing: "ignore", required: false, search: false }
      : normalized;
  }
  const rulesSource = Array.isArray(override?.fixedPriceRules) ? override.fixedPriceRules : builtin.fixedPriceRules;
  const minAnalogs = Math.round(clampNumber(override?.minAnalogs, builtin.minAnalogs, 1, 20));
  const maxAnalogs = Math.max(minAnalogs, Math.round(clampNumber(override?.maxAnalogs, builtin.maxAnalogs, 1, 20)));
  const priceMin = override?.priceMin === null || override?.priceMin === "" || override?.priceMin === undefined
    ? builtin.priceMin ?? null
    : clampNumber(override.priceMin, null, 1, 1_000_000_000);
  const requestedMaximum = override?.priceMax === null || override?.priceMax === "" || override?.priceMax === undefined
    ? builtin.priceMax ?? null
    : clampNumber(override.priceMax, null, 1, 1_000_000_000);
  const priceMax = priceMin && requestedMaximum ? Math.max(priceMin, requestedMaximum) : requestedMaximum;
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    category,
    name: safeText(override?.name, builtin.name, 120),
    automatic: safeBoolean(override?.automatic, builtin.automatic ?? true),
    automaticResolved: override?.automaticResolved === true,
    strategy: STRATEGIES.has(override?.strategy) ? override.strategy : builtin.strategy,
    discountPercent: override?.discountPercent === null || override?.discountPercent === "" || override?.discountPercent === undefined
      ? null
      : clampNumber(override.discountPercent, 0, 0, 99),
    activeEstimator: ACTIVE_ESTIMATORS.has(override?.activeEstimator) ? override.activeEstimator : builtin.activeEstimator,
    minSimilarity: clampNumber(override?.minSimilarity, builtin.minSimilarity, 0, 1),
    minAnalogs,
    maxAnalogs,
    manualThreshold: clampNumber(override?.manualThreshold, builtin.manualThreshold, 0, 1),
    similarityWindow: clampNumber(override?.similarityWindow, builtin.similarityWindow, 0, 0.5),
    allowCategoryFallback: safeBoolean(override?.allowCategoryFallback, builtin.allowCategoryFallback),
    priceMultiplier: clampNumber(override?.priceMultiplier, builtin.priceMultiplier, 1, 1_000),
    filterPriceOutliers: safeBoolean(override?.filterPriceOutliers, builtin.filterPriceOutliers ?? true),
    priceOutlierRatio: clampNumber(override?.priceOutlierRatio, builtin.priceOutlierRatio ?? 6, 2, 100),
    priceMin,
    priceMax,
    useUnconfiguredFields: safeBoolean(override?.useUnconfiguredFields, builtin.useUnconfiguredFields),
    calibration: normalizedCalibration(override?.calibration),
    autoSelectedFields: Array.isArray(override?.autoSelectedFields)
      ? override.autoSelectedFields.map(String).filter(field => FIELD_NAME.test(field) && isPricingAttributeKey(field)).slice(0, 20)
      : [],
    fields,
    fixedPriceRules: rulesSource.map(normalizedFixedRule).filter(Boolean).slice(0, 30)
  };
}

export function profileFromSettings(categoryValue, profiles = {}) {
  const category = canonicalCategory(categoryValue);
  const override = profiles && typeof profiles === "object" ? profiles[category] ?? profiles[categoryValue] : undefined;
  return normalizeCategoryProfile(category, override);
}

export function builtinProfileCatalog() {
  return Object.fromEntries(Object.keys(BUILTIN_PROFILES).map(category => [category, normalizeCategoryProfile(category)]));
}

function comparableValue(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

function equalValues(left, right) {
  if (left === right) return true;
  const booleanValue = value => {
    if (typeof value === "boolean") return value;
    const text = String(value ?? "").trim().toLowerCase();
    if (["true", "yes", "1", "да"].includes(text)) return true;
    if (["false", "no", "0", "нет"].includes(text)) return false;
    return null;
  };
  if (typeof left === "boolean" || typeof right === "boolean") {
    const leftBoolean = booleanValue(left);
    const rightBoolean = booleanValue(right);
    return leftBoolean !== null && rightBoolean !== null && leftBoolean === rightBoolean;
  }
  if ([left, right].some(value => value === "" || value === null || value === undefined)) return false;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
}

function matchesCondition(attributes, condition) {
  const value = attributes?.[condition.field];
  const left = comparableValue(value);
  const right = comparableValue(condition.value);
  const rightTo = comparableValue(condition.valueTo);
  if (condition.operator === "present") return value !== undefined && value !== null && value !== "";
  if (condition.operator === "missing") return value === undefined || value === null || value === "";
  if (condition.operator === "contains") {
    if (Array.isArray(value)) return value.map(comparableValue).some(entry => equalValues(entry, right));
    return String(left ?? "").includes(String(right ?? ""));
  }
  if (condition.operator === "eq") return equalValues(left, right);
  if (condition.operator === "neq") return !equalValues(left, right);
  const number = Number(left); const expected = Number(right); const expectedTo = Number(rightTo);
  if (![number, expected].every(Number.isFinite)) return false;
  if (condition.operator === "gt") return number > expected;
  if (condition.operator === "gte") return number >= expected;
  if (condition.operator === "lt") return number < expected;
  if (condition.operator === "lte") return number <= expected;
  return condition.operator === "between" && Number.isFinite(expectedTo) && number >= Math.min(expected, expectedTo) && number <= Math.max(expected, expectedTo);
}

export function matchingFixedPriceRule(attributes, profile) {
  return profile.fixedPriceRules.find(rule => rule.enabled && rule.conditions.every(condition => matchesCondition(attributes, condition))) ?? null;
}
