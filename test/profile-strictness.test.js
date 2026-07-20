import test from "node:test";
import assert from "node:assert/strict";
import { computeStrictness } from "../public/profile-strictness.js";

const targets = [{ category: "future-game", attributes: { region: "eu", level: 10 } }];
const market = [
  { category: "future-game", price: 10, attributes: { region: "us", level: 10 } },
  { category: "future-game", price: 12, attributes: { region: "eu", level: 11 } }
];

test("strictness estimates the rejected share of analogs locally", () => {
  const profile = { category: "future-game", automatic: false, minAnalogs: 1, fields: { region: { mode: "exact", weight: 5, required: true, missing: "reject" } } };
  const summary = computeStrictness({ targets, market, profile, category: "future-game" });
  assert.equal(summary.rejectRate, 0.5);
  assert.equal(summary.requiredCount, 1);
  assert.equal(summary.importantCount, 0);
  assert.equal(summary.configuredCount, 1);
  assert.equal(summary.hasMarket, true);
  assert.equal(summary.tooFewCount, 0);
  assert.equal(summary.level, "ok");
});

test("too few analogs are counted against the minimum", () => {
  const profile = { category: "future-game", automatic: false, minAnalogs: 2, fields: { region: { mode: "exact", weight: 5, required: true, missing: "reject" } } };
  const summary = computeStrictness({ targets, market, profile, category: "future-game" });
  assert.equal(summary.tooFewCount, 1);
});

test("an empty manual profile rejects everything", () => {
  const profile = { category: "future-game", automatic: false, minAnalogs: 1, fields: {} };
  const summary = computeStrictness({ targets, market, profile, category: "future-game" });
  assert.equal(summary.level, "empty");
  assert.equal(summary.configuredCount, 0);
  assert.equal(summary.rejectRate, 1);
});

test("strictness waits for a market sample", () => {
  const profile = { category: "future-game", automatic: false, minAnalogs: 1, fields: { region: { mode: "exact", weight: 5, required: true, missing: "reject" } } };
  const summary = computeStrictness({ targets, market: [], profile, category: "future-game" });
  assert.equal(summary.hasMarket, false);
  assert.equal(summary.level, "no-market");
  assert.equal(summary.rejectRate, null);
});

test("listing metadata fields never contribute to strictness", () => {
  const profile = { category: "future-game", automatic: false, minAnalogs: 1, fields: { edit_date: { mode: "range", weight: 5, required: true, missing: "reject" } } };
  const summary = computeStrictness({ targets, market, profile, category: "future-game" });
  assert.equal(summary.configuredCount, 0);
  assert.equal(summary.requiredCount, 0);
  assert.equal(summary.level, "empty");
});
