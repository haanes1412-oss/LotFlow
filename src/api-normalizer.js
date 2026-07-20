const META_FIELDS = new Set([
  "item_id", "id", "title", "title_en", "description", "information", "price", "currency",
  "category_id", "category_name", "category", "item_state", "state", "seller", "seller_id",
  "published_date", "refreshed_date", "update_stat_date", "view_count", "url", "item_origin", "origin",
  "sold_at", "sold_date", "sale_date", "paid_date", "same_items", "same_item_ids", "same_item_id", "history", "sales", "requested_item_id"
]);

const SAFE_ATTRIBUTE_EXCEPTIONS = new Set([
  "cookie_login", "email_access", "email_type", "email_provider", "phone_linked", "sessions", "origin"
]);
const SENSITIVE_ATTRIBUTE = /(?:^|_)(?:passwords?|passwd|pass|login|email|mail|phone|telephone|tel|token|secret|cookies?|sessions?|auth|proxy|credential|information|username|note|raw|encoded|buyer|seller|contact|uid|(?:account|user|owner|seller|steam|telegram|discord|epic|device|profile|external|social|wot)_?id(?:64)?)(?:_|$)/i;
const LINK_OR_PAYLOAD_ATTRIBUTE = /(?:^|_)(?:full|link|url|href|html|plain)(?:_|$)/i;
const CONTACT_ATTRIBUTE = new Set(["contact", "discord", "github", "jabber", "matrix", "skype", "steam", "telegram", "viber", "vk", "whatsapp"]);
const SYSTEM_ATTRIBUTE = /^(?:allow_|auto_bump|auto_buy_price|can_|cannot_|category_|description|discount|fave|favorite_|feedback_|future_price|guarantee|extended_guarantee|image|in_cart|is_fave|is_personal|is_small|is_sticky|is_trusted|is_visible|item_|limit$|lzt_|market_custom|nsb$|old_price|price|public_tag|regional$|remaining$|reset$|resale_item|restore_items|same_item|show_|sold_items|unique_key|views_|visitor_)/i;
const LISTING_ATTRIBUTE = /(?:^|_)(?:allow|auto|bump|buy|cart|commission|created|date|discount|edit|fee|future|guarantee|market|offer|order|pdate|price|published|refreshed|remaining|resale|sale|seller|sold|sticky|updated|views?|warranty)(?:_|$)/i;

export const ATTRIBUTE_ALIASES = {
  followers: ["followers", "followers_count", "follower_count", "subscribers"],
  following: ["following", "following_count"], posts: ["posts", "post_count", "post_min", "post_max"],
  likes: ["likes", "like_count", "like_min", "like_max"], coins: ["coins", "coin_count"],
  cookie_login: ["cookie_login", "cookies"], live: ["live", "can_stream", "hasLivePermission", "has_live_permission"],
  email_access: ["email_access", "has_email_access", "has_email_login_data", "email_login_data", "email_type"],
  phone_linked: ["phone_linked", "tel", "has_phone", "phone_verified"], verified: ["verified", "verification"],
  top_count: ["top_count", "top", "top_tanks", "top_tanks_count", "wot_top", "wot_top_tanks"],
  premium_count: ["premium_count", "prem", "premium_tanks", "premium_tanks_count", "wot_prem", "wot_premium_tanks", "wotPremiumTankCount"],
  tanks: ["tanks", "tank", "wot_tanks", "wotTopTanks", "wotPremiumTanks"], gold: ["gold", "gold_count", "wot_gold"],
  silver: ["silver", "silver_count"], battles: ["battles", "battle_count", "wot_battle_count"], region: ["region", "server", "wot_region"],
  inactivity_days: ["inactivity_days", "daybreak", "last_activity_days"],
  spam_block: ["spam_block", "spam", "spam_ban", "is_spam"], scam: ["scam", "scam_badge"],
  capes: ["capes", "cape"], hypixel_level: ["hypixel_level", "level_hypixel"],
  hypixel_rank: ["hypixel_rank", "rank_hypixel"], hypixel_achievements: ["hypixel_achievements", "achievement_hypixel"],
  banned: ["banned", "ban", "is_banned"], email_relinked: ["email_relinked", "change_email", "email_changed"],
  games_count: ["games_count", "game_count", "gmin", "gmax"], level: ["level", "account_level", "lmin", "lmax"],
  inventory_value: ["inventory_value", "inv_value"], country: ["country", "tt_country", "locale"]
};

