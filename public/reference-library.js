// A seller-owned local library of confirmed prices. It is deliberately opt-in:
// imported entries become additional sold evidence, never automatic rules and
// never leave the browser unless the seller exports the JSON file.

export const REFERENCE_STORAGE_KEY = "lotflow.confirmed-prices.v1";
const MAX_REFERENCES = 2_000;

function cleanText(value, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function safeValue(value) {
  if (typeof value === "string") return cleanText(value, 240);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(safeValue).filter(value => value !== undefined).slice(0, 80);
  return undefined;
}

function safeAttributes(attributes) {
  return Object.fromEntries(Object.entries(attributes ?? {})
    .filter(([key]) => /^[\w.-]{1,80}$/u.test(key))
    .map(([key, value]) => [key, safeValue(value)])
    .filter(([, value]) => value !== undefined));
}

export function normalizeReference(entry, index = 0) {
  const category = cleanText(entry?.category ?? entry?.item?.category, 80).toLowerCase();
  const price = Math.round(Number(entry?.price ?? entry?.confirmedPrice ?? entry?.proposedPrice));
  if (!category || !Number.isFinite(price) || price < 1 || price > 1_000_000_000) return null;
  const raw = entry?.item && typeof entry.item === "object" ? entry.item : entry;
  const sourceId = cleanText(raw?.id ?? entry?.id, 80) || String(index + 1);
  return {
    id: `reference:${category}:${sourceId}:${index}`,
    category,
    title: cleanText(raw?.title ?? entry?.title ?? "Подтверждённая цена", 180),
    price,
    state: "sold",
    soldAt: Number(entry?.verifiedAt ?? entry?.soldAt) || 0,
    attributes: safeAttributes(raw?.attributes ?? entry?.attributes),
    reference: true,
    verifiedAt: Number(entry?.verifiedAt) || Date.now()
  };
}

export function normalizeReferenceLibrary(payload) {
  const raw = Array.isArray(payload) ? payload : payload?.references ?? payload?.items ?? [];
  if (!Array.isArray(raw)) return { version: 1, items: [] };
  const seen = new Set(); const items = [];
  for (const [index, entry] of raw.entries()) {
    const item = normalizeReference(entry, index);
    if (!item) continue;
    const key = `${item.category}|${item.title}|${item.price}|${JSON.stringify(item.attributes)}`;
    if (seen.has(key)) continue;
    seen.add(key); items.push(item);
    if (items.length >= MAX_REFERENCES) break;
  }
  return { version: 1, items };
}

export function readReferenceLibrary(storage = localStorage) {
  try { return normalizeReferenceLibrary(JSON.parse(storage.getItem(REFERENCE_STORAGE_KEY) ?? "[]")); }
  catch { return { version: 1, items: [] }; }
}

export function addConfirmedReference(library, result, price) {
  const item = normalizeReference({ item: result?.item, price, verifiedAt: Date.now() }, library?.items?.length ?? 0);
  if (!item) return normalizeReferenceLibrary(library);
  return normalizeReferenceLibrary({ items: [...(library?.items ?? []), item] });
}

export function referenceExport(library) {
  return { format: "lotflow-confirmed-prices", version: 1, exportedAt: new Date().toISOString(), references: normalizeReferenceLibrary(library).items };
}
