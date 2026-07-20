import test from "node:test";
import assert from "node:assert/strict";
import { buildFieldCatalog } from "../src/field-catalog.js";

test("field catalog flags listing metadata and keeps it out of automatic profiles", () => {
  const targets = [{ id: 1, category: "future-game", attributes: { level: 10, edit_date: 123, max_discount_percent: 20 } }];
  const market = Array.from({ length: 8 }, (_, index) => ({
    id: `m-${index}`, category: "future-game", price: 10 + index * 10,
    attributes: { level: index + 1, edit_date: 1000 + index, max_discount_percent: index * 10 }
  }));
  const fields = buildFieldCatalog(targets, market)["future-game"];
  const editDate = fields.find(field => field.field === "edit_date");
  const level = fields.find(field => field.field === "level");
  assert.equal(editDate.meta, true);
  assert.equal(editDate.autoEligible, false);
  assert.equal(level.meta, false);
  assert.equal(level.autoEligible, true);
});
