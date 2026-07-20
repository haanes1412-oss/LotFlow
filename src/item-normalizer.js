import { canonicalCategory } from "./category-profiles.js";

const RESERVED = new Set(["item_id", "id", "title", "price", "currency", "category", "category_id", "category_name", "seller_id", "sellerId", "seller", "state", "item_state", "sold_at", "soldAt", "published_date", "url", "attributes", "raw"]);

function isMissing(value) {
  return value === undefined || value === null || value === "";
}

export function flattenAttributes(item) {
  const result = { ...item.attributes };
  if (Object.keys(result).length) return result;
  for (const [key, value] of Object.entries(item)) {
    if (!RESERVED.has(key) && (value === null || ["string", "number", "boolean"].includes(typeof value) || Array.isArray(value))) result[key] = value;
  }
  return result;
}

// Seller titles are the strongest human-curated signal of what an account is
// actually worth ("IS-7 | Type 71 | UDES 03 3 | 800 голды"). We strip the count
// phrases first, then keep the remaining meaningful tokens as a `tanks` token set
// so two whale accounts that share named premium/top tanks overlap, while an
// empty "123 Wargaming" lot shares nothing. This is a positive-only signal:
// analogs whose titles do not list tanks are simply skipped (missing: ignore),
// never penalized, so real seller-branded analogs are not thrown away.
const WOT_TITLE_STOPWORDS = new Set([
  "wargaming", "wg", "wot", "world", "of", "tanks", "tank", "мир", "танков", "танки", "танк",
  "аккаунт", "акк", "account", "acc", "регион", "region", "россия", "рф", "ru", "eu", "na",
  "asia", "cis", "снг", "европа", "america", "сервер", "server", "почта", "mail", "email",
  "доступ", "access", "без", "нет", "есть", "привязка", "привязки", "почты", "почте",
  "голд", "голды", "голда", "gold", "золото", "золота", "серебро", "сер", "silver",
  "млн", "млрд", "kk", "kkk", "кк", "ккк", "прем", "према", "премов", "премиум",
  "премиумных", "premium", "prem", "prems", "топ", "топа", "топов", "top", "tops",
  "бои", "боёв", "боев", "battles", "battle", "гараж", "garage", "ветка", "ветки", "база",
  "base", "and", "the", "for", "на", "и", "с", "до", "от", "по", "или", "x", "х", "шт", "дн",
  "blitz", "wotblitz", "блиц", "бліц"
]);

