import test from "node:test";
import assert from "node:assert/strict";
import { buildFieldCatalog } from "../src/field-catalog.js";
import { resolveAutomaticProfiles } from "../src/automatic-profile.js";
import { analyzeBatch } from "../src/pricing-engine.js";
import { profileFromSettings } from "../src/profile-config.js";

function item(id, price, blitz, seller = id) {
  return {
    item_id: id,
    title: blitz ? `WoT Blitz ${id}` : `WoT ${id}`,
    price,
    category_name: "world-of-tanks",
    seller_id: seller,
    attributes: { origin: "brute", region: "eu", top_count: 2, premium_count: 10, wot_blitz: blitz }
  };
}

test("automatic category profile separates Blitz and calibrates its estimator", () => {
  const target = item("target", 199, 1, "owner");
  const market = [
    ...Array.from({ length: 12 }, (_, index) => item(`blitz-${index}`, 5 + index % 4, 1)),
    ...Array.from({ length: 12 }, (_, index) => item(`wot-${index}`, 225 + index % 4, 0))
  ];
  const fieldCatalog = buildFieldCatalog([target], market);
  const automatic = resolveAutomaticProfiles({ targets: [target], market, fieldCatalog });
  const profile = automatic.profiles["world-of-tanks"];
  assert.equal(profile.fields.wot_blitz.mode, "exact");
  assert.equal(profile.calibration.status, "reliable");
  assert.ok(profile.calibration.predictions >= 10);
  const result = analyzeBatch([target], market, { strategy: "active", categoryProfiles: automatic.profiles })[0];
  assert.ok(result.proposedPrice <= 10);
  assert.equal(result.status, "ready");
  assert.ok(result.analogs.every(analog => analog.price < 20));
  assert.equal(result.diagnostics.automaticProfile, true);
  const normalized = profileFromSettings("world-of-tanks", automatic.profiles);
  assert.deepEqual(Object.keys(normalized.fields).sort(), Object.keys(profile.fields).sort());
  assert.equal("tanks" in normalized.fields, false);
});

test("seller can disable automatic resolution for an expert profile", () => {
  const target = item("target", 199, 1, "owner");
  const market = [item("one", 5, 1), item("two", 6, 1)];
  const fieldCatalog = buildFieldCatalog([target], market);
  const categoryProfiles = { "world-of-tanks": { schemaVersion: 4, automatic: false, minSimilarity: .77 } };
  const automatic = resolveAutomaticProfiles({ targets: [target], market, fieldCatalog, categoryProfiles });
  assert.equal(automatic.report["world-of-tanks"].mode, "manual");
  assert.equal(automatic.profiles["world-of-tanks"].minSimilarity, .77);
});

test("automatic profiles work for an unknown category without a built-in preset", () => {
  const target = { item_id: "target", title: "Premium edition", price: 199, category_name: "future-game", seller_id: "owner", attributes: { edition: "premium", level: 20 } };
  const market = [
    ...Array.from({ length: 10 }, (_, index) => ({ item_id: `p-${index}`, title: `Premium ${index}`, price: 40 + index % 3, category_name: "future-game", seller_id: `p-${index}`, attributes: { edition: "premium", level: 20 } })),
    ...Array.from({ length: 10 }, (_, index) => ({ item_id: `s-${index}`, title: `Standard ${index}`, price: 5 + index % 2, category_name: "future-game", seller_id: `s-${index}`, attributes: { edition: "standard", level: 20 } }))
  ];
  const fieldCatalog = buildFieldCatalog([target], market);
  const automatic = resolveAutomaticProfiles({ targets: [target], market, fieldCatalog });
  const profile = automatic.profiles["future-game"];
  assert.equal(profile.fields.edition.mode, "exact");
  const result = analyzeBatch([target], market, { strategy: "active", categoryProfiles: automatic.profiles })[0];
  assert.ok(result.proposedPrice >= 40 && result.proposedPrice <= 42);
  assert.ok(result.analogs.every(analog => analog.price >= 40));
});

test("automatic numeric and list fields rank neighbours without rejecting the whole market", () => {
  const target = { item_id: "target", category_name: "future-game", attributes: { rank: 12, badges: ["rare-a", "rare-b"] } };
  const market = Array.from({ length: 16 }, (_, index) => ({
    item_id: `m-${index}`, category_name: "future-game", seller_id: `s-${index}`, price: 20 + (index % 4) * 20,
    attributes: { rank: 8 + index % 8, badges: Array.from({ length: index % 4 + 1 }, (_, badge) => `rare-${index}-${badge}`) }
  }));
  const fieldCatalog = buildFieldCatalog([target], market);
  const automatic = resolveAutomaticProfiles({ targets: [target], market, fieldCatalog });
  const profile = automatic.profiles["future-game"];
  assert.equal(profile.fields.rank.mode, "range");
  assert.equal(profile.fields.rank.required, false);
  assert.equal(profile.fields.badges.mode, "overlap");
  assert.equal(profile.fields.badges.required, false);
  const result = analyzeBatch([target], market, { strategy: "active", categoryProfiles: automatic.profiles })[0];
  assert.ok(result.analogs.length >= 2);
});

