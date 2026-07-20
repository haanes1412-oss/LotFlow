import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCategoryProfile } from "../src/profile-config.js";

test("saved listing-meta rules are neutralized so they cannot filter analogs", () => {
  const profile = normalizeCategoryProfile("world-of-tanks", {
    schemaVersion: 5,
    automatic: false,
    fields: {
      edit_date: { label: "edit date", mode: "range", weight: 4, required: true, missing: "reject", tolerancePercent: 0 },
      account_last_activity: { label: "Отлёга", mode: "range", weight: 3, required: true, missing: "reject" }
    }
  });
  assert.equal(profile.fields.edit_date.mode, "ignore");
  assert.equal(profile.fields.edit_date.weight, 0);
  assert.equal(profile.fields.edit_date.required, false);
  assert.equal(profile.fields.edit_date.missing, "ignore");
  // account properties remain the seller's own choice
  assert.equal(profile.fields.account_last_activity.mode, "range");
  assert.equal(profile.fields.account_last_activity.required, true);
});
