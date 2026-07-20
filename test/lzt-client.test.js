import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { apiCategorySlug, LztClient } from "../src/lzt-client.js";

test("legacy WoT names use current Market API slugs", () => {
  assert.equal(apiCategorySlug("wot"), "world-of-tanks");
  assert.equal(apiCategorySlug("World Of Tanks"), "world-of-tanks");
  assert.equal(apiCategorySlug("wot_blitz"), "wot-blitz");
  assert.equal(apiCategorySlug("tiktok"), "tiktok");
});

test("client paginates, encodes arrays and supports current edit route", async () => {
  const seen = [];
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = Buffer.concat(chunks).toString(); seen.push({ method: request.method, url: request.url, body }); response.setHeader("content-type", "application/json");
    if (request.url === "/user/items?page=1") return response.end('{"items":[{"item_id":1}],"perPage":1,"totalItems":2}');
    if (request.url === "/user/items?page=2") return response.end('{"items":[{"item_id":2}],"perPage":1,"totalItems":2}');
    if (request.url === "/bulk/items" && request.method === "POST") return response.end('{"items":[]}');
    if (request.url === "/world-of-tanks?page=1" && request.method === "GET") return response.end('{"items":[]}');
    if (request.url === "/world-of-tanks/params" && request.method === "GET") return response.end('{"params":[]}');
    if (request.url === "/world-of-tanks/games" && request.method === "GET") return response.end('{"games":[{"id":1}]}');
    if (request.url === "/7/edit" && request.method === "PUT") return response.end('{"status":"ok"}');
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = new LztClient({ token: "test", baseUrl: `http://127.0.0.1:${server.address().port}`, minDelay: 0, searchDelay: 0 });
  try {
    assert.equal((await client.ownedItemsAll()).items.length, 2);
    await client.bulkItems([1, 2]); await client.searchAll("wot", {}, { maxPages: 1 }); await client.categoryParams("wot"); await client.categoryGames("wot"); await client.updatePrice(7, 99, "rub");
    assert.equal(seen.find(x => x.url === "/bulk/items").body, "item_id%5B%5D=1&item_id%5B%5D=2&parse_same_item_ids=true");
    assert.ok(seen.some(x => x.url === "/world-of-tanks?page=1"));
    assert.ok(seen.some(x => x.url === "/world-of-tanks/params"));
    assert.ok(seen.some(x => x.url === "/world-of-tanks/games"));
    assert.equal(seen.find(x => x.url === "/7/edit").body, "price=99&currency=rub");
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("client falls back to legacy edit route", async () => {
  const server = http.createServer(async (request, response) => { response.setHeader("content-type", "application/json"); if (request.url === "/8/edit") { response.statusCode = 405; return response.end('{}'); } if (request.url === "/8") return response.end('{"status":"ok"}'); response.statusCode = 404; response.end('{}'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = new LztClient({ token: "test", baseUrl: `http://127.0.0.1:${server.address().port}`, minDelay: 0 });
  try { assert.equal((await client.updatePrice(8, 50)).status, "ok"); } finally { await new Promise(resolve => server.close(resolve)); }
});

test("client sends official JSON batch jobs for public item cards", async () => {
  let requestData;
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    requestData = {
      method: request.method,
      url: request.url,
      type: request.headers["content-type"],
      body: Buffer.concat(chunks).toString()
    };
    response.setHeader("content-type", "application/json");
    response.end('{"jobs":[]}');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = new LztClient({ token: "test", baseUrl: `http://127.0.0.1:${server.address().port}`, minDelay: 0 });
  try {
    await client.batchGetItems([41, 42]);
    assert.equal(requestData.method, "POST");
    assert.equal(requestData.url, "/batch");
    assert.equal(requestData.type, "application/json");
    assert.deepEqual(JSON.parse(requestData.body), {
      jobs: [
        { id: "41", method: "GET", url: "/41", params: {} },
        { id: "42", method: "GET", url: "/42", params: {} }
      ]
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("batchGetItems never puts more than ten jobs in one API call", async () => {
  let jobs;
  const client = new LztClient({ token: "test", baseUrl: "http://127.0.0.1", minDelay: 0 });
  client.batch = async value => { jobs = value; return { jobs: [] }; };
  await client.batchGetItems(Array.from({ length: 14 }, (_, index) => index + 1));
  assert.equal(jobs.length, 10);
});
