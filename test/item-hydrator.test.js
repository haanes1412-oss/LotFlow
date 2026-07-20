import test from "node:test";
import assert from "node:assert/strict";
import { batchResponseItems, hydrateItems, hydratePublicItems, mergeItemRecords } from "../src/item-hydrator.js";

test("detailed items add full fields and same-account history ids", async () => {
  const calls = [];
  const client = {
    async bulkItems(ids, options) {
      calls.push({ ids, options });
      return { items: { 1: { item: { item_id: 1, top: 12, prem: 44 }, same_item_ids: [80, 81] } } };
    }
  };
  const hydrated = await hydrateItems(client, [{ item_id: 1, title: "WoT", price: 199 }, { item_id: 2, title: "Missing", price: 199 }]);
  assert.equal(hydrated.requested, 2);
  assert.equal(hydrated.merged, 1);
  assert.equal(hydrated.items[0].top, 12);
  assert.deepEqual(hydrated.items[0].same_item_ids, ["80", "81"]);
  assert.deepEqual(calls[0].options, { parseSameItemIds: true });
});

test("record merge preserves history links from both payloads", () => {
  const merged = mergeItemRecords({ item_id: 1, same_item_ids: [2], attributes: { region: "eu" } }, { item_id: 1, same_item_ids: [3], attributes: { top: 10 } });
  assert.deepEqual(merged.same_item_ids.sort(), ["2", "3"]);
  assert.deepEqual(merged.attributes, { region: "eu", top: 10 });
});

test("keyed bulk responses merge by requested id even when a nested id differs", async () => {
  const client = {
    async bulkItems() {
      return { items: { 41: { item: { item_id: 9001, top: 8, prem: 17 } } } };
    }
  };
  const hydrated = await hydrateItems(client, [{ item_id: 41, title: "WoT", price: 199 }]);
  assert.equal(hydrated.merged, 1);
  assert.equal(hydrated.items[0].item_id, 41);
  assert.equal(hydrated.items[0].top, 8);
});

test("public cards are hydrated with batch GET jobs, not the private bulk route", async () => {
  const calls = [];
  const client = {
    async batchGetItems(ids) {
      calls.push(ids);
      return {
        jobs: ids.map(id => ({
          id,
          response: { status_code: 200, json: { item: { item_id: Number(id), top: Number(id), prem: 20 } } }
        }))
      };
    },
    async bulkItems() { throw new Error("bulk must not be used for public cards"); }
  };
  const rows = Array.from({ length: 12 }, (_, index) => ({ item_id: index + 1, title: `Lot ${index + 1}`, price: 100 }));
  const hydrated = await hydratePublicItems(client, rows);
  assert.deepEqual(calls.map(call => call.length), [10, 2]);
  assert.equal(hydrated.requested, 12);
  assert.equal(hydrated.received, 12);
  assert.equal(hydrated.merged, 12);
  assert.equal(hydrated.items[11].top, 12);
});

test("failed public batch leaves search rows available to pricing", async () => {
  const rows = [{ item_id: 1, title: "Search row", price: 77 }];
  const result = await hydratePublicItems({ async batchGetItems() { throw new Error("temporary API failure"); } }, rows);
  assert.deepEqual(result.items, rows);
  assert.equal(result.merged, 0);
  assert.equal(result.errors.length, 1);
});

test("batch response normalizer accepts keyed responses and encoded bodies", () => {
  const items = batchResponseItems({
    jobs: {
      41: { response: { status_code: 200, body: '{"item":{"item_id":41,"top":8}}' } },
      42: { response: { status_code: 404, json: { errors: ["missing"] } } }
    }
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].item_id, 41);
  assert.equal(items[0].requested_item_id, "41");
  assert.equal(items[0].top, 8);
});

test("batch response normalizer accepts data envelopes and restores ids by job order", () => {
  const rows = batchResponseItems({ data: [
    { response: { status_code: 200, body: JSON.stringify({ item: { title: "first" } }) } },
    { response: { status_code: 200, json: { item: { title: "second" } } } }
  ] }, ["701", "702"]);
  assert.deepEqual(rows.map(row => row.requested_item_id), ["701", "702"]);
  assert.deepEqual(rows.map(row => row.title), ["first", "second"]);
});
