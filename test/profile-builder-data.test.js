import test from "node:test";
import assert from "node:assert/strict";
import { PROFILE_SCHEMA_VERSION, generatedProfile, migrateStoredProfile, simpleFieldRule, simplePriority } from "../public/profile-builder-data.js";

const baseWot = {
  schemaVersion: PROFILE_SCHEMA_VERSION,
  minSimilarity: .58,
  activeEstimator: "weightedMedian",
  fields: {
    tanks: { label: "Ценные танки", mode: "similarity", weight: 4, missing: "penalize" },
    top_count: { label: "Топы", mode: "range", weight: 4, missing: "reject" }
  },
  fixedPriceRules: [{ id: "wot-no-tops", name: "Без топов", price: 1, conditions: [{ field: "top_count", operator: "eq", value: 0 }] }]
};

test("stored WoT schema two profiles migrate without clearing browser storage", () => {
  const legacy = {
    schemaVersion: 2,
    minSimilarity: .9,
    fields: { tanks: { label: "Ценные танки", mode: "overlap", weight: 4, missing: "penalize" } },
    fixedPriceRules: []
  };
  const migration = migrateStoredProfile("world-of-tanks", legacy, baseWot);
  assert.equal(migration.changed, true);
  assert.equal(migration.profile.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(migration.profile.minSimilarity, .58);
  assert.equal(migration.profile.fields.tanks.mode, "similarity");
  assert.ok(migration.profile.fixedPriceRules.some(rule => rule.id === "wot-no-tops"));
});

test("stored schema three profiles keep intentional custom rules", () => {
  const current = {
    schemaVersion: 3,
    minSimilarity: .9,
    fields: { tanks: { mode: "overlap", weight: 4, missing: "penalize" } },
    fixedPriceRules: []
  };
  const migration = migrateStoredProfile("world-of-tanks", current, baseWot);
  assert.equal(migration.changed, true);
  assert.equal(migration.profile.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(migration.profile.automatic, true);
  assert.equal(migration.profile.minSimilarity, .9);
  assert.equal(migration.profile.fields.tanks.mode, "overlap");
  assert.deepEqual(migration.profile.fixedPriceRules, []);
});

test("stored volatile visual assets are migrated to ignored fields", () => {
  const migration = migrateStoredProfile("world-of-tanks", {
    schemaVersion: 5,
    fields: { emblem: { mode: "exact", weight: 5, missing: "reject", required: true } }
  }, { fields: {} }, ["emblem"]);
  assert.equal(migration.changed, true);
  assert.equal(migration.profile.fields.emblem.mode, "ignore");
  assert.equal(migration.profile.fields.emblem.required, false);
});

test("schema one waits for the field catalog before removing old fields", () => {
  const migration = migrateStoredProfile("world-of-tanks", { schemaVersion: 1, fields: { useful: {}, service: {} } }, baseWot);
  assert.equal(migration.changed, false);
  assert.equal(migration.pending, true);
});

test("schema one removes fields that are absent from the approved catalog", () => {
  const migration = migrateStoredProfile(
    "future-game",
    { schemaVersion: 1, fields: { useful: { mode: "exact" }, service: { mode: "exact" } }, fixedPriceRules: [] },
    { schemaVersion: 3, minSimilarity: .55, fields: {}, fixedPriceRules: [] },
    ["useful"]
  );
  assert.deepEqual(Object.keys(migration.profile.fields), ["useful"]);
  assert.equal(migration.profile.schemaVersion, PROFILE_SCHEMA_VERSION);
});

test("three simple choices map to safe internal comparison rules", () => {
  const requiredNumber = simpleFieldRule("required", "number", { label: "Ранг" });
  assert.equal(requiredNumber.mode, "range");
  assert.equal(requiredNumber.missing, "reject");
  assert.equal(requiredNumber.required, true);
  assert.equal(requiredNumber.tolerancePercent, 20);
  assert.equal(simplePriority(requiredNumber), "required");

  const important = simpleFieldRule("important", "list", { label: "Предметы" });
  assert.equal(important.mode, "similarity");
  assert.equal(important.missing, "penalize");
  assert.equal(important.required, false);
  assert.equal(simplePriority(important), "important");

  const ignored = simpleFieldRule("ignore", "text", { label: "Дата" });
  assert.equal(ignored.mode, "ignore");
  assert.equal(ignored.weight, 0);
  assert.equal(simplePriority(ignored), "ignore");
});

test("a new seller profile starts with every field truly ignored", () => {
  const profile = generatedProfile("future-game", [{ category: "future-game", attributes: { rank: 42, region: "eu" } }]);
  assert.equal(profile.automatic, false);
  assert.equal(profile.allowCategoryFallback, false);
  assert.equal(profile.useUnconfiguredFields, false);
  assert.ok(Object.values(profile.fields).every(rule => rule.mode === "ignore" && rule.search === false));
});
