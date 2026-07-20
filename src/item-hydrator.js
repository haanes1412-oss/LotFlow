import { responseItems, sameItemIds, unwrapResponseItem } from "./api-normalizer.js";

function itemId(item) {
  const value = item?.item_id ?? item?.id;
  return value === undefined || value === null ? "" : String(value);
}

export function mergeItemRecords(base, detail) {
  if (!detail) return base;
  const related = sameItemIds([base, detail]);
  const attributes = base?.attributes || detail?.attributes ? { ...base?.attributes, ...detail?.attributes } : null;
  const baseItemId = base?.item_id ?? base?.id;
  return {
    ...base,
    ...detail,
    ...(baseItemId !== undefined ? { item_id: baseItemId } : {}),
    ...(base?.id !== undefined ? { id: base.id } : {}),
    ...(attributes ? { attributes } : {}),
    ...(related.length ? { same_item_ids: related } : {})
  };
}

export async function hydrateItems(client, items, { parseSameItemIds = true, chunkSize = 250, limit = Infinity } = {}) {
  const ids = [...new Set((items ?? []).map(itemId).filter(Boolean))].slice(0, Math.max(0, Number(limit) || 0));
  const details = [];
  const size = Math.min(250, Math.max(1, Number(chunkSize) || 250));
  for (let index = 0; index < ids.length; index += size) {
    details.push(...responseItems(await client.bulkItems(ids.slice(index, index + size), { parseSameItemIds })));
  }
  const byId = new Map();
  for (const detail of details) {
    const idsForDetail = [itemId(detail), detail?.requested_item_id].filter(Boolean).map(String);
    for (const id of idsForDetail) byId.set(id, detail);
  }
  let merged = 0;
  const hydrated = (items ?? []).map(item => {
    const detail = byId.get(itemId(item));
    if (!detail) return item;
    merged += 1;
    return mergeItemRecords(item, detail);
  });
  return { items: hydrated, requested: ids.length, received: details.length, merged, details };
}

function batchJobs(response) {
  const value = response?.jobs ?? response?.data?.jobs ?? response?.responses ?? response?.results ?? response?.data ?? response;
  if (Array.isArray(value)) return value.map((job, index) => [String(job?.id ?? job?.job_id ?? index), job]);
  if (value && typeof value === "object") return Object.entries(value);
  return [];
}

function batchJobItem(key, job) {
  const id = String(job?.id ?? job?.job_id ?? key ?? "");
  const envelope = job?.response ?? job?.result ?? job;
  const status = Number(envelope?.status_code ?? envelope?.status ?? job?.status_code ?? job?.status ?? 200);
  if (Number.isFinite(status) && status >= 400) return null;
  let payload = envelope?.json ?? envelope?.data ?? envelope?.body ?? envelope;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { return null; }
  }
  const item = responseItems(payload)[0] ?? unwrapResponseItem(payload?.item ?? payload, id);
  if (!item || typeof item !== "object") return null;
  return unwrapResponseItem(item, id);
}

export function batchResponseItems(response, requestedIds = []) {
  return batchJobs(response).map(([key, job], index) => {
    const fallback = job?.id ?? job?.job_id ?? requestedIds[index] ?? key;
    return batchJobItem(fallback, job);
  }).filter(Boolean);
}

// /bulk/items intentionally works only for the token owner's own/purchased
// accounts. Public market cards are retrieved through official GET /{id}
// jobs in POST /batch, while the original search row remains usable if one
// job or an entire chunk fails.
export async function hydratePublicItems(client, items, { chunkSize = 10, limit = Infinity } = {}) {
  const original = items ?? [];
  const ids = [...new Set(original.map(itemId).filter(Boolean))].slice(0, Math.max(0, Number(limit) || 0));
  const size = Math.min(10, Math.max(1, Number(chunkSize) || 10));
  const details = []; const errors = [];
  for (let index = 0; index < ids.length; index += size) {
    const chunk = ids.slice(index, index + size);
    try { details.push(...batchResponseItems(await client.batchGetItems(chunk), chunk)); }
    catch (error) { errors.push({ ids: chunk, message: String(error?.message ?? error).slice(0, 240) }); }
  }
  const byId = new Map();
  for (const detail of details) {
    for (const id of [itemId(detail), detail?.requested_item_id].filter(Boolean).map(String)) byId.set(id, detail);
  }
  let merged = 0;
  const hydrated = original.map(item => {
    const detail = byId.get(itemId(item));
    if (!detail) return item;
    merged += 1;
    return mergeItemRecords(item, detail);
  });
  return { items: hydrated, requested: ids.length, received: details.length, merged, details, errors };
}
