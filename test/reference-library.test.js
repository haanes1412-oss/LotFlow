import test from "node:test";
import assert from "node:assert/strict";
import { addConfirmedReference, normalizeReferenceLibrary } from "../public/reference-library.js";
import { analyzeItem } from "../src/pricing-engine.js";

test("confirmed-price library keeps safe local reference evidence", () => {
  const library = addConfirmedReference({ items: [] }, { item: { id: "a", category: "future-game", title: "Rank account", attributes: { rank: 10 } } }, 125);
  assert.equal(library.items.length, 1);
  assert.equal(library.items[0].state, "sold");
  assert.equal(library.items[0].price, 125);
  assert.equal(normalizeReferenceLibrary({ references: [{ category: "future-game", price: -2 }] }).items.length, 0);
});

test("confirmed-price library is additional evidence, not a hard-coded rule", () => {
  const reference = { id: "reference:1", category: "future-game", title: "Rank account", price: 125, state: "sold", reference: true, attributes: { rank: 10 } };
  const result = analyzeItem({ id: "target", category: "future-game", attributes: { rank: 10 } }, [reference], { strategy: "lastSold" });
  assert.equal(result.proposedPrice, 125);
});
