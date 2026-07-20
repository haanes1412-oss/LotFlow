import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

function listen(server) {
  return new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
}

async function freePort() {
  const server = http.createServer();
  await listen(server);
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForStatus(url, child) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`LotFlow exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/api/status`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("LotFlow did not start");
}

test("live snapshot hydrates details, finds exact history and strips secrets", async () => {
  const target = { item_id: 1, title: "WoT | 10 топ 20 прем", price: 199, currency: "rub", category_id: 14, seller_id: 7, item_state: "active" };
  const detailedTarget = { ...target, top: 10, prem: 20, gold: 0, tank: [101], region: "eu", email_type: "no", login_data: "private-login", password: "private-password" };
  const sold = { item_id: 90, title: "Старое название", price: 120, currency: "rub", category_id: 14, seller_id: 7, item_state: "closed", sold_at: 100 };
  const analog = { item_id: 2, title: "WoT | 11 топ 21 прем", price: 80, currency: "rub", category_id: 14, seller_id: 8, item_state: "active", top: 11, prem: 21, gold: 0, tank: [101], region: "eu", email_type: "no" };
  const mock = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://mock");
    response.setHeader("content-type", "application/json");
    if (url.pathname === "/category") return response.end(JSON.stringify({ categories: [{ category_id: 14, category_url: "/world-of-tanks/" }] }));
    if (url.pathname === "/user/items") return response.end(JSON.stringify({ items: [target] }));
    if (url.pathname === "/world-of-tanks/params") return response.end(JSON.stringify({ params: [{ name: "top_min" }, { name: "prem_min" }, { name: "gold_min" }, { name: "tank[]" }, { name: "region[]" }, { name: "email_type[]" }] }));
    if (url.pathname === "/world-of-tanks") {
      if (url.searchParams.has("user_id")) return response.end(JSON.stringify({ items: [{ ...target, same_item_ids: [90] }] }));
      return response.end(JSON.stringify({ items: [analog] }));
    }
    if (url.pathname === "/bulk/items") {
      let body = ""; for await (const chunk of request) body += chunk;
      const ids = new URLSearchParams(body).getAll("item_id[]");
      const items = {};
      for (const id of ids) {
        if (id === "1") items[id] = { same_item_ids: [90], item: detailedTarget };
      }
      return response.end(JSON.stringify({ items }));
    }
    if (url.pathname === "/batch") {
      let body = ""; for await (const chunk of request) body += chunk;
      const jobs = JSON.parse(body).jobs ?? [];
      return response.end(JSON.stringify({ jobs: jobs.map(job => {
        const id = String(job.id);
        const item = id === "2" ? analog : id === "90" ? sold : null;
        return item
          ? { id, response: { status_code: 200, json: { item } } }
          : { id, response: { status_code: 404, json: { errors: ["not found"] } } };
      }) }));
    }
    response.statusCode = 404; response.end(JSON.stringify({ errors: ["not found"] }));
  });
  await listen(mock);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), LZT_TOKEN: "test", LZT_API_BASE: `http://127.0.0.1:${mock.address().port}`, LZT_READ_DELAY_MS: "0", LZT_WRITE_DELAY_MS: "0", LZT_SEARCH_DELAY_MS: "0", LZT_EDIT_DELAY_MS: "0", LZT_JOB_FILE: `/tmp/lotflow-test-${process.pid}-${port}.json` },
    stdio: "ignore"
  });
  try {
    const status = await waitForStatus(url, child);
    const defaultsResponse = await fetch(`${url}/api/profiles/defaults`);
    const defaults = await defaultsResponse.json();
    assert.equal(defaultsResponse.status, 200);
    assert.equal(defaults.profiles["world-of-tanks"].allowCategoryFallback, false);
    assert.equal(defaults.profiles["world-of-tanks"].fields.top_count.mode, "range");
    const analyzeResponse = await fetch(`${url}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: url, "x-lotflow-csrf": status.csrfToken },
      body: JSON.stringify({
        targets: [{ id: 501, category: "future-game", price: 99999, attributes: { rank: 10, login_data: "sample-login", custom_rank: "person@example.test:sample-value" } }],
        market: [{ id: 502, category: "future-game", price: 50, attributes: { rank: 10, password: "sample-password" } }],
        settings: { strategy: "active" }
      })
    });
    assert.equal(analyzeResponse.status, 200);
    const analyzed = await analyzeResponse.json();
    assert.equal(analyzed.results[0].item.attributes.rank, 10);
    assert.equal(/sample-login|sample-password|example\.test|\"raw\"/.test(JSON.stringify(analyzed)), false);
    const response = await fetch(`${url}/api/live/snapshot`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: url, "x-lotflow-csrf": status.csrfToken },
      body: JSON.stringify({ technicalPrices: [199], maxMarketPages: 1, maxSearchPlans: 2 })
    });
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.meta.targetDetailsMerged, 1);
    assert.equal(snapshot.meta.marketDetailsMerged, 1);
    assert.equal(snapshot.meta.exactHistoryTargets, 1);
    assert.equal(snapshot.results[0].proposedPrice, 120);
    assert.equal(snapshot.results[0].source, "Максимальная цена прошлых продаж этого аккаунта");
    assert.ok(snapshot.fieldCatalog["world-of-tanks"].some(field => field.field === "top_count" && field.targetCoverage === 1));
    assert.ok(snapshot.meta.discoveredFields > 0);
    const serialized = JSON.stringify(snapshot);
    assert.equal(serialized.includes("private-login"), false);
    assert.equal(serialized.includes("private-password"), false);
    assert.equal(serialized.includes('"raw"'), false);
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => mock.close(resolve));
  }
});
