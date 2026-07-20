import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { analyzeBatch, normalizeItem } from "./src/pricing-engine.js";
import { LztClient } from "./src/lzt-client.js";
import { categoryMap, expandItemsWithHistory, prepareApiItem, responseItems, sameItemIds, schemaFields } from "./src/api-normalizer.js";
import { PriceJobManager } from "./src/price-job-manager.js";
import { UploadJobManager } from "./src/upload-job-manager.js";
import { buildSearchPlans } from "./src/search-planner.js";
import { canonicalCategory } from "./src/category-profiles.js";
import { hydrateItems, hydratePublicItems, mergeItemRecords } from "./src/item-hydrator.js";
import { publicItem, publicResult } from "./src/public-snapshot.js";
import { builtinProfileCatalog, profileFromSettings } from "./src/profile-config.js";
import { buildFieldCatalog } from "./src/field-catalog.js";
import { buildQualityReport } from "./src/quality-report.js";
import { resolveAutomaticProfiles } from "./src/automatic-profile.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const packageInfo = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const appVersion = packageInfo.version;
const port = Number(process.env.PORT || 4173);
const defaultCurrency = String(process.env.LZT_CURRENCY || "rub").toLowerCase();
const csrfToken = randomBytes(32).toString("base64url");
const localHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const localOrigin = host => `http:${"//"}${host}`;
const client = new LztClient({
  token: process.env.LZT_TOKEN,
  baseUrl: process.env.LZT_API_BASE || packageInfo.config.apiBase,
  readDelay: Number(process.env.LZT_READ_DELAY_MS ?? 520),
  minDelay: Number(process.env.LZT_WRITE_DELAY_MS ?? 2_100),
  searchDelay: Number(process.env.LZT_SEARCH_DELAY_MS ?? 3_100),
  editDelay: Number(process.env.LZT_EDIT_DELAY_MS ?? 80)
});
const jobs = new PriceJobManager({ client, filePath: process.env.LZT_JOB_FILE || join(root, "runtime/jobs.json") });
await jobs.init();
const uploadJobs = new UploadJobManager({ client, filePath: process.env.LZT_UPLOAD_JOB_FILE || join(root, "runtime/upload-jobs.json") });
await uploadJobs.init();
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

async function jsonBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? "")) throw new Error("Ожидается Content-Type: application/json");
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 5_000_000) throw new Error("Тело запроса слишком большое"); chunks.push(chunk); }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function assertTrustedMutation(request) {
  const host = String(request.headers.host ?? "");
  if (!localHosts.has(host)) throw new Error("Запрос разрешён только с локального адреса");
  const origin = request.headers.origin;
  const expectedOrigin = localOrigin(host);
  if (origin && origin !== expectedOrigin) throw new Error("Запрос с этого источника запрещён");
  if (request.headers["x-lotflow-csrf"] !== csrfToken) throw new Error("Недействительный защитный токен");
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
  response.end(JSON.stringify(body));
}

function exactPrices(values) {
  const prices = (values ?? [99_999, 9_999]).map(Number).filter(value => Number.isFinite(value) && value > 0);
  return [...new Set(prices.length ? prices : [99_999])];
}

function expandedDemoMarket(items, minimumPerCategory = 12) {
  const result = structuredClone(items);
  const active = items.filter(item => !["sold", "paid", "closed", "closed_inactive"].includes(String(item.state ?? "active").toLowerCase()));
  const categories = new Set(items.map(item => canonicalCategory(item.category ?? item.category_name)));
  for (const category of categories) {
    const seeds = items.filter(item => canonicalCategory(item.category ?? item.category_name) === category);
    const activeCount = active.filter(item => canonicalCategory(item.category ?? item.category_name) === category).length;
    for (let index = activeCount; seeds.length && index < minimumPerCategory; index++) {
      const seed = seeds[index % seeds.length];
      const shift = ((index % 7) - 3) / 100;
      const attributes = Object.fromEntries(Object.entries(seed.attributes ?? {}).map(([field, value]) => {
        if (!Number.isFinite(Number(value)) || typeof value === "boolean" || Math.abs(Number(value)) <= 1) return [field, value];
        return [field, Math.max(0, Math.round(Number(value) * (1 + shift)))];
      }));
      result.push({
        ...structuredClone(seed),
        id: `demo-${category}-${index}`,
        seller_id: `demo-seller-${category}-${index}`,
        title: `${seed.title} · демо ${index}`,
        price: Math.max(1, Math.round(Number(seed.price) * (1 + shift))),
        state: "active",
        attributes
      });
    }
  }
  return result;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Math.round(Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback)));
}

