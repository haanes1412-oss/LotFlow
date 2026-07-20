import test from "node:test";
import assert from "node:assert/strict";
import { normalizeItem } from "../src/pricing-engine.js";
import { buildSearchPlans } from "../src/search-planner.js";

test("TikTok search plans follow seller follower buckets", () => {
  const plans = buildSearchPlans("tiktok", [{ attributes: { followers: 412 } }, { attributes: { followers: 1500 } }, { attributes: { followers: 800 } }]);
  assert.ok(plans.some(x => x.followers_min === 100 && x.followers_max === 999));
  assert.ok(plans.some(x => x.followers_min === 1000 && x.followers_max === 4999));
  assert.ok(plans.some(x => x.followers_min === undefined && x.order_by === "pdate_to_down"));
  assert.ok(plans.some(x => x.followers_min === undefined && x.order_by === "price_to_up"));
  assert.ok(plans.every(x => x.parse_same_item_ids === true));
});

test("WoT search plans cover top ranges with recent and cheapest samples", () => {
  const plans = buildSearchPlans("world-of-tanks", [{ attributes: { top_count: 31, premium_count: 50, gold: 4200 } }, { attributes: { top_count: 35, premium_count: 55, gold: 4500 } }, { attributes: { top_count: 0, premium_count: 0, gold: 0 } }]);
  assert.ok(plans.length >= 6);
  assert.ok(plans.some(x => x.top_min === 31 && x.top_max === 60 && x.order_by === "pdate_to_down"));
  assert.ok(plans.some(x => x.top_min === 31 && x.top_max === 60 && x.order_by === "price_to_up"));
  assert.ok(plans.some(x => x.top_min === 31 && x.top_max === 60 && x.order_by === "price_to_down"));
  assert.ok(plans.some(x => x.prem_min === 31 && x.prem_max === 60));
  assert.ok(plans.every(x => x.gold_min === undefined));
});

test("WoT search plans use top counts parsed from real listing titles", () => {
  const target = normalizeItem({ item_id: 1, category_name: "wot", title: "WoT | 11 топ 50 прем Wargaming", price: 199, attributes: { region: "Wargaming" } });
  const plans = buildSearchPlans("world-of-tanks", [target]);
  const primary = plans.find(plan => plan.top_min === 6 && plan.order_by === "pdate_to_down" && plan.prem_min === undefined);
  const strict = plans.find(plan => plan.top_min === 6 && plan.prem_min === 31);
  assert.equal(primary.top_max, 15);
  assert.equal(strict.prem_max, 60);
});

test("WoT search plans do not split identical ranges by full tank lists", () => {
  const plans = buildSearchPlans("world-of-tanks", [
    { attributes: { top_count: 10, premium_count: 20, gold: 500, region: "eu", tanks: ["IS-7"] } },
    { attributes: { top_count: 11, premium_count: 21, gold: 700, region: "eu", tanks: ["Maus"] } }
  ]);
  assert.ok(plans.length >= 4);
  assert.ok(plans.every(plan => plan["tank[]"] === undefined));
});

test("WoT plans reserve broad fallbacks before adding cheap duplicates", () => {
  const targets = [0, 2, 10, 20, 40].map((top_count, index) => ({ attributes: { top_count, region: index % 2 ? "eu" : "ru" } }));
  const plans = buildSearchPlans("world-of-tanks", targets, 5);
  assert.equal(plans.length, 5);
  assert.ok(plans.some(plan => plan.top_min === undefined && plan.order_by === "pdate_to_down"));
  assert.ok(plans.some(plan => plan.top_min === undefined && plan.order_by === "price_to_up"));
  assert.equal(plans.filter(plan => plan.top_min !== undefined && plan.order_by === "pdate_to_down").length, 3);
});

test("specialized WoT searches include extra fields selected by the seller", () => {
  const profile = { fields: { phone_linked: { mode: "exact", weight: 5 }, top_count: { mode: "range", weight: 4 }, premium_count: { mode: "range", weight: 3 } } };
  const schema = [{ name: "tel", base: "tel" }, { name: "top_min", base: "top" }, { name: "prem_min", base: "prem" }];
  const [plan] = buildSearchPlans("world-of-tanks", [{ attributes: { top_count: 5, premium_count: 9, phone_linked: true } }], 4, { profile, schema });
  assert.equal(plan.tel, "yes");
});

test("seller may keep a field in similarity without using it as an API filter", () => {
  const profile = { fields: { phone_linked: { mode: "exact", weight: 5, search: false }, top_count: { mode: "range", weight: 4, search: false }, premium_count: { mode: "range", weight: 3, search: false } } };
  const schema = [{ name: "tel", base: "tel" }];
  const [plan] = buildSearchPlans("world-of-tanks", [{ attributes: { top_count: 5, premium_count: 9, phone_linked: true } }], 2, { profile, schema });
  assert.equal(plan.tel, undefined);
  assert.equal(plan.top_min, undefined);
  assert.equal(plan.prem_min, undefined);
});

test("a manual profile does not silently restore ignored category filters", () => {
  const profile = {
    automatic: false,
    fields: {
      top_count: { mode: "range", weight: 5, search: true, tolerancePercent: 20, toleranceAbsolute: 1 }
    }
  };
  const plans = buildSearchPlans("world-of-tanks", [{ attributes: { top_count: 12, premium_count: 45, region: "eu" } }], 8, { profile });
  assert.ok(plans.some(plan => plan.top_min === 6));
  assert.ok(plans.every(plan => plan.prem_min === undefined));
  assert.ok(plans.every(plan => plan["region[]"] === undefined));
});

