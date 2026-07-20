import test from "node:test";
import assert from "node:assert/strict";
import { buildFieldCatalog } from "../src/field-catalog.js";

test("field catalog explains coverage, types, examples and API filters", () => {
  const targets = [
    { id: 1, category: "future-game", attributes: { rank: 10, region: "eu", badges: ["rare"] } },
    { id: 2, category: "future-game", attributes: { rank: 12, region: "eu" } }
  ];
  const market = [
    { id: 3, category: "future-game", price: 50, attributes: { rank: 11, region: "eu", badges: ["rare", "old"] } },
    { id: 4, category: "future-game", price: 60, attributes: { rank: 14, region: "us" } }
  ];
  const schemas = { "future-game": [{ name: "rank_min", base: "rank", description: "Ранг" }, { name: "rank_max", base: "rank", description: "Ранг" }, { name: "region[]", base: "region", description: "Регион" }] };
  const fields = buildFieldCatalog(targets, market, schemas)["future-game"];
  const rank = fields.find(field => field.field === "rank");
  const badges = fields.find(field => field.field === "badges");
  assert.equal(rank.type, "number");
  assert.equal(rank.targetCoverage, 1);
  assert.equal(rank.marketCoverage, 1);
  assert.equal(rank.apiFilter, true);
  assert.equal(rank.suggestedRule.mode, "range");
  assert.equal(rank.suggestedRule.required, false);
  assert.equal(badges.type, "list");
  assert.equal(badges.suggestedRule.mode, "overlap");
  assert.equal(badges.suggestedRule.required, false);
  assert.deepEqual(badges.examples[0], ["rare"]);
});

test("automatic field suggestions ignore high-cardinality text identifiers", () => {
  const targets = Array.from({ length: 6 }, (_, index) => ({ id: `t-${index}`, category: "future-game", attributes: { shard: `target-${index}` } }));
  const market = Array.from({ length: 6 }, (_, index) => ({ id: `m-${index}`, category: "future-game", price: 10, attributes: { shard: `market-${index}` } }));
  const shard = buildFieldCatalog(targets, market)["future-game"].find(field => field.field === "shard");
  assert.equal(shard.suggestedRule.mode, "ignore");
  assert.equal(shard.suggestedRule.weight, 0);
});

test("dynamic service fields never become automatic pricing controls", () => {
  const targets = [{ id: 1, category: "future-game", attributes: { seasonal_points: 40, custom_mode: "ranked", can_edit_item: true, ai_price: 999 } }];
  const market = [{ id: 2, category: "future-game", price: 50, attributes: { seasonal_points: 42, custom_mode: "ranked", can_edit_item: false, ai_price: 777 } }];
  const fields = buildFieldCatalog(targets, market)["future-game"];
  assert.equal(fields.some(field => field.field === "can_edit_item" || field.field === "ai_price"), false);
  assert.equal(fields.find(field => field.field === "seasonal_points").autoEligible, true);
  assert.equal(fields.find(field => field.field === "custom_mode").autoEligible, false);
  assert.equal(fields.find(field => field.field === "custom_mode").suggestedRule.mode, "ignore");
});

test("listing controls and dates never train an automatic category profile", () => {
  const targets = [{ id: 1, category: "future-game", attributes: { level: 10, max_discount_percent: 20, edit_date: 123 } }];
  const market = Array.from({ length: 8 }, (_, index) => ({
    id: `m-${index}`, category: "future-game", price: 10 + index * 10,
    attributes: { level: index + 1, max_discount_percent: index * 10, edit_date: 1_000 + index }
  }));
  const fields = buildFieldCatalog(targets, market)["future-game"];
  assert.equal(fields.find(field => field.field === "level").autoEligible, true);
  assert.equal(fields.find(field => field.field === "max_discount_percent").autoEligible, false);
  assert.equal(fields.find(field => field.field === "edit_date").autoEligible, false);
});

test("binary category discriminators become exact automatic fields when prices split", () => {
  const targets = [{ id: "t", category: "world-of-tanks", attributes: { wot_blitz: 1 } }];
  const market = [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `b-${index}`, category: "world-of-tanks", price: 5 + index, attributes: { wot_blitz: 1 } })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `w-${index}`, category: "world-of-tanks", price: 220 + index, attributes: { wot_blitz: 0 } }))
  ];
  const blitz = buildFieldCatalog(targets, market)["world-of-tanks"].find(field => field.field === "wot_blitz");
  assert.equal(blitz.autoEligible, true);
  assert.equal(blitz.suggestedRule.mode, "exact");
  assert.ok(blitz.priceSignal > .1);
});
