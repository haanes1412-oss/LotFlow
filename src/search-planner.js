import { tiktokBucket } from "./category-profiles.js";
import { ATTRIBUTE_ALIASES } from "./api-normalizer.js";

function numericBucket(value, boundaries) {
  const number = Number(value) || 0; let lower = boundaries[0];
  for (const upper of boundaries.slice(1)) { if (number < upper) return [lower, upper]; lower = upper; }
  return [lower, Infinity];
}

function rangeQuery(prefix, [min, max]) {
  return { [`${prefix}_min`]: min, ...(Number.isFinite(max) ? { [`${prefix}_max`]: Math.max(min, max - 1) } : {}) };
}

function yesNo(value) {
  if (typeof value !== "boolean") return undefined;
  return value ? "yes" : "no";
}

function schemaParams(field, schema) {
  const aliases = new Set([field, ...(ATTRIBUTE_ALIASES[field] ?? [])]);
  return schema.filter(param => aliases.has(param.name) || aliases.has(param.base));
}

function rangeFor(value, rule) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (rule.mode === "bucket" && rule.buckets?.length) {
    const boundaries = [...rule.buckets].map(Number).filter(Number.isFinite).sort((left, right) => left - right);
    let lower = 0;
    for (const upper of boundaries) {
      if (number < upper) return [lower, Math.max(lower, upper - 1)];
      lower = upper;
    }
    return [lower, Infinity];
  }
  const tolerance = Math.max(Number(rule.toleranceAbsolute) || 0, Math.abs(number) * (Number(rule.tolerancePercent) || 0) / 100);
  return [Math.max(0, Math.floor(number - tolerance)), Math.ceil(number + tolerance)];
}

function addProfileFilter(query, field, value, rule, schema) {
  if (value === undefined || value === null || value === "" || rule.mode === "ignore") return false;
  const params = schemaParams(field, schema);
  if (!params.length) return false;
  const minimum = params.find(param => /min(?:\[\])?$/i.test(param.name));
  const maximum = params.find(param => /max(?:\[\])?$/i.test(param.name));
  const exact = params.find(param => param !== minimum && param !== maximum);
  if (["range", "bucket", "similarity"].includes(rule.mode) && (minimum || maximum) && Number.isFinite(Number(value))) {
    const range = rangeFor(value, rule);
    if (!range) return false;
    if (minimum) query[minimum.name] = range[0];
    if (maximum && Number.isFinite(range[1])) query[maximum.name] = range[1];
    return true;
  }
  if (rule.mode === "overlap" && exact && Array.isArray(value) && rule.preferredValues?.length) {
    const preferred = new Set(rule.preferredValues.map(entry => String(entry).trim().toLowerCase()).filter(Boolean));
    const selected = value.filter(entry => preferred.has(String(entry).trim().toLowerCase())).slice(0, 5);
    if (!selected.length) return false;
    query[exact.name] = exact.name.endsWith("[]") ? selected : selected[0];
    return true;
  }
  if (rule.mode !== "exact") return false;
  const normalized = yesNo(value) ?? value;
  if (exact) query[exact.name] = exact.name.endsWith("[]") && !Array.isArray(normalized) ? [normalized] : normalized;
  else {
    if (minimum) query[minimum.name] = normalized;
    if (maximum) query[maximum.name] = normalized;
  }
  return Boolean(exact || minimum || maximum);
}

function configuredProfileFilter(target, profile, schema, excluded = new Set(), maximumFields = 2) {
  const query = {};
  let used = 0;
  const configured = Object.entries(profile?.fields ?? {})
    .filter(([field, rule]) => !excluded.has(field) && rule.search !== false && rule.weight > 0 && ["exact", "range", "bucket", "similarity", "overlap"].includes(rule.mode))
    .sort(([, left], [, right]) => right.weight - left.weight);
  for (const [field, rule] of configured) {
    if (used >= maximumFields) break;
    if (addProfileFilter(query, field, target.attributes?.[field], rule, schema)) used += 1;
  }
  return query;
}

function uniquePlans(plans, maxPlans) {
  const result = []; const seen = new Set();
  for (const plan of plans) {
    const key = JSON.stringify(plan);
    if (seen.has(key)) continue;
    seen.add(key); result.push(plan);
    if (result.length >= maxPlans) break;
  }
  return result;
}