const STRUCTURED_ATTRIBUTE_KEYS = new Set(ATTRIBUTE_ALIASES.tanks);
const CANONICAL_ATTRIBUTES = new Set(Object.keys(ATTRIBUTE_ALIASES));

export function normalizeAttributeKey(key) {
  return String(key ?? "")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function isSafeAttributeKey(key) {
  const name = normalizeAttributeKey(key);
  if (!name) return false;
  return SAFE_ATTRIBUTE_EXCEPTIONS.has(name) || !SENSITIVE_ATTRIBUTE.test(name);
}

export function isSafeAttributeValue(key, value) {
  if (value === undefined) return false;
  if (value === null || ["number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(entry => isSafeAttributeValue(key, entry));
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return true;
  if (/(?:https?:\/\/|\/\/[^\s/]+\/)/i.test(text)) return false;
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text) || /%40|%3a/i.test(text)) return false;
  if (/^[^:\s]{2,100}:[^:\s]{2,100}$/.test(text)) return false;
  return text.length <= 1_000;
}

export function isPricingAttributeKey(key, schemaBases = new Set()) {
  const name = normalizeAttributeKey(key);
  if (!name || name.startsWith("_") || !isSafeAttributeKey(name)) return false;
  if (CANONICAL_ATTRIBUTES.has(name) || SAFE_ATTRIBUTE_EXCEPTIONS.has(name)) return true;
  if (META_FIELDS.has(name) || CONTACT_ATTRIBUTE.has(name) || LINK_OR_PAYLOAD_ATTRIBUTE.test(name)) return false;
  if (SYSTEM_ATTRIBUTE.test(name) || /(?:^|_)(?:check_date|seller_fee|item_id)(?:_|$)/i.test(name)) return false;
  if (/(?:^|_)price(?:_|$)/i.test(name)) return false;
  if (/(?:^|_)(?:id|label)$/i.test(name)) return false;
  if (schemaBases.has(name)) return true;
  return name.length >= 3;
}

export function isAutomaticPricingAttributeKey(key, schemaBases = new Set()) {
  const name = normalizeAttributeKey(key);
  if (!isPricingAttributeKey(name, schemaBases)) return false;
  if (CANONICAL_ATTRIBUTES.has(name) || SAFE_ATTRIBUTE_EXCEPTIONS.has(name)) return true;
  return !LISTING_ATTRIBUTE.test(name) && !/^(?:max|min|default)_.*(?:percent|discount|price)$/i.test(name);
}

function flattenObject(value, result = {}, depth = 0) {
  if (!value || typeof value !== "object" || depth > 2) return result;
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizeAttributeKey(key);
    if (!normalized || (SENSITIVE_ATTRIBUTE.test(normalized) && !SAFE_ATTRIBUTE_EXCEPTIONS.has(normalized))) continue;
    if (STRUCTURED_ATTRIBUTE_KEYS.has(key) && child && typeof child === "object") result[key] = child;
    else if (child === null || ["string", "number", "boolean"].includes(typeof child) || (Array.isArray(child) && child.every(x => ["string", "number", "boolean"].includes(typeof x)))) result[key] = child;
    else if (!Array.isArray(child) && !["seller"].includes(normalized)) flattenObject(child, result, depth + 1);
  }
  return result;
}

function baseParamName(name) {
  return String(name).replace(/\[\]$/, "").replace(/_(min|max)$/, "").replace(/^(not_)/, "").replace(/(min|max)$/, "");
}

export function categoryArray(response) {
  const value = Array.isArray(response) ? response : response?.categories ?? response?.category ?? response?.items ?? [];
  return Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
}

