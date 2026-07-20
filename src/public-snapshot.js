import { isPricingAttributeKey, isSafeAttributeValue, sameItemIds } from "./api-normalizer.js";
import { normalizeItem } from "./pricing-engine.js";

export function safeAttributes(attributes = {}) {
  const result = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!isPricingAttributeKey(key) || !isSafeAttributeValue(key, value)) continue;
    if (key === "sessions" && typeof value !== "number" && typeof value !== "boolean") continue;
    if (key === "cookie_login" && !["boolean", "number"].includes(typeof value) && !/^(?:yes|no|true|false|0|1)$/i.test(String(value))) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) result[key] = value;
    else if (Array.isArray(value)) result[key] = value.filter(entry => (entry === null || ["string", "number", "boolean"].includes(typeof entry)) && isSafeAttributeValue(key, entry)).slice(0, 500);
  }
  return result;
}

export function publicItem(raw) {
  const item = normalizeItem(raw);
  const historyIds = sameItemIds([raw, item.raw]);
  return {
    item_id: item.id,
    id: item.id,
    title: item.title,
    price: item.price,
    currency: item.currency,
    category_name: item.category,
    category: item.category,
    seller_id: item.sellerId || undefined,
    item_state: item.state,
    state: item.state,
    sold_at: item.soldAt || undefined,
    url: item.url,
    item_origin: item.attributes?.origin,
    attributes: safeAttributes(item.attributes),
    ...(historyIds.length ? { same_item_ids: historyIds } : {})
  };
}

export function publicResult(result) {
  const publicComparison = analog => ({
    id: String(analog.id), title: analog.title, price: Number(analog.price) || 0, state: analog.state,
    soldAt: Number(analog.soldAt) || 0, similarity: Number(analog.similarity) || 0,
    ...(analog.rawSimilarity !== undefined ? { rawSimilarity: Number(analog.rawSimilarity) || 0 } : {}),
    ...(analog.reason ? { reason: String(analog.reason).slice(0, 240) } : {}),
    ...(Array.isArray(analog.differences) ? { differences: analog.differences.map(value => String(value).slice(0, 240)).slice(0, 4) } : {}),
    url: analog.url
  });
  return {
    ...result,
    item: publicItem(result.item),
    analogs: (result.analogs ?? []).map(publicComparison),
    nearMisses: (result.nearMisses ?? []).map(publicComparison)
  };
}