function orderedPlans(groups, base, maxPlans, { includeBroad = true, strictGroups = [], includeExpensive = false } = {}) {
  const recent = groups.map(group => ({ ...base, ...group, order_by: "pdate_to_down" }));
  const broad = includeBroad ? [
    { ...base, order_by: "pdate_to_down" },
    { ...base, order_by: "price_to_up" }
  ] : [];
  // Official Market API supports price_to_down. Sampling only newest and
  // cheapest lots makes high-value garages invisible in a large category,
  // even when the target has many tops, premiums, gold or silver.
  const expensive = groups.map(group => ({ ...base, ...group, order_by: "price_to_down" }));
  const cheap = groups.map(group => ({ ...base, ...group, order_by: "price_to_up" }));
  const strict = strictGroups.flatMap(group => [
    { ...base, ...group, order_by: "pdate_to_down" },
    { ...base, ...group, order_by: "price_to_up" }
  ]);
  if (maxPlans <= broad.length) return uniquePlans([...recent, ...broad], maxPlans);
  const reserve = includeBroad ? broad.length : 0;
  return uniquePlans([
    ...recent.slice(0, Math.max(0, maxPlans - reserve)),
    ...broad,
    ...recent.slice(Math.max(0, maxPlans - reserve)),
    ...(includeExpensive ? expensive : []),
    ...cheap,
    ...strict
  ], maxPlans);
}

function genericProfilePlans(targets, profile, schema, maxPlans, base) {
  // Even a brand-new category without a published parameter schema gets two
  // independent market views. A single cheapest page is too easy to poison
  // with placeholders; recent listings provide the counter-sample.
  if (!profile || !schema.length) return orderedPlans([], base, maxPlans);
  const counts = new Map();
  for (const target of targets) {
    const query = configuredProfileFilter(target, profile, schema);
    if (!Object.keys(query).length) continue;
    const key = JSON.stringify(query); const current = counts.get(key);
    counts.set(key, current ? { ...current, count: current.count + 1 } : { query, count: 1 });
  }
  const unique = [...counts.values()].sort((left, right) => right.count - left.count).map(entry => entry.query);
  if (!unique.length) return orderedPlans([], base, maxPlans);
  const relaxed = targets.map(target => configuredProfileFilter(target, profile, schema, new Set(), 1))
    .filter(query => Object.keys(query).length);
  const relaxedUnique = [...new Map(relaxed.map(query => [JSON.stringify(query), query])).values()];
  return orderedPlans(unique, base, maxPlans, { strictGroups: relaxedUnique });
}

function profileWithInferredFields(targets, profile, schema) {
  // A saved manual profile is the seller's explicit contract. Re-introducing
  // ignored fields here would make the API search disagree with the builder.
  if (profile?.automatic === false) return profile;
  if (!schema.length) return profile;
  const fields = { ...profile?.fields };
  const names = new Set(targets.flatMap(target => Object.keys(target.attributes ?? {})));
  const inferred = [];
  for (const field of names) {
    if (fields[field]?.mode && fields[field].mode !== "ignore") continue;
    const params = schemaParams(field, schema);
    if (!params.length) continue;
    const values = targets.map(target => target.attributes?.[field]).filter(value => value !== undefined && value !== null && value !== "");
    if (!values.length) continue;
    const distinct = new Set(values.map(value => JSON.stringify(value))).size;
    const sample = values[0];
    const hasRange = params.some(param => /(?:_min|_max|min|max)(?:\[\])?$/i.test(param.name));
    const numeric = values.every(value => Number.isFinite(Number(value)));
    const exact = typeof sample === "boolean" || distinct <= 12;
    if (!(numeric && hasRange) && !exact) continue;
    inferred.push({
      field,
      coverage: values.length / targets.length,
      rule: numeric && hasRange
        ? { mode: "range", weight: 1.5, missing: "ignore", search: true, tolerancePercent: 30, toleranceAbsolute: 1 }
        : { mode: "exact", weight: 1.5, missing: "ignore", search: true, tolerancePercent: 0, toleranceAbsolute: 0 }
    });
  }
  for (const entry of inferred.sort((left, right) => right.coverage - left.coverage).slice(0, 6)) fields[entry.field] = entry.rule;
  return { ...profile, fields };
}