test("specialized TikTok fields may be disabled as API filters", () => {
  const profile = { fields: { followers: { mode: "bucket", weight: 4, search: false }, cookie_login: { mode: "exact", weight: 2, search: false } } };
  const [plan] = buildSearchPlans("tiktok", [{ attributes: { followers: 1_500, cookie_login: true } }], 2, { profile });
  assert.equal(plan.followers_min, undefined);
  assert.equal(plan.followers_max, undefined);
  assert.equal(plan.cookies, undefined);
});

test("custom profiles turn category fields into focused API searches", () => {
  const profile = {
    fields: {
      games_count: { mode: "range", weight: 4, tolerancePercent: 20, toleranceAbsolute: 2 },
      region: { mode: "exact", weight: 3 }
    }
  };
  const schema = [
    { name: "gmin", base: "g" },
    { name: "gmax", base: "g" },
    { name: "region[]", base: "region" }
  ];
  const plans = buildSearchPlans(
    "epic-games",
    [{ attributes: { games_count: 10, region: "eu" } }],
    4,
    { profile, schema }
  );
  assert.equal(plans.length, 4);
  const focused = plans.filter(plan => plan.gmin !== undefined);
  assert.deepEqual(focused.map(plan => plan.order_by), ["pdate_to_down", "price_to_up"]);
  assert.ok(focused.every(plan => plan.gmin === 8 && plan.gmax === 12));
  assert.ok(focused.every(plan => plan["region[]"][0] === "eu"));
  assert.equal(plans.filter(plan => plan.gmin === undefined).length, 2);
});

test("bucket profiles search inside the configured numeric bucket", () => {
  const profile = { fields: { followers: { mode: "bucket", weight: 4, buckets: [100, 1_000, 5_000] } } };
  const schema = [{ name: "followers_min", base: "followers" }, { name: "followers_max", base: "followers" }];
  const [plan] = buildSearchPlans("future-social", [{ attributes: { followers: 1_500 } }], 1, { profile, schema });
  assert.equal(plan.followers_min, 1_000);
  assert.equal(plan.followers_max, 4_999);
});

test("unknown categories infer focused searches from the live API schema", () => {
  const schema = [
    { name: "rank_min", base: "rank" },
    { name: "rank_max", base: "rank" },
    { name: "platform[]", base: "platform" }
  ];
  const plans = buildSearchPlans("future-game", [{ attributes: { rank: 40, platform: "pc" } }], 4, { profile: { fields: {} }, schema });
  assert.equal(plans.length, 4);
  const focused = plans.filter(plan => plan.rank_min !== undefined);
  assert.ok(focused.every(plan => plan.rank_min === 28 && plan.rank_max === 52));
  assert.ok(focused.every(plan => plan["platform[]"][0] === "pc"));
  assert.equal(plans.filter(plan => plan.rank_min === undefined).length, 2);
});

test("unknown categories do not infer fields behind a manual profile", () => {
  const schema = [
    { name: "rank_min", base: "rank" },
    { name: "rank_max", base: "rank" }
  ];
  const plans = buildSearchPlans("future-game", [{ attributes: { rank: 40 } }], 4, { profile: { automatic: false, fields: {} }, schema });
  assert.deepEqual(plans.map(plan => plan.order_by), ["pdate_to_down", "price_to_up"]);
  assert.ok(plans.every(plan => plan.rank_min === undefined));
});

test("important numeric fields create a tolerant API range for unknown categories", () => {
  const schema = [
    { name: "rank_min", base: "rank" },
    { name: "rank_max", base: "rank" }
  ];
  const profile = { automatic: false, fields: { rank: { mode: "similarity", weight: 2, search: true, tolerancePercent: 25, toleranceAbsolute: 1 } } };
  const plans = buildSearchPlans("future-game", [{ attributes: { rank: 40 } }], 4, { profile, schema });
  const focused = plans.filter(plan => plan.rank_min !== undefined);
  assert.ok(focused.length >= 1);
  assert.ok(focused.every(plan => plan.rank_min === 30 && plan.rank_max === 50));
});

test("a preferred list may focus an official array filter", () => {
  const schema = [{ name: "tank[]", base: "tank" }];
  const profile = { automatic: false, fields: { tanks: { mode: "overlap", weight: 5, search: true, preferredValues: ["Maus", "IS-7"] } } };
  const plans = buildSearchPlans("future-tanks", [{ attributes: { tanks: ["Maus", "E 100"] } }], 4, { profile, schema });
  const focused = plans.filter(plan => plan["tank[]"]);
  assert.ok(focused.length >= 1);
  assert.deepEqual(focused[0]["tank[]"], ["Maus"]);
});

test("a category without a parameter schema still samples recent and cheapest market pages", () => {
  const plans = buildSearchPlans("brand-new-category", [{ attributes: { rank: 10 } }], 4, {});
  assert.deepEqual(plans.map(plan => plan.order_by), ["pdate_to_down", "price_to_up"]);
  assert.ok(plans.every(plan => plan.parse_same_item_ids === true));
});

test("WoT premium count narrows only a secondary pass", () => {
  const plans = buildSearchPlans("world-of-tanks", [{ attributes: { top_count: 12, premium_count: 45, region: "eu" } }], 10);
  assert.ok(plans.some(plan => plan.top_min === 6 && plan.prem_min === undefined));
  assert.ok(plans.some(plan => plan.top_min === 6 && plan.prem_min === 31));
  assert.ok(plans.some(plan => plan.top_min === undefined));
});