export function categoryMap(response) {
  return new Map(categoryArray(response).map(category => {
    const rawUrl = category.category_url ?? category.url;
    const slug = typeof rawUrl === "string" ? rawUrl.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+|\/+$/g, "") : undefined;
    return [String(category.category_id ?? category.id), slug || category.category_name || category.name];
  }).filter(([, name]) => name));
}

export function schemaFields(response) {
  const params = response?.params ?? [];
  return (Array.isArray(params) ? params : Object.values(params)).map(param => ({ name: param.name, base: baseParamName(param.name), description: param.description ?? param.title ?? param.name, input: param.input })).filter(field => field.name);
}

function lookup(flat, aliases) {
  for (const key of aliases) if (flat[key] !== undefined && flat[key] !== null && flat[key] !== "") return flat[key];
  return undefined;
}

function normalizeAttributeValue(name, value) {
  if (["top_count", "premium_count", "gold", "silver", "battles", "followers", "inactivity_days"].includes(name)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (name !== "tanks") return value;
  const entries = Array.isArray(value) ? value : value && typeof value === "object" ? Object.entries(value).map(([key, child]) => {
    if (/^\d+$/.test(key)) return key;
    return child;
  }) : [value];
  return entries.flatMap(entry => {
    if (entry === undefined || entry === null || entry === "") return [];
    if (typeof entry !== "object") return [String(entry)];
    const id = entry.tank_id ?? entry.vehicle_id ?? entry.id ?? entry.value;
    const label = entry.name ?? entry.title ?? entry.label;
    return id !== undefined ? [String(id)] : label ? [String(label)] : [];
  });
}

export function extractAttributes(item, schema = []) {
  const flat = flattenObject(item);
  const attributes = {};
  const schemaBases = new Set(schema.flatMap(field => [field.base, field.name.replace(/\[\]$/, "")]).map(normalizeAttributeKey));
  for (const [canonical, aliases] of Object.entries(ATTRIBUTE_ALIASES)) {
    const relevant = !schema.length || aliases.some(alias => schemaBases.has(normalizeAttributeKey(baseParamName(alias)))) || aliases.some(alias => flat[alias] !== undefined);
    if (!relevant) continue;
    const value = lookup(flat, aliases);
    const normalized = normalizeAttributeValue(canonical, value);
    if (value !== undefined && isSafeAttributeValue(canonical, normalized)) attributes[canonical] = normalized;
  }
  for (const field of schema) {
    const fieldBase = normalizeAttributeKey(field.base);
    const fieldName = normalizeAttributeKey(field.name.replace(/\[\]$/, ""));
    const canonicalOwner = Object.entries(ATTRIBUTE_ALIASES).find(([, aliases]) => aliases.some(alias => [fieldBase, fieldName].includes(normalizeAttributeKey(alias))));
    if (canonicalOwner && attributes[canonicalOwner[0]] !== undefined) continue;
    const value = lookup(flat, [field.base, field.name, field.name.replace(/\[\]$/, "")]);
    if (value !== undefined && attributes[fieldBase] === undefined && isPricingAttributeKey(fieldBase, schemaBases) && isSafeAttributeValue(fieldBase, value)) attributes[fieldBase] = value;
  }
  const aliases = new Set(Object.values(ATTRIBUTE_ALIASES).flat().map(normalizeAttributeKey));
  for (const [key, value] of Object.entries(flat)) {
    const normalized = normalizeAttributeKey(key);
    if (attributes[normalized] !== undefined || aliases.has(normalized) || !isPricingAttributeKey(normalized, schemaBases) || !isSafeAttributeValue(normalized, value)) continue;
    attributes[normalized] = value;
  }
  return attributes;
}

export function sameItemIds(items) {
  const ids = new Set();
  const historyKeys = new Set(["same_item_ids", "sameitemids", "same_items", "sameitems", "same_item_id", "sameitemid"]);
  const add = value => {
    if (Array.isArray(value)) return value.forEach(add);
    if (value && typeof value === "object") {
      const ownId = value.item_id ?? value.id;
      if (ownId !== undefined) return add(ownId);
      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === "object") {
          const size = ids.size;
          add(child);
          if (/^\d+$/.test(key) && ids.size === size) add(key);
        } else if (/^\d+$/.test(key) && child) add(key);
      }
      return;
    }
    if (typeof value === "string" && /[,;\s]/.test(value.trim())) return value.split(/[,;\s]+/).forEach(add);
    if (/^\d+$/.test(String(value ?? ""))) ids.add(String(value));
  };
  const visited = new WeakSet();
  const scan = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 5 || visited.has(value)) return;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (historyKeys.has(key.toLowerCase())) add(child);
      else if (child && typeof child === "object") scan(child, depth + 1);
    }
  };
  for (const item of items ?? []) {
    scan(item);
    for (const source of [item, item?.raw, item?.item, item?.data?.item]) {
      if (!source || typeof source !== "object") continue;
      for (const group of [source.same_item_ids, source.sameItemIds, source.same_items, source.sameItems, source.same_item_id, source.sameItemId]) add(group);
    }
  }
  return [...ids];
}