export function buildSearchPlans(categoryName, targets, maxPlans = 20, options = {}) {
  const base = { parse_same_item_ids: true, order_by: "price_to_up" };
  const profile = profileWithInferredFields(targets, options.profile, options.schema ?? []);
  const searchEnabled = field => {
    const rule = profile?.fields?.[field];
    if (profile?.automatic === false) return Boolean(rule && rule.mode !== "ignore" && rule.weight > 0 && rule.search !== false);
    return rule?.search !== false;
  };
  if (categoryName === "tiktok") {
    const buckets = new Map();
    for (const item of targets) {
      const bucket = searchEnabled("followers") ? tiktokBucket(item.attributes?.followers) : null;
      const cookies = searchEnabled("cookie_login") ? yesNo(item.attributes?.cookie_login) : undefined;
      const extra = configuredProfileFilter(item, profile, options.schema ?? [], new Set(["followers", "cookie_login"]));
      const key = `${bucket?.join("-") ?? "any"}|${cookies ?? "any"}|${JSON.stringify(extra)}`;
      const existing = buckets.get(key);
      buckets.set(key, existing ? { ...existing, count: existing.count + 1 } : { bucket, cookies, extra, count: 1 });
    }
    const groups = [...buckets.values()].sort((left, right) => right.count - left.count).map(({ bucket, cookies, extra }) => ({
      ...(bucket ? { followers_min: bucket[0] } : {}),
      ...(bucket && Number.isFinite(bucket[1]) ? { followers_max: bucket[1] - 1 } : {}),
      ...(cookies ? { cookies } : {}),
      ...extra
    }));
    return orderedPlans(groups, base, maxPlans);
  }
  if (categoryName === "world-of-tanks") {
    const clusters = new Map(); const strictClusters = new Map();
    for (const item of targets) {
      const top = searchEnabled("top_count") ? numericBucket(item.attributes?.top_count, [0, 1, 6, 16, 31, 61, Infinity]) : null;
      const premium = searchEnabled("premium_count") ? numericBucket(item.attributes?.premium_count, [0, 1, 4, 11, 31, 61, 101, Infinity]) : null;
      const region = searchEnabled("region") ? item.attributes?.region : undefined;
      const extra = configuredProfileFilter(item, profile, options.schema ?? [], new Set(["top_count", "premium_count", "region"]));
      const key = `${top?.join("-") ?? "any"}|${region ?? "any"}|${JSON.stringify(extra)}`;
      const existing = clusters.get(key);
      clusters.set(key, existing ? { ...existing, count: existing.count + 1 } : { top, region, extra, count: 1 });
      const strictKey = `${key}|${premium?.join("-") ?? "any"}`;
      const strictExisting = strictClusters.get(strictKey);
      strictClusters.set(strictKey, strictExisting ? { ...strictExisting, count: strictExisting.count + 1 } : { top, premium, region, extra, count: 1 });
    }
    const groups = [...clusters.values()].sort((a, b) => b.count - a.count);
    const strictGroups = [...strictClusters.values()].sort((a, b) => b.count - a.count);
    const filters = ({ top, premium, region, extra }) => ({
      ...(top ? rangeQuery("top", top) : {}),
      ...(premium ? rangeQuery("prem", premium) : {}),
      ...(region ? { "region[]": [region] } : {}),
      ...extra
    });
    // Top count and region define a sufficiently broad first pass. Premium
    // count and every other numeric field remain ranking signals; otherwise a
    // large seller catalog creates dozens of one-item searches and no market.
    return orderedPlans(groups.map(filters), base, maxPlans, { strictGroups: strictGroups.map(filters), includeExpensive: true });
  }
  if (categoryName === "telegram") {
    const groups = new Map();
    for (const item of targets) {
      const spam = searchEnabled("spam_block") ? yesNo(item.attributes?.spam_block) : undefined;
      const country = searchEnabled("country") ? item.attributes?.country : undefined;
      const daybreak = Math.max(0, Number(item.attributes?.inactivity_days) || 0);
      const range = searchEnabled("inactivity_days") ? numericBucket(daybreak, [0, 3, 7, 14, 30, Infinity]) : null;
      const extra = configuredProfileFilter(item, profile, options.schema ?? [], new Set(["inactivity_days", "spam_block", "country"]));
      const key = `${range?.join("-") ?? "any"}|${spam ?? "any"}|${country ?? "any"}|${JSON.stringify(extra)}`;
      const existing = groups.get(key);
      groups.set(key, existing ? { ...existing, count: existing.count + 1 } : { range, spam, country, extra, count: 1 });
    }
    const filters = [...groups.values()].sort((left, right) => right.count - left.count).map(({ range, spam, country, extra }) => ({
      ...(range ? { daybreak: range[0] } : {}),
      ...(spam ? { spam } : {}),
      ...(country ? { "country[]": [country] } : {}),
      ...extra
    }));
    return orderedPlans(filters, base, maxPlans);
  }
  return genericProfilePlans(targets, profile, options.schema ?? [], maxPlans, base);
}
