function configuredFields(profile) {
  return Object.entries(profile?.fields ?? {})
    .filter(([, rule]) => rule?.mode !== "ignore" && Number(rule?.weight) > 0)
    .map(([field]) => field);
}

function diagnosticFields(items, selected, maximum = 12) {
  const selectedSet = new Set(selected);
  const values = new Map();
  for (const item of items) for (const [field, value] of Object.entries(item?.attributes ?? {})) {
    if (selectedSet.has(field)) continue;
    if (!values.has(field)) values.set(field, []);
    values.get(field).push(value);
  }
  return [...values].map(([field, fieldValues]) => {
    const usable = fieldValues.filter(value => ["number", "boolean", "list"].includes(valueKind(value)));
    const signatures = new Set(usable.map(value => Array.isArray(value) ? [...value].map(String).sort().join("\u0000") : String(value)));
    return { field, score: usable.length / items.length + Math.min(signatures.size, 10) / 10, usable: usable.length, distinct: signatures.size };
  }).filter(entry => entry.usable && entry.distinct > 1)
    .sort((left, right) => right.score - left.score || left.field.localeCompare(right.field))
    .slice(0, maximum)
    .map(entry => entry.field);
}

function fieldValue(item, field) {
  return item?.attributes?.[field] ?? item?.[field];
}

function valueKind(value) {
  if (Array.isArray(value)) return "list";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "boolean") return "boolean";
  return value == null || value === "" ? "missing" : "text";
}

function fieldStats(items, field) {
  const values = items.map(item => fieldValue(item, field));
  const numbers = values.filter(value => valueKind(value) === "number");
  const listLengths = values.filter(Array.isArray).map(value => value.length);
  return {
    minimum: numbers.length ? Math.min(...numbers) : 0,
    maximum: numbers.length ? Math.max(...numbers) : 0,
    listMaximum: listLengths.length ? Math.max(...listLengths) : 0
  };
}

function listDistance(left, right) {
  const a = new Set(left.map(String));
  const b = new Set(right.map(String));
  const union = new Set([...a, ...b]).size;
  if (!union) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return 1 - intersection / union;
}

function valueDistance(left, right, stats) {
  const leftKind = valueKind(left);
  const rightKind = valueKind(right);
  if (leftKind === "missing" && rightKind === "missing") return 0;
  if (leftKind !== rightKind || leftKind === "missing") return 1;
  if (leftKind === "list") return listDistance(left, right);
  if (leftKind === "number") {
    const span = stats.maximum - stats.minimum;
    return span > 0 ? Math.min(1, Math.abs(left - right) / span) : 0;
  }
  return String(left) === String(right) ? 0 : 1;
}

function targetDistance(left, right, fields, stats) {
  if (!fields.length) return 0;
  return fields.reduce((sum, field) => sum + valueDistance(fieldValue(left, field), fieldValue(right, field), stats[field]), 0) / fields.length;
}

function richness(item, fields, stats) {
  return fields.reduce((score, field) => {
    const value = fieldValue(item, field);
    if (valueKind(value) === "number") {
      const span = stats[field].maximum - stats[field].minimum;
      return score + (span > 0 ? (value - stats[field].minimum) / span : Number(value !== 0));
    }
    if (Array.isArray(value)) return score + (stats[field].listMaximum ? value.length / stats[field].listMaximum : 0);
    return score + Number(value !== undefined && value !== null && value !== "" && value !== false);
  }, 0);
}

export function hasConfiguredProfile(profile) {
  return configuredFields(profile).length > 0 || (profile?.fixedPriceRules ?? []).length > 0;
}

export function selectProfilePreviewTargets(targets, profile, limit = 5) {
  const items = [...targets];
  if (items.length <= limit) return items;
  const selectedFields = configuredFields(profile);
  const fields = [...selectedFields, ...diagnosticFields(items, selectedFields)];
  if (!fields.length) return items.slice(0, limit);
  const stats = Object.fromEntries(fields.map(field => [field, fieldStats(items, field)]));
  const score = item => richness(item, fields, stats);
  const remaining = [...items].sort((left, right) => score(right) - score(left) || String(left.id).localeCompare(String(right.id)));
  const chosen = [remaining.shift()];
  while (chosen.length < limit && remaining.length) {
    let bestIndex = 0;
    let bestDistance = -1;
    let bestRichness = -1;
    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index];
      const distance = Math.min(...chosen.map(current => targetDistance(item, current, fields, stats)));
      const itemRichness = score(item);
      if (distance > bestDistance || (distance === bestDistance && itemRichness > bestRichness)) {
        bestIndex = index;
        bestDistance = distance;
        bestRichness = itemRichness;
      }
    }
    chosen.push(remaining.splice(bestIndex, 1)[0]);
  }
  return chosen;
}
