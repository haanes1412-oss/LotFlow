import test from "node:test";
import assert from "node:assert/strict";
import { isListingMetaField, neutralizeMetaFields, LISTING_META_KEYS } from "../public/listing-meta.js";

test("listing metadata fields are detected across categories", () => {
  for (const key of ["edit_date", "publish_date", "price", "view_count", "favorite_count", "max_discount_percent", "is_ignored", "is_overpriced", "sold_at", "pending_deletion_date", "tags", "seo_title", "emblem", "background_color"]) {
    assert.equal(isListingMetaField(key), true, `${key} should be listing meta`);
  }
});

test("date and price heuristics catch unknown listing fields", () => {
  assert.equal(isListingMetaField("some_new_at"), true);
  assert.equal(isListingMetaField("published_on_date"), true);
  assert.equal(isListingMetaField("resale_price"), true);
  assert.equal(isListingMetaField("weird_field", { type: "meta" }), true);
  assert.equal(isListingMetaField("weird_field", { category: "listing" }), true);
});

test("account properties are never treated as listing metadata", () => {
  for (const key of ["gold", "tanks", "region", "origin", "battles", "account_links", "account_last_activity", "email_access", "followers_count", "following_count", "video_count", "spam_block", "adventure_rank", "hypixel_level"]) {
    assert.equal(isListingMetaField(key), false, `${key} should not be listing meta`);
  }
});

test("camelCase keys normalize before matching", () => {
  assert.equal(isListingMetaField("editDate"), true);
  assert.equal(isListingMetaField("maxDiscountPercent"), true);
});

test("neutralizeMetaFields forces meta to ignore and leaves account fields intact", () => {
  const { fields, changed } = neutralizeMetaFields({
    edit_date: { mode: "range", weight: 4, required: true, missing: "reject" },
    account_last_activity: { mode: "range", weight: 3, required: true, missing: "reject" }
  });
  assert.equal(changed, true);
  assert.equal(fields.edit_date.mode, "ignore");
  assert.equal(fields.edit_date.weight, 0);
  assert.equal(fields.edit_date.required, false);
  assert.equal(fields.account_last_activity.mode, "range");
  assert.equal(fields.account_last_activity.required, true);
  assert.ok(LISTING_META_KEYS.has("edit_date"));
});
