import { hasNextPage, responseItems } from "./api-normalizer.js";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export function apiCategorySlug(categoryName) {
  const value = String(categoryName ?? "").trim().toLowerCase();
  const aliases = {
    wot: "world-of-tanks",
    "world_of_tanks": "world-of-tanks",
    "world of tanks": "world-of-tanks",
    wot_blitz: "wot-blitz",
    "wot blitz": "wot-blitz"
  };
  return aliases[value] ?? value;
}

export class LztApiError extends Error {
  constructor(status, message) { super(message); this.name = "LztApiError"; this.status = status; }
}

function appendValues(params, key, value) {
  if (value === "" || value === undefined || value === null) return;
  if (Array.isArray(value)) {
    const arrayKey = key.endsWith("[]") ? key : `${key}[]`;
    for (const entry of value) params.append(arrayKey, String(entry));
  } else params.append(key, String(value));
}

export class LztClient {
  constructor({ token, baseUrl, readDelay = 520, minDelay = 2_100, searchDelay = 3_100, editDelay = 80 } = {}) {
    if (!baseUrl) throw new Error("baseUrl обязателен");
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.readDelay = readDelay;
    this.minDelay = minDelay;
    this.searchDelay = searchDelay;
    this.editDelay = editDelay;
    this.lastRequestAt = new Map();
  }

  async request(path, { method = "GET", query, body, jsonBody, rate = "read", retries = 3 } = {}) {
    if (!this.token) throw new Error("LZT_TOKEN не задан");
    const interval = rate === "search" ? this.searchDelay : rate === "edit" ? this.editDelay : rate === "write" ? this.minDelay : this.readDelay;
    const previous = this.lastRequestAt.get(rate) ?? 0;
    const wait = interval - (Date.now() - previous);
    if (wait > 0) await delay(wait);
    const url = new URL(`${this.baseUrl}/${String(path).replace(/^\//, "")}`);
    for (const [key, value] of Object.entries(query ?? {})) appendValues(url.searchParams, key, value);
    if (body && jsonBody !== undefined) throw new Error("Нельзя одновременно передать body и jsonBody");
    const formPayload = body ? new URLSearchParams() : undefined;
    for (const [key, value] of Object.entries(body ?? {})) appendValues(formPayload, key, value);
    const jsonPayload = jsonBody === undefined ? undefined : JSON.stringify(jsonBody);
    let response;
    try {
      const options = {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(formPayload ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          ...(jsonPayload !== undefined ? { "Content-Type": "application/json" } : {})
        }
      };
      if (formPayload) options.body = formPayload;
      if (jsonPayload !== undefined) options.body = jsonPayload;
      response = await fetch(url, options);
      this.lastRequestAt.set(rate, Date.now());
      if (RETRYABLE_STATUSES.has(response.status) && retries > 0) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const retryMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : Math.max(interval, 1_000 * (4 - retries));
        await delay(retryMs);
        return this.request(path, { method, query, body, jsonBody, rate, retries: retries - 1 });
      }
      if (!response.ok) throw new LztApiError(response.status, `LZT API ${response.status} (${url.origin}${url.pathname}): ${(await response.text()).slice(0, 240)}`);
      return response.json();
    } catch (error) {
      if (retries > 0 && (!(error instanceof LztApiError) || RETRYABLE_STATUSES.has(error.status))) { await delay(1_000 * (4 - retries)); return this.request(path, { method, query, body, jsonBody, rate, retries: retries - 1 }); }
      throw error;
    }
  }

  async collectPages(fetchPage, { maxPages = 100 } = {}) {
    const items = []; let lastResponse = null;
    for (let page = 1; page <= maxPages; page++) {
      lastResponse = await fetchPage(page);
      const pageItems = responseItems(lastResponse);
      items.push(...pageItems);
      if (!hasNextPage(lastResponse, items.length) || !pageItems.length) break;
    }
    return { ...lastResponse, items, fetchedItems: items.length };
  }

  categories() { return this.request("/category"); }
  me() { return this.request("/me"); }
  ownedItems(query = {}) { return this.request("/user/items", { query, rate: "read" }); }
  ownedItemsAll(query = {}, options) { return this.collectPages(page => this.ownedItems({ ...query, page }), options); }
  categoryParams(categoryName) { return this.request(`/${apiCategorySlug(categoryName)}/params`); }
  categoryGames(categoryName) { return this.request(`/${apiCategorySlug(categoryName)}/games`); }
  search(categoryName, query = {}) { return this.request(`/${apiCategorySlug(categoryName)}`, { query, rate: "search" }); }
  searchAll(categoryName, query = {}, options = { maxPages: 3 }) { return this.collectPages(page => this.search(categoryName, { ...query, page }), options); }
  item(itemId) { return this.request(`/${itemId}`, { rate: "read" }); }
  bulkItems(itemIds, { parseSameItemIds = true } = {}) { return this.request("/bulk/items", { method: "POST", body: { item_id: itemIds, ...(parseSameItemIds ? { parse_same_item_ids: true } : {}) }, rate: "write" }); }
  // /batch is still a POST request. The public Market API documents a stricter
  // 30 requests/minute limit for every non-GET route, so treating it as a GET
  // can trigger 429s during large hydrations.
  batch(jobs) { return this.request("/batch", { method: "POST", jsonBody: { jobs }, rate: "write" }); }
  batchGetItems(itemIds) {
    const ids = [...new Set((itemIds ?? []).map(String).filter(Boolean))].slice(0, 10);
    return this.batch(ids.map(id => ({ id, method: "GET", url: `/${id}`, params: {} })));
  }

  // Official endpoint: POST /item/add. This is deliberately routed through
  // the normal non-GET limiter (30 requests/minute) rather than a fast client
  // path, so a resumed bulk upload stays inside Market limits.
  addAccount(payload) { return this.request("/item/add", { method: "POST", body: payload, rate: "write" }); }

  async updatePrice(itemId, price, currency = "rub") {
    try { return await this.request(`/${itemId}/edit`, { method: "PUT", body: { price: String(price), currency }, rate: "edit" }); }
    catch (error) {
      if (!(error instanceof LztApiError) || ![404, 405].includes(error.status)) throw error;
      return this.request(`/${itemId}`, { method: "PUT", body: { key: "price", value: String(price), currency }, rate: "edit" });
    }
  }
}