function saleTimestamp(value) {
  return Number(value?.sold_at ?? value?.sold_date ?? value?.sale_date ?? value?.paid_date ?? value?.date ?? 0);
}

function salePrice(value) {
  return Number(value?.sold_price ?? value?.sale_price ?? value?.price ?? value?.amount ?? 0);
}

export function prepareApiItem(item, { categories = new Map(), schema = [] } = {}) {
  const categoryId = item.category_id ?? item.category?.category_id;
  const categoryName = item.category_name ?? item.category?.category_name ?? item.category?.name ?? categories.get(String(categoryId)) ?? String(categoryId ?? item.category ?? "unknown");
  return { ...item, category_name: categoryName, attributes: extractAttributes(item, schema) };
}

export function expandItemsWithHistory(items, context = {}) {
  const output = [];
  for (const raw of items ?? []) {
    const item = prepareApiItem(raw, context);
    output.push(item);
    const groups = [raw.same_items, raw.sameItems, raw.history, raw.sales, raw.item_history, raw.sold_items].filter(Array.isArray);
    for (const group of groups) for (const sale of group) {
      const price = salePrice(sale);
      if (!price) continue;
      output.push(prepareApiItem({ ...raw, ...sale, item_id: sale.item_id ?? `${raw.item_id ?? raw.id}-sale-${saleTimestamp(sale) || output.length}`, price, item_state: "sold", sold_at: saleTimestamp(sale), same_items: undefined, history: undefined, sales: undefined }, context));
    }
  }
  return output;
}

export function unwrapResponseItem(value, fallbackId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  let item = value;
  if (value.item && typeof value.item === "object" && !Array.isArray(value.item)) {
    const { item: nested, ...wrapper } = value;
    item = { ...wrapper, ...nested };
  }
  if (/^\d+$/.test(String(fallbackId ?? ""))) {
    if (item.item_id === undefined && item.id === undefined) return { ...item, item_id: String(fallbackId), requested_item_id: String(fallbackId) };
    return { ...item, requested_item_id: String(fallbackId) };
  }
  return item;
}

export function responseItems(response) {
  const value = response?.items ?? response?.data?.items ?? response?.accounts ?? response?.data?.accounts;
  if (Array.isArray(value)) return value.map(item => unwrapResponseItem(item)).filter(Boolean);
  if (value && typeof value === "object") return Object.entries(value).map(([key, item]) => unwrapResponseItem(item, key)).filter(Boolean);
  const single = response?.item ?? response?.data?.item;
  if (single && typeof single === "object") return [unwrapResponseItem(single)];
  if (response && typeof response === "object" && (response.item_id !== undefined || response.id !== undefined)) return [unwrapResponseItem(response)];
  return [];
}

export function hasNextPage(response, collectedCount) {
  if (response?.hasNextPage === true || response?.has_next_page === true || response?.nextPageHref || response?.next_page_url) return true;
  const total = Number(response?.totalItems ?? response?.total_items ?? 0);
  if (total) return collectedCount < total;
  const perPage = Number(response?.perPage ?? response?.per_page ?? 0);
  return perPage > 0 && responseItems(response).length >= perPage;
}
