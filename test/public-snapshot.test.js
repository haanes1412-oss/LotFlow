import test from "node:test";
import assert from "node:assert/strict";
import { publicItem, publicResult } from "../src/public-snapshot.js";

test("browser snapshot keeps pricing fields and removes account secrets", () => {
  const item = publicItem({
    item_id: 1, title: "WoT", price: 199, category_name: "world-of-tanks", same_item_ids: [2],
    login: "private-login", password: "private-password", token: "private-token", information: "private-info",
    attributes: { top_count: 10, premium_count: 20, tanks: ["101"], region: "eu", cookie_login: true, sessions: ["private-session"], login_data: "secret", password: "secret" }
  });
  const json = JSON.stringify(item);
  assert.equal(item.attributes.top_count, 10);
  assert.equal(item.attributes.cookie_login, true);
  assert.equal("sessions" in item.attributes, false);
  assert.deepEqual(item.same_item_ids, ["2"]);
  assert.equal(/private|login_data|password|token|information/.test(json), false);
  assert.equal("raw" in item, false);
});

test("public analysis results do not retain a normalized raw payload", () => {
  const result = publicResult({ item: { id: 1, category: "steam", title: "Lot", price: 50, attributes: { level: 2 }, raw: { password: "secret" } }, analogs: [], nearMisses: [{ id: 2, title: "Other", price: 60, similarity: 0, rawSimilarity: .8, reason: "Уровень: 2 ≠ 50", differences: ["Уровень: 2 ≠ 50"] }] });
  assert.equal("raw" in result.item, false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(result.nearMisses[0].rawSimilarity, .8);
});

test("browser snapshots reject unsafe values even under innocent field names", () => {
  const item = publicItem({
    id: 1,
    category: "future-game",
    attributes: {
      seasonal_points: 412,
      clan: "https://example.test/private",
      custom_rank: "person@example.test:sample-value"
    }
  });
  assert.equal(item.attributes.seasonal_points, 412);
  assert.equal("clan" in item.attributes, false);
  assert.equal("custom_rank" in item.attributes, false);
});