test("an uncalibrated automatic profile returns a marked rough estimate when requested", () => {
  const target = { item_id: "target", title: "Level 10", price: 199, category_name: "small-game", attributes: { level: 10, origin: "brute" } };
  const market = [
    { item_id: "one", title: "Level 10 one", price: 40, category_name: "small-game", seller_id: "one", attributes: { level: 10, origin: "brute" } },
    { item_id: "two", title: "Level 10 two", price: 42, category_name: "small-game", seller_id: "two", attributes: { level: 10, origin: "brute" } }
  ];
  const fieldCatalog = buildFieldCatalog([target], market);
  const automatic = resolveAutomaticProfiles({ targets: [target], market, fieldCatalog });
  assert.equal(automatic.profiles["small-game"].calibration.status, "unavailable");
  const result = analyzeBatch([target], market, {
    strategy: "active",
    lowConfidenceAction: "approximate",
    categoryProfiles: automatic.profiles
  })[0];
  assert.equal(result.proposedPrice, 41);
  assert.equal(result.status, "ready");
  assert.equal(result.diagnostics.calibrationBlocked, true);
  assert.equal(result.diagnostics.roughEstimate, true);
  assert.match(result.reason, /не прошёл калибровку/);
});

test("calibrated WoT profile prices top accounts even when every tank list is different", () => {
  const numericId = id => Number(String(id).replace(/\D/g, "")) || 0;
  const wot = (id, top, premium) => ({
    item_id: id,
    title: `WoT ${top} топ ${premium} прем Wargaming`,
    price: Math.round(5 + top * 7 + premium * 1.2 + (numericId(id) % 5 - 2) * 2),
    category_name: "world-of-tanks",
    seller_id: `seller-${id}`,
    attributes: {
      origin: "brute",
      region: "eu",
      top_count: top,
      premium_count: premium,
      tanks: Array.from({ length: Math.max(1, top) }, (_, index) => `unique-${id}-${index}`),
      battles: 1_000 + top * 200 + premium * 10
    }
  });
  const market = Array.from({ length: 72 }, (_, index) => wot(index + 1, index % 24 + 1, (index * 7) % 60 + 1));
  const target = { ...wot("target", 12, 35), price: 199, seller_id: "owner" };
  const fieldCatalog = buildFieldCatalog([target], market);
  const automatic = resolveAutomaticProfiles({ targets: [target], market, fieldCatalog });
  const profile = automatic.profiles["world-of-tanks"];
  assert.equal(profile.calibration.status, "reliable");
  assert.equal(profile.fields.top_count.required, false);
  assert.equal(profile.fields.premium_count.required, false);
  assert.equal(profile.fields.tanks, undefined, "redundant disjoint tank lists must not overpower top count");
  const result = analyzeBatch([target], market, { strategy: "active", categoryProfiles: automatic.profiles })[0];
  assert.equal(result.status, "ready");
  assert.ok(result.proposedPrice >= 80 && result.proposedPrice <= 250);
  assert.ok(result.proposedPrice < 1_000);
  assert.ok(result.analogs.length >= 2);
});

test("different unknown categories train and price independently in one batch", () => {
  const targets = [
    { item_id: "target-a", category_name: "category-a", seller_id: "owner", price: 199, attributes: { edition: "pro", level: 50 } },
    { item_id: "target-b", category_name: "category-b", seller_id: "owner", price: 199, attributes: { region: "eu", score: 80 } }
  ];
  const market = [
    ...Array.from({ length: 24 }, (_, index) => ({
      item_id: `a-${index}`, category_name: "category-a", seller_id: `a-${index}`,
      price: (index % 2 ? 80 : 20) + index % 3,
      attributes: { edition: index % 2 ? "pro" : "basic", level: index % 2 ? 50 : 10 }
    })),
    ...Array.from({ length: 24 }, (_, index) => ({
      item_id: `b-${index}`, category_name: "category-b", seller_id: `b-${index}`,
      price: 10 + Math.round((index % 12) * 4),
      attributes: { region: "eu", score: (index % 12) * 10 }
    }))
  ];
  const fieldCatalog = buildFieldCatalog(targets, market);
  const automatic = resolveAutomaticProfiles({ targets, market, fieldCatalog });
  assert.equal(automatic.profiles["category-a"].calibration.status, "reliable");
  assert.equal(automatic.profiles["category-b"].calibration.status, "reliable");
  const [first, second] = analyzeBatch(targets, market, { strategy: "active", categoryProfiles: automatic.profiles });
  assert.equal(first.status, "ready");
  assert.equal(second.status, "ready");
  assert.ok(first.proposedPrice >= 80 && first.proposedPrice <= 82);
  assert.ok(second.proposedPrice >= 38 && second.proposedPrice <= 46);
  assert.ok(first.analogs.every(analog => analog.id.startsWith("a-")));
  assert.ok(second.analogs.every(analog => analog.id.startsWith("b-")));
});
