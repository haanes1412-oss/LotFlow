import test from "node:test";
import assert from "node:assert/strict";
import { hasConfiguredProfile, selectProfilePreviewTargets } from "../public/profile-preview-sample.js";

const important = { mode: "similarity", weight: 2 };

test("preview samples numeric extremes instead of the first five listings", () => {
  const targets = [0, 1, 2, 3, 4, 40, 80].map((power, index) => ({ id: String(index), attributes: { power } }));
  const selected = selectProfilePreviewTargets(targets, { fields: { power: important } }, 5);
  assert.equal(selected.length, 5);
  assert.ok(selected.some(item => item.attributes.power === 0));
  assert.ok(selected.some(item => item.attributes.power === 80));
});

test("preview samples different list contents for any category", () => {
  const targets = [
    { id: "1", attributes: { inventory: ["a"] } },
    { id: "2", attributes: { inventory: ["a", "b"] } },
    { id: "3", attributes: { inventory: ["a", "b", "c"] } },
    { id: "4", attributes: { inventory: ["x"] } },
    { id: "5", attributes: { inventory: ["y"] } },
    { id: "6", attributes: { inventory: ["rare", "unique", "limited", "gold"] } }
  ];
  const selected = selectProfilePreviewTargets(targets, { fields: { inventory: important } }, 3);
  assert.ok(selected.some(item => item.id === "6"));
  assert.ok(selected.some(item => item.id === "4" || item.id === "5"));
});

test("preview exposes a numeric segment even when the seller configured another field", () => {
  const targets = [0, 0, 0, 0, 0, 12, 30].map((capacity, index) => ({
    id: String(index),
    attributes: { origin: "seller", capacity }
  }));
  const profile = { fields: { origin: { mode: "exact", weight: 5 } } };
  const selected = selectProfilePreviewTargets(targets, profile, 5);
  assert.ok(selected.some(item => item.attributes.capacity === 30));
  assert.ok(selected.some(item => item.attributes.capacity === 0));
});

test("an empty profile is not presented as a configured category", () => {
  assert.equal(hasConfiguredProfile({ fields: { rank: { mode: "ignore", weight: 0 } } }), false);
  assert.equal(hasConfiguredProfile({ fields: { rank: important } }), true);
  assert.equal(hasConfiguredProfile({ fields: {}, fixedPriceRules: [{ id: "manual" }] }), true);
});
