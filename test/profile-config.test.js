import test from "node:test";
import assert from "node:assert/strict";
import { builtinProfileCatalog, matchingFixedPriceRule, normalizeCategoryProfile, PROFILE_SCHEMA_VERSION } from "../src/profile-config.js";

test("built-in profiles expose safe editable category settings", () => {
  const profiles = builtinProfileCatalog();
  assert.equal(profiles["world-of-tanks"].fields.top_count.mode, "range");
  assert.equal(profiles["world-of-tanks"].fields.tanks.mode, "similarity");
  assert.equal(profiles["world-of-tanks"].allowCategoryFallback, false);
  assert.ok(profiles.tiktok.fields.followers.buckets.length > 3);
  assert.equal(profiles.tiktok.activeEstimator, "weightedMedian");
  assert.equal(profiles.tiktok.filterPriceOutliers, true);
  assert.equal(profiles.tiktok.priceOutlierRatio, 6);
  assert.equal(profiles.tiktok.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(profiles.tiktok.automatic, true);
});

test("legacy WoT profiles are migrated to the current similarity scale", () => {
  const profile = normalizeCategoryProfile("world-of-tanks", {
    schemaVersion: 2,
    minSimilarity: .9,
    fields: { tanks: { label: "Ценные танки", mode: "overlap", weight: 4, missing: "penalize" } },
    fixedPriceRules: [{ id: "wot-empty", name: "Без топов и золота", price: 1, conditions: [{ field: "top_count", operator: "eq", value: 0 }, { field: "gold", operator: "eq", value: 0 }] }]
  });
  assert.equal(profile.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(profile.minSimilarity, .58);
  assert.equal(profile.fields.tanks.mode, "similarity");
  assert.ok(profile.fixedPriceRules.some(rule => rule.id === "wot-no-tops"));
});

test("schema three preserves deliberate expert overrides", () => {
  const profile = normalizeCategoryProfile("world-of-tanks", {
    schemaVersion: 3,
    minSimilarity: .9,
    fields: { tanks: { label: "Мои танки", mode: "overlap", weight: 4, missing: "penalize" } },
    fixedPriceRules: []
  });
  assert.equal(profile.minSimilarity, .9);
  assert.equal(profile.fields.tanks.mode, "overlap");
  assert.equal(profile.fixedPriceRules.length, 0);
});

test("profile normalization rejects service and credential-shaped fields", () => {
  const profile = normalizeCategoryProfile("future-game", {
    activeEstimator: "lowerQuartile",
    fields: {
      rank: { mode: "range", weight: 2 },
      oldPassword: { mode: "exact", weight: 20 },
      canEditItem: { mode: "exact", weight: 20 },
      aiPrice: { mode: "similarity", weight: 20 }
    },
    fixedPriceRules: [{ name: "unsafe", price: 1, conditions: [{ field: "oldPassword", operator: "present" }] }]
  });
  assert.equal(profile.activeEstimator, "lowerQuartile");
  assert.equal(profile.fields.rank.mode, "range");
  assert.equal("oldPassword" in profile.fields, false);
  assert.equal("canEditItem" in profile.fields, false);
  assert.equal("aiPrice" in profile.fields, false);
  assert.equal(profile.fixedPriceRules.length, 0);
});

test("profile input is bounded and unknown fields are normalized", () => {
  const profile = normalizeCategoryProfile("future-game", {
    minSimilarity: 99,
    minAnalogs: 999,
    maxAnalogs: 1,
    priceMultiplier: -4,
    priceMin: 100,
    priceMax: 20,
    allowCategoryFallback: "yes",
    filterPriceOutliers: "no",
    priceOutlierRatio: 999,
    fields: { rank: { label: "Ранг", mode: "range", weight: 99, tolerancePercent: 25, missing: "reject", search: false } }
  });
  assert.equal(profile.minSimilarity, 1);
  assert.equal(profile.minAnalogs, 20);
  assert.equal(profile.maxAnalogs, 20);
  assert.equal(profile.priceMultiplier, 1);
  assert.equal(profile.priceMax, 100);
  assert.equal(profile.allowCategoryFallback, true);
  assert.equal(profile.filterPriceOutliers, true);
  assert.equal(profile.priceOutlierRatio, 100);
  assert.equal(profile.fields.rank.weight, 20);
  assert.equal(profile.fields.rank.search, false);
});

test("a saved manual profile fully replaces developer defaults", () => {
  const profile = normalizeCategoryProfile("world-of-tanks", {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    automatic: false,
    discountPercent: 12,
    fields: {
      top_count: { label: "Топы", mode: "range", weight: 5, tolerancePercent: 25, missing: "reject" }
    },
    fixedPriceRules: []
  });
  assert.deepEqual(Object.keys(profile.fields), ["top_count"]);
  assert.equal(profile.fixedPriceRules.length, 0);
  assert.equal(profile.automatic, false);
  assert.equal(profile.discountPercent, 12);
});

test("preferred list values are bounded and retained in a manual profile", () => {
  const profile = normalizeCategoryProfile("future-game", {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    automatic: false,
    fields: {
      rare_items: {
        label: "Редкие предметы",
        mode: "overlap",
        weight: 5,
        missing: "reject",
        preferredValues: ["Alpha", "Beta", "", ...Array.from({ length: 120 }, (_, index) => `item-${index}`)]
      }
    }
  });
  assert.deepEqual(profile.fields.rare_items.preferredValues.slice(0, 2), ["Alpha", "Beta"]);
  assert.equal(profile.fields.rare_items.preferredValues.length, 100);
});

test("fixed rules accept boolean values entered in the visual editor", () => {
  const profile = normalizeCategoryProfile("future-game", {
    fixedPriceRules: [{ name: "Без почты", price: 5, conditions: [{ field: "email_access", operator: "eq", value: "false" }] }]
  });
  assert.equal(matchingFixedPriceRule({ email_access: false }, profile)?.price, 5);
  assert.equal(matchingFixedPriceRule({ email_access: true }, profile), null);
});

test("fixed rule conditions support several fields", () => {
  const profile = normalizeCategoryProfile("future-game", {
    fixedPriceRules: [{ name: "Пустой", price: 4, conditions: [{ field: "level", operator: "lte", value: 1 }, { field: "region", operator: "eq", value: "eu" }] }]
  });
  assert.equal(matchingFixedPriceRule({ level: 1, region: "EU" }, profile)?.price, 4);
  assert.equal(matchingFixedPriceRule({ level: 2, region: "eu" }, profile), null);
});
