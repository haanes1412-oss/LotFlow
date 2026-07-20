import test from "node:test";
import assert from "node:assert/strict";
import { buildQualityReport } from "../src/quality-report.js";

test("quality report warns when one price and analog dominate a batch", () => {
  const results = Array.from({ length: 30 }, (_, index) => ({
    proposedPrice: index < 24 ? 162 : 98,
    status: index < 3 ? "manual" : "ready",
    source: "Активный рынок",
    analogs: index < 20 ? [{ id: 77, title: "Repeated analog", price: 163 }] : [{ id: 88 + index, title: "Other", price: 98 }]
  }));
  const report = buildQualityReport(results);
  assert.equal(report.topPrices[0].price, 162);
  assert.equal(report.topPrices[0].count, 24);
  assert.equal(report.topAnalogs[0].id, "77");
  assert.ok(report.warnings.some(warning => warning.code === "price-concentration"));
  assert.ok(report.warnings.some(warning => warning.code === "analog-concentration"));
});

test("fixed category rules do not create false market concentration warnings", () => {
  const results = Array.from({ length: 30 }, () => ({ proposedPrice: 1, status: "ready", source: "Ценовое правило: без топов", analogs: [] }));
  const report = buildQualityReport(results);
  assert.equal(report.marketPriced, 0);
  assert.equal(report.warnings.some(warning => warning.code === "price-concentration"), false);
});
