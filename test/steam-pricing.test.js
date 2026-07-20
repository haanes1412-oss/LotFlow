import test from "node:test";
import assert from "node:assert/strict";
import { analyzeItem, itemSimilarity } from "../src/pricing-engine.js";
import { profileFromSettings } from "../src/profile-config.js";

test("Steam default profile ignores game count, level and country", () => {
  const profile = profileFromSettings("steam");
  assert.equal(profile.useUnconfiguredFields, false);
  assert.equal(profile.fields.games_count.mode, "ignore");
  assert.equal(profile.fields.level.mode, "ignore");
  assert.equal(profile.fields.country.mode, "ignore");
  assert.equal(profile.allowCategoryFallback, false);
  assert.equal(profile.minAnalogs, 3);
});

test("Steam weak fields alone cannot create a strong analog", () => {
  const similarity = itemSimilarity(
    { id: "target", category: "steam", title: "Steam account", attributes: { games_count: 300, level: 100, country: "TW" } },
    { id: "candidate", category: "steam", title: "Steam account", attributes: { games_count: 300, level: 100, country: "TW" } }
  );
  assert.ok(similarity.score < profileFromSettings("steam").minSimilarity);
});

test("Steam broad category median is not presented as a reliable price", () => {
  const target = { id: "target", category: "steam", title: "Steam account", price: 99_999, attributes: { games_count: 300, level: 100, country: "TW" } };
  const market = [
    { id: "one", category: "steam", title: "Steam account", price: 100, seller_id: "one", attributes: { games_count: 300, level: 100, country: "TW" } },
    { id: "two", category: "steam", title: "Steam account", price: 1_500, seller_id: "two", attributes: { games_count: 300, level: 100, country: "TW" } }
  ];
  const result = analyzeItem(target, market, { strategy: "active", lowConfidenceAction: "approximate", minimumPrice: 10 });
  assert.equal(result.proposedPrice, 10);
  assert.equal(result.confidence, .05);
  assert.match(result.reason, /недостаточно надёжных параметров/i);
});