async function categorySchema(categoryName) {
  try {
    return schemaFields(await client.categoryParams(categoryName));
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }
}

async function categoryGames(categoryName) {
  try {
    return await client.categoryGames(categoryName);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

function categoryDetailBudgets(grouped, maximum) {
  const entries = [...grouped.entries()];
  if (!entries.length || maximum <= 0) return new Map();
  const minimum = Math.min(40, Math.floor(maximum / entries.length));
  const totalTargets = entries.reduce((sum, [, items]) => sum + items.length, 0) || 1;
  const remaining = Math.max(0, maximum - minimum * entries.length);
  const budgets = new Map(entries.map(([category, items]) => [category, minimum + Math.floor(remaining * items.length / totalTargets)]));
  let allocated = [...budgets.values()].reduce((sum, value) => sum + value, 0);
  for (const [category] of entries.sort((left, right) => right[1].length - left[1].length)) {
    if (allocated >= maximum) break;
    budgets.set(category, (budgets.get(category) ?? 0) + 1); allocated += 1;
  }
  return budgets;
}

function balancedDetailRows(items, limit) {
  const unique = [...new Map((items ?? []).map(item => [String(item.item_id ?? item.id), item])).values()];
  if (unique.length <= limit) return unique;
  const sorted = unique.sort((left, right) => Number(left.price) - Number(right.price) || String(left.item_id ?? left.id).localeCompare(String(right.item_id ?? right.id)));
  if (limit <= 1) return sorted.slice(0, limit);
  return Array.from({ length: limit }, (_, index) => sorted[Math.floor(index * (sorted.length - 1) / (limit - 1))]);
}

async function loadSnapshotTargets({ body, technicalPrices, currency, includeHistory, categories }) {
  const ownedResponses = [];
  for (const price of technicalPrices) {
    const query = { pmin: price, pmax: price, show: body.show ?? "active", currency };
    ownedResponses.push(await client.ownedItemsAll(query, { maxPages: Math.min(250, Number(body.maxOwnedPages) || 100) }));
  }
  let rawTargets = Array.from(new Map(ownedResponses.flatMap(responseItems).filter(item => technicalPrices.includes(Number(item.price))).map(item => [String(item.item_id ?? item.id), item])).values());
  let targetDetailsRequested = 0; let targetDetailsReceived = 0; let targetDetailsMerged = 0; let targetDetailsError = "";
  if (rawTargets.length) {
    try {
      const hydrated = await hydrateItems(client, rawTargets, { parseSameItemIds: includeHistory });
      rawTargets = hydrated.items; targetDetailsRequested = hydrated.requested; targetDetailsReceived = hydrated.received; targetDetailsMerged = hydrated.merged;
    } catch (error) { targetDetailsError = String(error.message ?? error).slice(0, 240); }
  }
  let historyLinkedTargets = 0;
  let targetHistoryIdsFound = 0;
  if (includeHistory && rawTargets.length) {
    const prepared = rawTargets.map(item => prepareApiItem(item, { categories }));
    let userId = prepared.map(normalizeItem).find(item => item.sellerId)?.sellerId;
    if (!userId) {
      const me = await client.me(); userId = String(me.user_id ?? me.user?.user_id ?? me.user?.id ?? "");
    }
    if (userId) {
      const soldBeforeById = new Map();
      const categoryNames = [...new Set(prepared.map(item => item.category_name).filter(name => name && !/^\d+$/.test(name)))];
      for (const categoryName of categoryNames) for (const price of technicalPrices) {
        const response = await client.searchAll(categoryName, { user_id: userId, pmin: price, pmax: price, sb: true, parse_same_item_ids: true, currency, order_by: "pdate_to_down" }, { maxPages: Math.min(50, Number(body.maxSoldBeforePages) || 10) });
        for (const item of responseItems(response)) soldBeforeById.set(String(item.item_id ?? item.id), item);
      }
      rawTargets = rawTargets.map(item => soldBeforeById.has(String(item.item_id ?? item.id)) ? mergeItemRecords(item, soldBeforeById.get(String(item.item_id ?? item.id))) : item);
    }
    historyLinkedTargets = rawTargets.filter(item => sameItemIds([item]).length).length;
    targetHistoryIdsFound = sameItemIds(rawTargets).length;
  }
  return {
    rawTargets, historyLinkedTargets, targetHistoryIdsFound,
    targetDetailsRequested, targetDetailsReceived, targetDetailsMerged, targetDetailsError,
    ownedFetched: ownedResponses.reduce((sum, response) => sum + responseItems(response).length, 0)
  };
}

function groupTargets(rawTargets, categories) {
  const grouped = new Map();
  for (const raw of rawTargets) {
    const item = prepareApiItem(raw, { categories });
    if (!grouped.has(item.category_name)) grouped.set(item.category_name, []);
    grouped.get(item.category_name).push(raw);
  }
  return grouped;
}

async function collectSnapshotMarket({ body, rawTargets, categories, currency, includeHistory, maxHistoryItems }) {
  const grouped = groupTargets(rawTargets, categories);
  const targets = []; const market = []; const schemas = {}; const games = {}; const requestedHistoryIds = new Set(); const hydratedMarketIds = new Set();
  let searchedGroups = 0; let historyFetched = 0; let historyTruncated = false; let marketDetailsRequested = 0; let marketDetailsReceived = 0; let marketDetailsMerged = 0; let marketDetailsErrors = 0;
  const maxDetailedMarketItems = boundedInteger(body.maxDetailedMarketItems, 40, 0, 1_000);
  const maxSearchPlans = boundedInteger(body.maxSearchPlans, 8, 1, 80);
  const detailBudgets = categoryDetailBudgets(grouped, maxDetailedMarketItems);
  for (const [categoryName, categoryTargets] of grouped) {
    if (!categoryName || /^\d+$/.test(categoryName)) continue;
    const schema = await categorySchema(categoryName); schemas[categoryName] = schema;
    const categoryGameCatalog = await categoryGames(categoryName);
    if (categoryGameCatalog) games[categoryName] = categoryGameCatalog;
    const preparedTargets = categoryTargets.map(item => prepareApiItem(item, { categories, schema }));
    targets.push(...preparedTargets);
    const categoryMarket = []; const searchedItems = [];
    const categoryTargetsPrepared = preparedTargets.map(normalizeItem);
    if (includeHistory && historyFetched < maxHistoryItems) {
      const remaining = maxHistoryItems - historyFetched;
      const ids = sameItemIds(categoryTargets).filter(id => !requestedHistoryIds.has(id)).slice(0, remaining);
      ids.forEach(id => requestedHistoryIds.add(id));
      const history = await hydratePublicItems(client, ids.map(id => ({ item_id: id })), { limit: remaining });
      historyFetched += history.details.length; marketDetailsErrors += history.errors.length; categoryMarket.push(...history.details);
    }
    const profile = profileFromSettings(canonicalCategory(categoryName), body.settings?.categoryProfiles);
    const plans = buildSearchPlans(
      canonicalCategory(categoryName),
      categoryTargetsPrepared,
      maxSearchPlans,
      { profile, schema }
    );
    searchedGroups += plans.length;
    for (const query of plans) {
      const marketResponse = await client.searchAll(categoryName, { ...query, currency }, { maxPages: Math.min(10, Number(body.maxMarketPages) || 1) });
      const found = responseItems(marketResponse);
      categoryMarket.push(...found); searchedItems.push(...found);
      if (includeHistory && historyFetched < maxHistoryItems) {
        const remaining = maxHistoryItems - historyFetched;
        const allIds = sameItemIds(found).filter(id => !requestedHistoryIds.has(id));
        const ids = allIds.slice(0, remaining);
        ids.forEach(id => requestedHistoryIds.add(id));
        if (allIds.length > ids.length) historyTruncated = true;
        const history = await hydratePublicItems(client, ids.map(id => ({ item_id: id })), { limit: remaining });
        historyFetched += history.details.length; marketDetailsErrors += history.errors.length; categoryMarket.push(...history.details);
      } else if (includeHistory && sameItemIds(found).length) historyTruncated = true;
    }
    const categoryBudget = detailBudgets.get(categoryName) ?? 0;
    if (categoryBudget) {
      const uniqueSearchItems = balancedDetailRows(
        searchedItems.filter(item => !hydratedMarketIds.has(String(item.item_id ?? item.id))),
        categoryBudget
      );
      uniqueSearchItems.forEach(item => hydratedMarketIds.add(String(item.item_id ?? item.id)));
      if (uniqueSearchItems.length) try {
        const hydrated = await hydratePublicItems(client, uniqueSearchItems);
        marketDetailsRequested += hydrated.requested; marketDetailsReceived += hydrated.received; marketDetailsMerged += hydrated.merged;
        marketDetailsErrors += hydrated.errors.length;
        categoryMarket.push(...hydrated.items);
      } catch { marketDetailsErrors += 1; }
    }
    market.push(...new Map(expandItemsWithHistory(categoryMarket, { categories, schema }).map(item => [String(item.item_id ?? item.id), item])).values());
  }
  return {
    targets, market, schemas, games, searchedGroups, historyFetched, historyTruncated,
    marketDetailsRequested, marketDetailsReceived, marketDetailsMerged, marketDetailsErrors,
    maxDetailedMarketItems, maxSearchPlans
  };
}

async function createSnapshot(body) {
  const technicalPrices = exactPrices(body.technicalPrices);
  const currency = String(body.currency ?? defaultCurrency).toLowerCase();
  const includeHistory = body.includeHistory !== false;
  const maxHistoryItems = Math.min(2_500, Math.max(0, Number(body.maxHistoryItems) || 1_000));
  const categories = categoryMap(await client.categories());
  const targetData = await loadSnapshotTargets({ body, technicalPrices, currency, includeHistory, categories });
  const collected = await collectSnapshotMarket({ body, rawTargets: targetData.rawTargets, categories, currency, includeHistory, maxHistoryItems });
  const { targets, market, schemas } = collected;
  const settings = { ...body.settings, excludedPrices: technicalPrices };
  const fieldCatalog = buildFieldCatalog(targets, market, schemas, settings.categoryProfiles);
  const automatic = resolveAutomaticProfiles({ targets, market, fieldCatalog, categoryProfiles: settings.categoryProfiles, excludedPrices: technicalPrices });
  const effectiveSettings = { ...settings, categoryProfiles: automatic.profiles };
  const results = analyzeBatch(targets, market, effectiveSettings);
  const quality = buildQualityReport(results);
  const exactHistoryResults = results.filter(result => result.source === "Максимальная цена прошлых продаж этого аккаунта");
  const exactHistorySalesFound = exactHistoryResults.reduce((sum, result) => sum + result.analogs.length, 0);
  const normalizedTargets = targets.map(normalizeItem);
  const known = field => normalizedTargets.filter(item => item.attributes?.[field] !== undefined && item.attributes?.[field] !== null && item.attributes?.[field] !== "").length;
  const fieldCoverage = { top: known("top_count"), premium: known("premium_count"), gold: known("gold"), tanks: known("tanks"), region: known("region"), emailAccess: known("email_access") };
  const manualNoData = results.filter(result => result.status === "manual" && result.source === "Нет данных").length;
  const manualLowConfidence = results.filter(result => result.status === "manual" && result.source !== "Нет данных").length;
  const meta = {
    currency, technicalPrices, includeHistory,
    historyFetched: collected.historyFetched, historyTruncated: collected.historyTruncated,
    historyLinkedTargets: targetData.historyLinkedTargets, targetHistoryIdsFound: targetData.targetHistoryIdsFound,
    exactHistoryTargets: exactHistoryResults.length, exactHistorySalesFound, searchedGroups: collected.searchedGroups,
    targetDetailsRequested: targetData.targetDetailsRequested, targetDetailsReceived: targetData.targetDetailsReceived,
    targetDetailsMerged: targetData.targetDetailsMerged, targetDetailsError: targetData.targetDetailsError,
    marketDetailsRequested: collected.marketDetailsRequested, marketDetailsReceived: collected.marketDetailsReceived,
    marketDetailsMerged: collected.marketDetailsMerged, marketDetailsErrors: collected.marketDetailsErrors, fieldCoverage,
    maxDetailedMarketItems: collected.maxDetailedMarketItems, maxSearchPlans: collected.maxSearchPlans,
    manualNoData, manualLowConfidence, quality,
    ownedFetched: targetData.ownedFetched,
    discoveredFields: Object.values(fieldCatalog).reduce((sum, fields) => sum + fields.length, 0),
    categorySchemas: Object.keys(schemas).length, categoryGameCatalogs: Object.keys(collected.games).length,
    automaticProfiles: Object.values(automatic.report).filter(profile => profile.mode === "automatic").length,
    targetsFound: targets.length, marketFound: market.length, resultsFound: results.length
  };
  return {
    targets: targets.map(publicItem), market: market.map(publicItem), results: results.map(publicResult), schemas, games: collected.games,
    categories: [...categories.entries()].map(([id, name]) => ({ id, name })), fieldCatalog, autoProfiles: automatic.report, meta
  };
}

async function api(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") assertTrustedMutation(request);
  if (url.pathname === "/api/status") return send(response, 200, { ok: true, version: appVersion, liveConfigured: Boolean(process.env.LZT_TOKEN), currency: defaultCurrency, apiBase: client.baseUrl, csrfToken });
  if (url.pathname === "/api/profiles/defaults" && request.method === "GET") return send(response, 200, { profiles: builtinProfileCatalog() });
  if (url.pathname === "/api/demo") {
    const demo = JSON.parse(await readFile(join(root, "data/demo.json"), "utf8"));
    const market = expandedDemoMarket(demo.market);
    const fieldCatalog = buildFieldCatalog(demo.targets, market, demo.schemas);
    const automatic = resolveAutomaticProfiles({ targets: demo.targets, market, fieldCatalog });
    return send(response, 200, { ...demo, market, fieldCatalog, autoProfiles: automatic.report });
  }
  if (url.pathname === "/api/analyze" && request.method === "POST") {
    const { targets = [], market = [], settings = {}, schemas = {} } = await jsonBody(request);
    const fieldCatalog = buildFieldCatalog(targets, market, schemas, settings.categoryProfiles);
    const automatic = resolveAutomaticProfiles({ targets, market, fieldCatalog, categoryProfiles: settings.categoryProfiles, excludedPrices: settings.excludedPrices });
    const results = analyzeBatch(targets, market, { ...settings, categoryProfiles: automatic.profiles });
    return send(response, 200, { results: results.map(publicResult), quality: buildQualityReport(results), fieldCatalog, autoProfiles: automatic.report });
  }
  if (url.pathname === "/api/live/categories" && request.method === "GET") return send(response, 200, await client.categories());
  if (url.pathname === "/api/live/snapshot" && request.method === "POST") return send(response, 200, await createSnapshot(await jsonBody(request)));
  if (url.pathname === "/api/live/owned" && request.method === "POST") {
    const body = await jsonBody(request); return send(response, 200, await client.ownedItemsAll(body.query, { maxPages: body.maxPages ?? 100 }));
  }
  if (url.pathname === "/api/live/search" && request.method === "POST") {
    const body = await jsonBody(request);
    if (!body.categoryName) return send(response, 400, { error: "categoryName обязателен" });
    return send(response, 200, await client.searchAll(body.categoryName, body.query, { maxPages: body.maxPages ?? 3 }));
  }
  if (url.pathname.startsWith("/api/live/params/") && request.method === "GET") return send(response, 200, await client.categoryParams(url.pathname.split("/").pop()));
  if (url.pathname.startsWith("/api/live/games/") && request.method === "GET") return send(response, 200, await client.categoryGames(url.pathname.split("/").pop()));
  if (url.pathname === "/api/live/jobs" && request.method === "GET") return send(response, 200, { jobs: jobs.list() });
  if (url.pathname === "/api/live/jobs" && request.method === "POST") {
    const body = await jsonBody(request); if (body.confirmed !== true) return send(response, 400, { error: "Требуется confirmed=true" });
    return send(response, 202, { job: await jobs.create({ changes: body.changes, currency: body.currency ?? defaultCurrency }) });
  }
  const jobMatch = url.pathname.match(/^\/api\/live\/jobs\/([\w-]+)(?:\/(resume|cancel))?$/);
  if (jobMatch && request.method === "GET" && !jobMatch[2]) { const job = jobs.get(jobMatch[1]); return job ? send(response, 200, { job }) : send(response, 404, { error: "Очередь не найдена" }); }
  if (jobMatch && request.method === "POST" && jobMatch[2] === "resume") return send(response, 200, { job: await jobs.resume(jobMatch[1]) });
  if (jobMatch && request.method === "POST" && jobMatch[2] === "cancel") return send(response, 200, { job: await jobs.cancel(jobMatch[1]) });
  if (url.pathname === "/api/live/upload-jobs" && request.method === "GET") return send(response, 200, { jobs: uploadJobs.list() });
  if (url.pathname === "/api/live/upload-jobs" && request.method === "POST") {
    const body = await jsonBody(request); if (body.confirmed !== true) return send(response, 400, { error: "Требуется confirmed=true" });
    return send(response, 202, { job: await uploadJobs.create({ items: body.items, currency: body.currency ?? defaultCurrency }) });
  }
  const uploadJobMatch = url.pathname.match(/^\/api\/live\/upload-jobs\/([\w-]+)(?:\/(resume|cancel))?$/);
  if (uploadJobMatch && request.method === "GET" && !uploadJobMatch[2]) { const job = uploadJobs.get(uploadJobMatch[1]); return job ? send(response, 200, { job }) : send(response, 404, { error: "Очередь публикации не найдена" }); }
  if (uploadJobMatch && request.method === "POST" && uploadJobMatch[2] === "resume") return send(response, 200, { job: await uploadJobs.resume(uploadJobMatch[1]) });
  if (uploadJobMatch && request.method === "POST" && uploadJobMatch[2] === "cancel") return send(response, 200, { job: await uploadJobs.cancel(uploadJobMatch[1]) });
  return false;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await api(request, response, url);
      if (handled !== false) return;
      return send(response, 404, { error: "API route not found" });
    }
    const relative = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^[/\\]+/, "");
    if (relative.includes("..")) return send(response, 403, { error: "Forbidden" });
    const file = join(publicRoot, relative);
    const content = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(content);
  } catch (error) {
    if (response.headersSent) return response.destroy();
    if (error.code === "ENOENT") return send(response, 404, { error: "Not found" });
    if (/локального адреса|источника запрещён|защитный токен/i.test(error.message)) return send(response, 403, { error: error.message });
    if (/Content-Type/i.test(error.message)) return send(response, 415, { error: error.message });
    send(response, /не найден|обязател|некоррект|допустимо|требуется/i.test(error.message) ? 400 : 500, { error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`LotFlow: ${localOrigin(`127.0.0.1:${port}`)}\n`);
});
