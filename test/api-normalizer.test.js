import test from "node:test";
import assert from "node:assert/strict";
import { categoryMap, expandItemsWithHistory, extractAttributes, prepareApiItem, responseItems, sameItemIds, schemaFields } from "../src/api-normalizer.js";

test("dynamic category response maps ids to current slugs", () => {
  const map = categoryMap({ categories: [{ category_id: 14, category_name: "World of Tanks", category_url: "/wot/" }, { category_id: 20, category_name: "TikTok", category_url: "/tiktok/" }, { category_id: 99, category_name: "minecraft" }] });
  assert.equal(map.get("14"), "wot");
  assert.equal(map.get("20"), "tiktok");
  assert.equal(map.get("99"), "minecraft");
});

test("real-style category fields are mapped to canonical attributes", () => {
  const schema = schemaFields({ params: [{ name: "followers_min" }, { name: "cookie_login" }, { name: "can_stream" }] });
  assert.deepEqual(extractAttributes({ followers: 412, cookie_login: true, can_stream: true }, schema), { followers: 412, cookie_login: true, live: true });
  assert.deepEqual(extractAttributes({ top: 31, prem: 75, gold: 4000, tank: ["IS-7"] }), { top_count: 31, premium_count: 75, tanks: ["IS-7"], gold: 4000 });
  assert.deepEqual(extractAttributes({ spam: true, daybreak: 5 }), { inactivity_days: 5, spam_block: true });
  assert.deepEqual(extractAttributes({ email_type: "no" }), { email_access: "no" });
});

test("same item ids are collected for a bulk history lookup", () => {
  assert.deepEqual(sameItemIds([{ same_item_ids: [2, { item_id: 3 }, "bad"] }, { sameItemIds: [3, 4] }]), ["2", "3", "4"]);
});

test("same item ids support current and legacy response shapes", () => {
  assert.deepEqual(sameItemIds([
    { same_item_id: "7" },
    { same_items: { 8: true, 9: { price: 10 } } },
    { item: { sameItemIds: "10, 11" } },
    { raw: { sameItems: [{ id: 12 }] } }
  ]), ["7", "8", "9", "10", "11", "12"]);
});

test("same item ids are found inside nested bulk metadata", () => {
  assert.deepEqual(sameItemIds([{ data: { item: { extra: { same_item_ids: [21, 22] } } } }]), ["21", "22"]);
});

test("nested sales history becomes comparable sold items", () => {
  const items = expandItemsWithHistory([{ item_id: 1, category_id: 20, price: 10, followers: 1200, same_items: [{ item_id: 2, sold_price: 8, sold_date: 123 }] }], { categories: new Map([["20", "tiktok"]]) });
  assert.equal(items.length, 2);
  assert.equal(items[1].item_state, "sold");
  assert.equal(items[1].price, 8);
  assert.equal(items[1].sold_at, 123);
  assert.equal(prepareApiItem(items[1]).attributes.followers, 1200);
});

test("bulk responses unwrap nested item payloads and keyed ids", () => {
  const items = responseItems({ items: {
    101: { item: { title: "Nested", price: 50 }, same_item_ids: [90] },
    102: { item_id: 102, title: "Direct", price: 60 }
  } });
  assert.equal(items[0].item_id, "101");
  assert.equal(items[0].title, "Nested");
  assert.deepEqual(items[0].same_item_ids, [90]);
  assert.equal(items[1].item_id, 102);
  assert.equal(items[1].requested_item_id, "102");
});

test("nested canonical attributes are merged with aliases from the API payload", () => {
  assert.deepEqual(extractAttributes({ attributes: { region: "eu", top: "7" }, prem: "12" }), { top_count: 7, premium_count: 12, region: "eu" });
});

test("unknown safe category fields are retained without exposing credentials", () => {
  const attributes = extractAttributes({ top: 7, custom_rank: "diamond", seasonal_points: 412, email: "private@example.com", username: "private-user", access_token: "secret", steam_id64: "76561198000000000", account_id: "private-account" });
  assert.equal(attributes.top_count, 7);
  assert.equal(attributes.custom_rank, "diamond");
  assert.equal(attributes.seasonal_points, 412);
  assert.equal("email" in attributes, false);
  assert.equal("username" in attributes, false);
  assert.equal("access_token" in attributes, false);
  assert.equal("steam_id64" in attributes, false);
  assert.equal("account_id" in attributes, false);
});

test("service schema fields and credential-shaped values cannot enter pricing attributes", () => {
  const schema = schemaFields({ params: [
    { name: "seasonal_points_min" },
    { name: "account_link" },
    { name: "can_edit_item" },
    { name: "ai_price" }
  ] });
  const attributes = extractAttributes({
    seasonal_points: 412,
    wotGlobalRating: 9000,
    account_link: "https://example.test/account",
    can_edit_item: true,
    ai_price: 777,
    oldPassword: "sample-value",
    contact: "person@example.test",
    encodedRaw: "sample%3Avalue",
    harmless_label: "person@example.test:sample-value"
  }, schema);
  assert.equal(attributes.seasonal_points, 412);
  assert.equal(attributes.wot_global_rating, 9000);
  for (const field of ["account_link", "can_edit_item", "ai_price", "old_password", "contact", "encoded_raw", "harmless_label"]) assert.equal(field in attributes, false);
});

test("structured WoT tanks are normalized to stable ids", () => {
  const attributes = extractAttributes({ top: "10", prem: "20", tanks: { 101: "IS-7", 202: "Maus" } });
  assert.equal(attributes.top_count, 10);
  assert.equal(attributes.premium_count, 20);
  assert.deepEqual(attributes.tanks, ["101", "202"]);
});