function normalizeTankToken(token) {
  return String(token ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function extractWotTanks(title) {
  const text = String(title ?? "");
  // Remove explicit count phrases so "20 топ 50", "4 прем", "800 голды",
  // "5.5млн сер", "294д" never leak into the tank token set.
  const withoutCounts = text
    .replace(/\d+[.,]?\d*\s*(?:млн|млрд|kk?k?|кк?к?)?\s*(?:голд\w*|золот\w*|серебр\w*|сер\b|silver|прем\w*|prem\w*|топ\w*|top\w*|бо[ёе]в?|battles?|дн\w*)/giu, " ")
    .replace(/\b(?:топ|top|прем|prem)\w*\s*\d*/giu, " ")
    .replace(/\b\d+\s*[дd]\b/giu, " ");
  const tanks = new Set();
  for (const token of withoutCounts.split(/[\s|/,;•·]+/u)) {
    const normalized = normalizeTankToken(token);
    if (!normalized || WOT_TITLE_STOPWORDS.has(normalized)) continue;
    if (/^\d/.test(normalized) || normalized.length < 2) continue;
    tanks.add(normalized);
  }
  return [...tanks].slice(0, 16);
}

export function extractWotSilver(title) {
  const match = String(title ?? "").match(/(\d+(?:[.,]\d+)?)\s*(млрд|млн|kk+|кк+|k|к)?\s*(?:сер(?:ебро|ебра|еб)?|silver)(?![\p{L}])/iu);
  if (!match) return undefined;
  const amount = parseFloat(String(match[1]).replace(",", "."));
  if (!Number.isFinite(amount)) return undefined;
  const unit = String(match[2] ?? "").toLowerCase();
  const multiplier = unit === "млрд" ? 1_000_000_000
    : unit === "млн" || unit.startsWith("kk") || unit.startsWith("кк") ? 1_000_000
    : unit === "k" || unit === "к" ? 1_000
    : 1;
  return Math.round(amount * multiplier);
}

function inferTitleAttributes(category, title) {
  if (category !== "world-of-tanks") return {};
  const text = String(title ?? "");
  const isBlitz = /(?:\bwot\s*)?\bblitz\b|\bблиц\b|\bбліц\b/iu.test(text);
  const numberBefore = label => text.match(new RegExp(`(\\d+)\\s*(?:${label})`, "iu"));
  const numberAfter = (label, suffix = "") => text.match(new RegExp(`(?:${label})${suffix}\\s*[:=\\-/|]?\\s*(\\d+)`, "iu"));
  const numericValue = match => match ? Number(match[1]) : undefined;
  const topLabel = "топ(?:а|ов)?|top(?:s)?";
  const premiumLabel = "прем(?:а|ов|иум(?:а|ов|н(?:ых|ые)?)?)?|prem(?:ium)?(?:s)?";
  const goldLabel = "��олд(?:ы|а)?|золот(?:а|о)?|gold";
  const top = numericValue(numberBefore(topLabel) ?? numberAfter(topLabel));
  const premiumAfterTankLabel = numberAfter(premiumLabel, "\\s+танк\\w*");
  const premium = numericValue(premiumAfterTankLabel ?? numberBefore(premiumLabel) ?? numberAfter(premiumLabel));
  const gold = numericValue(numberBefore(goldLabel) ?? numberAfter(goldLabel));
  const noEmail = /(?:без|нет)\s+доступа\s+к\s+почте/iu.test(text);
  const hasEmail = !noEmail && /доступ\s+к\s+почте/iu.test(text);
  const tanks = extractWotTanks(text);
  const silver = extractWotSilver(text);
  return {
    wot_blitz: isBlitz ? 1 : 0,
    ...(top !== undefined ? { top_count: top } : {}),
    ...(premium !== undefined ? { premium_count: premium } : {}),
    ...(gold !== undefined ? { gold } : {}),
    ...(silver !== undefined ? { silver } : {}),
    ...(tanks.length ? { tanks } : {}),
    ...(noEmail || hasEmail ? { email_access: hasEmail } : {})
  };
}

function normalizeEmailAccess(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["no", "none", "no_market", "false", "0", "без доступа к почте"].includes(normalized)) return false;
  if (["yes", "true", "1", "native", "autoreg"].includes(normalized)) return true;
  return value;
}

export function normalizeItem(item) {
  if (item?.raw && item?.attributes && item?.id && item?.category) return item;
  const category = canonicalCategory(item.category_name ?? item.category ?? item.category_id);
  const attributes = flattenAttributes(item);
  for (const [key, value] of Object.entries(inferTitleAttributes(category, item.title))) if (isMissing(attributes[key])) attributes[key] = value;
  if (category === "world-of-tanks" && isMissing(attributes.top_count) && (!isMissing(attributes.premium_count) || !isMissing(attributes.gold))) attributes.top_count = 0;
  if (!isMissing(attributes.email_access)) attributes.email_access = normalizeEmailAccess(attributes.email_access);
  const origin = item.item_origin ?? item.origin ?? attributes.origin;
  if (!isMissing(origin) && isMissing(attributes.origin)) attributes.origin = String(origin);
  return {
    id: String(item.item_id ?? item.id),
    title: item.title ?? `Лот ${item.item_id ?? item.id}`,
    price: Number(item.price) || 0,
    currency: String(item.currency ?? "rub").toLowerCase(),
    category,
    sellerId: String(item.seller_id ?? item.seller?.user_id ?? ""),
    state: item.item_state ?? item.state ?? "active",
    soldAt: Number(item.sold_at ?? item.soldAt ?? item.sold_date ?? item.sale_date ?? item.paid_date ?? 0),
    url: item.url ?? `https://lzt.market/${item.item_id ?? item.id}/`,
    attributes,
    raw: item
  };
}
