// Universal listing-metadata detection.
//
// A field is "listing meta" when it describes the LISTING (the advertisement)
// rather than a property of the ACCOUNT being sold. "What is a property of the
// listing vs. of the account" is schema architecture shared across all 24 market
// categories, so hiding these fields from valuation encodes NO category-specific
// ("niche") knowledge and does not violate the universality principle.
//
// Kept DOM-free so both the browser (public/) and Node modules (src/) can import
// it from a single source of truth.

export const LISTING_META_KEYS = new Set([
  // explicit cross-category blacklist
  "edit_date", "publish_date", "published_date", "price", "price_currency",
  "item_state", "is_sticky", "is_pinned", "view_count", "favorite_count",
  "activated_at", "deleted_at", "sold_at", "escrow_hours", "guarantee",
  "countdown_at", "item_domain", "item_url", "seo_title", "priority",
  "tag", "tags", "is_default", "max_discount_percent", "pending_deletion_date",
  "min_amount", "user_allow_ask_discount", "is_ignored", "is_overpriced",
  "is_birthday_today", "is_collectible", "for_owned_accounts_only",
  // obvious listing identity / bookkeeping seen across steam/telegram/tiktok/mihoyo/minecraft
  "title", "title_en", "name", "short_name", "description", "information", "comment",
  // Volatile presentation / identity assets. Exact URLs are unique per clan or
  // account and therefore cannot describe market comparability.
  "emblem", "background_color",
  "refreshed_date", "update_stat_date", "created_at", "updated_at", "bumped_at",
  "refreshed_at", "nsb", "old_price", "buy_price", "auto_buy_price", "future_price",
  "extended_guarantee", "allow_ask_discount", "is_reserved"
]);

// Name heuristics: words and suffixes that reliably indicate listing metadata.
const META_NAME_WORD = /(?:^|_)(?:price|view|views|favorite|favourite|sticky|pinned|ignored|overpriced|discount|refreshed|bumped|escrow|countdown|deletion|seo|domain|guarantee|warranty|publish|published|resale)(?:_|$)/i;
const META_SUFFIX = /_(?:at|date)$/i;

function normalizeKey(key) {
  return String(key ?? "")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

// A /params entry can optionally carry an explicit hint that a field is listing
// metadata. We check a few plausible shapes; if the API exposes none, the explicit
// blacklist and name heuristics still do the job.
function isMetaParam(param) {
  if (!param || typeof param !== "object") return false;
  const type = String(param.type ?? param.input ?? "").toLowerCase();
  const group = String(param.category ?? param.group ?? param.section ?? "").toLowerCase();
  if (type === "meta" || type === "listing") return true;
  if (group === "listing" || group === "meta" || group === "service") return true;
  return param.meta === true || param.listing === true;
}

export function isListingMetaField(field, param = null) {
  const key = normalizeKey(field);
  if (!key) return false;
  if (LISTING_META_KEYS.has(key)) return true;
  if (META_SUFFIX.test(key)) return true;
  if (META_NAME_WORD.test(key)) return true;
  return isMetaParam(param);
}

const IGNORED_META_RULE = { mode: "ignore", weight: 0, missing: "ignore", required: false, search: false };

// Force every listing-meta field in a profile's field map to "ignore" so it can
// never hard-filter analogs. Returns { fields, changed }.
export function neutralizeMetaFields(fields = {}) {
  const result = {};
  let changed = false;
  for (const [name, rule] of Object.entries(fields ?? {})) {
    if (isListingMetaField(name)) {
      const wasActive = rule && (rule.mode !== "ignore" || Number(rule.weight) > 0 || rule.required === true || rule.missing === "reject");
      result[name] = { ...(rule ?? {}), ...IGNORED_META_RULE };
      if (wasActive) changed = true;
    } else {
      result[name] = rule;
    }
  }
  return { fields: result, changed };
}
