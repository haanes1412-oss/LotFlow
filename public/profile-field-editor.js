import { element, fieldControls, numberControl, selectControl } from "./profile-builder-controls.js";
import { discoveredFields, inactiveFieldRule, simpleFieldRule, simplePriority } from "./profile-builder-data.js";
import { isListingMetaField } from "./listing-meta.js";
import { glossaryEntry } from "./field-glossary.js";

function valuesFromText(value) {
  return [...new Set(String(value ?? "").split(/[\n,;]+/).map(entry => entry.trim()).filter(Boolean))].slice(0, 100);
}

function fieldType(catalog, values = []) {
  if (catalog?.type) return catalog.type;
  const sample = values.find(value => value !== undefined && value !== null && value !== "");
  if (Array.isArray(sample)) return "list";
  if (typeof sample === "number") return "number";
  if (typeof sample === "boolean") return "boolean";
  return "text";
}

function setAdvancedControls(container, rule) {
  container.querySelector(".field-mode").value = rule.mode ?? "ignore";
  container.querySelector(".field-weight").value = rule.weight ?? 0;
  container.querySelector(".field-missing").value = rule.missing ?? "ignore";
  container.querySelector(".field-percent").value = rule.tolerancePercent ?? 0;
  container.querySelector(".field-absolute").value = rule.toleranceAbsolute ?? 0;
  container.querySelector(".field-required").checked = rule.required === true;
  container.querySelector(".field-search").checked = rule.search === true;
  container.querySelector(".field-buckets").value = (rule.buckets ?? []).join(", ");
  container.querySelector(".field-preferred").value = (rule.preferredValues ?? []).join("\n");
}

function markPriority(row, priority) {
  row.dataset.priority = priority;
  for (const button of row.querySelectorAll("[data-field-priority]")) {
    button.classList.toggle("selected", button.dataset.fieldPriority === priority);
    button.setAttribute("aria-pressed", String(button.dataset.fieldPriority === priority));
  }
  row.classList.toggle("required", priority === "required");
  row.classList.toggle("important", priority === "important");
}

function readAdvancedField(row) {
  const buckets = row.querySelector(".field-buckets").value.split(/[,;\s]+/).map(Number).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const preferredValues = valuesFromText(row.querySelector(".field-preferred").value);
  return {
    label: row.querySelector(".field-label").value.trim() || row.dataset.field,
    mode: row.querySelector(".field-mode").value,
    weight: Number(row.querySelector(".field-weight").value) || 0,
    missing: row.querySelector(".field-missing").value,
    required: row.querySelector(".field-required").checked,
    search: row.querySelector(".field-search").checked,
    tolerancePercent: Number(row.querySelector(".field-percent").value) || 0,
    toleranceAbsolute: Number(row.querySelector(".field-absolute").value) || 0,
    ...(buckets.length ? { buckets } : {}),
    ...(preferredValues.length ? { preferredValues } : {})
  };
}

const RUSSIAN_FIELD_WORDS = {
  account: "аккаунт", age: "возраст", amount: "количество", balance: "баланс", banned: "блокировка",
  channels: "каналы", chats: "чаты", count: "количество", country: "страна", date: "дата", days: "дни",
  email: "почта", expires: "окончание", followers: "подписчики", games: "игры", has: "наличие",
  is: "признак", language: "язык", last: "последняя", level: "уровень", linked: "привязка", login: "вход",
  months: "месяцы", number: "номер", phone: "телефон", premium: "премиум", rank: "ранг", region: "регион",
  registration: "регистрация", service: "сервис", sessions: "сессии", spam: "спам", status: "статус",
  subscription: "подписка", type: "тип", username: "имя пользователя", verified: "подтверждение", years: "годы"
};

function russianFallbackLabel(field) {
  const tokens = String(field).replace(/([a-z\d])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-zа-яё\d]+/i).filter(Boolean);
  const translated = tokens.map(token => RUSSIAN_FIELD_WORDS[token]).filter(Boolean);
  if (!translated.length) return "Дополнительный параметр аккаунта";
  const text = translated.join(" ").replace(/\b(количество) \1\b/g, "$1");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function resolveLabel(field, rule, catalogEntry) {
  const rawSpaces = field.replaceAll("_", " ");
  const glossary = glossaryEntry(field);
  const candidate = rule.label ?? catalogEntry?.label;
  const candidateIsRaw = !candidate || candidate === field || candidate === rawSpaces;
  const candidateIsRussian = /[а-яё]/i.test(String(candidate ?? ""));
  const label = glossary?.label ?? (!candidateIsRaw && candidateIsRussian ? candidate : russianFallbackLabel(field));
  return { label, hint: glossary?.hint ?? null };
}

function fieldRow(field, rule, values, catalogEntry, isMeta = false) {
  const type = fieldType(catalogEntry, values);
  const row = element("div", `profile-field simple${isMeta ? " meta" : ""}`);
  row.dataset.field = field;
  row.dataset.type = type;
  row.dataset.apiFilter = String(catalogEntry?.apiFilter === true);
  if (isMeta) row.dataset.meta = "true";

  const { label: displayLabel, hint } = resolveLabel(field, rule, catalogEntry);
  const identity = element("div", "profile-field-name");
  const label = element("input", "field-label");
  label.value = displayLabel;
  if (hint) label.title = hint;
  const readable = element("b", "field-display-label", displayLabel || "Дополнительный параметр аккаунта");
  const systemName = element("code", "field-system-name", field);
  identity.append(readable, label, systemName);
  if (hint) identity.append(element("small", "field-hint", hint));
  if (catalogEntry) {
    const targetCoverage = Math.round(Number(catalogEntry.targetCoverage ?? 0) * 100);
    const marketCoverage = Math.round(Number(catalogEntry.marketCoverage ?? 0) * 100);
    const rawExample = catalogEntry.examples?.[0];
    const example = rawExample === undefined ? "" : ` · например: ${String(Array.isArray(rawExample) ? rawExample.join(", ") : rawExample).slice(0, 48)}`;
    const typeLabels = { text: "текст", number: "число", list: "список", boolean: "да/нет" };
    identity.append(element("small", `field-meta${catalogEntry.apiFilter ? " searchable" : ""}`, `заполнено у своих ${targetCoverage}% · у аналогов ${marketCoverage}% · ${typeLabels[type] ?? "параметр"}${catalogEntry.apiFilter ? " · участвует в поиске" : ""}${example}`));
  }

  const priority = element("div", "field-priority");
  for (const [value, title] of [["required", "Обязательно"], ["important", "Важно"], ["ignore", "Не важно"]]) {
    const button = element("button", "priority-button", title);
    button.type = "button";
    button.dataset.fieldPriority = value;
    if (isMeta) {
      button.disabled = true;
      button.title = "Это свойство объявления, а не аккаунта — оно не влияет на оценку";
    }
    priority.append(button);
  }

  const details = element("details", "field-more");
  details.append(element("summary", "", "Точная настройка параметра"));
  const advanced = element("div", "profile-field-advanced");
  const buckets = element("input", "field-buckets");
  buckets.placeholder = "100, 1000, 5000";
  const preferred = element("textarea", "field-preferred");
  preferred.rows = 3;
  preferred.placeholder = "Необязательно: список особенно ценных значений, по одному на строку";
  const searchToggle = element("label", "field-search-toggle");
  const search = element("input", "field-search");
  search.type = "checkbox";
  search.disabled = isMeta || Boolean(catalogEntry && !catalogEntry.apiFilter);
  searchToggle.append(search, element("span", "", "Искать аналоги с этим параметром"));
  const requiredToggle = element("label", "field-required-toggle");
  const required = element("input", "field-required");
  required.type = "checkbox";
  required.disabled = isMeta;
  requiredToggle.append(required, element("span", "", "Жёстко исключать"));
  advanced.append(
    element("label", "", "Режим"), selectControl(fieldControls.modes, rule.mode ?? "ignore", "field-mode"),
    element("label", "", "Вес"), numberControl(rule.weight ?? 0, { minimum: 0, maximum: 20, step: .1, className: "field-weight" }),
    element("label", "", "Если данных нет"), selectControl(fieldControls.missingModes, rule.missing ?? "ignore", "field-missing"),
    element("label", "", "Допуск, %"), numberControl(rule.tolerancePercent ?? 0, { minimum: 0, maximum: 10_000, className: "field-percent" }),
    element("label", "", "Допуск, число"), numberControl(rule.toleranceAbsolute ?? 0, { minimum: 0, className: "field-absolute" }),
    requiredToggle, searchToggle,
    element("label", "", "Границы диапазонов"), buckets,
    element("label", "field-preferred-label", "Особенно ценные значения"), preferred
  );
  details.append(advanced);
  row.append(identity, priority, details);
  setAdvancedControls(advanced, isMeta ? { ...rule, mode: "ignore", weight: 0, missing: "ignore", required: false, search: false } : rule);
  const initialPriority = isMeta ? "ignore" : simplePriority(rule);
  const knownToSeller = Boolean(glossaryEntry(field)) || catalogEntry?.autoEligible === true || initialPriority !== "ignore";
  row.classList.toggle("technical-field", !knownToSeller);
  const simple = simpleFieldRule(initialPriority, type, rule);
  row.dataset.advancedChanged = String(
    !isMeta && (
      rule.mode !== simple.mode
      || Number(rule.weight ?? 0) !== Number(simple.weight ?? 0)
      || rule.missing !== simple.missing
      || Boolean(rule.required) !== Boolean(simple.required)
    )
  );
  markPriority(row, initialPriority);
  return row;
}

export function renderProfileFields(container, { catalog, category, targets, profile }) {
  const fieldMap = discoveredFields(category, targets, profile);
  for (const entry of catalog) if (!fieldMap.has(entry.field)) fieldMap.set(entry.field, []);
  for (const [field, values] of fieldMap) {
    if (profile.fields[field]) continue;
    const entry = catalog.find(candidate => candidate.field === field);
    profile.fields[field] = entry ? { ...inactiveFieldRule(field, values), label: entry.label } : inactiveFieldRule(field, values);
  }
  const normalRows = [];
  const metaRows = [];
  for (const [field, rule] of Object.entries(profile.fields).sort(([left], [right]) => left.localeCompare(right))) {
    const catalogEntry = catalog.find(entry => entry.field === field);
    const isMeta = isListingMetaField(field);
    const row = fieldRow(field, rule, fieldMap.get(field) ?? [], catalogEntry, isMeta);
    (isMeta ? metaRows : normalRows).push(row);
  }
  let ordinaryVisible = 0;
  for (const row of normalRows) {
    if (row.classList.contains("technical-field")) continue;
    ordinaryVisible += 1;
    if (ordinaryVisible > 12 && row.dataset.priority === "ignore") row.classList.add("manual-overflow-field");
  }
  const children = [...normalRows];
  if (metaRows.length) {
    const meta = element("details", "profile-meta-fields");
    meta.append(element("summary", "", `Метаданные объявления (не влияют на аккаунт) · ${metaRows.length}`));
    const list = element("div", "profile-meta-list");
    list.append(...metaRows);
    meta.append(list);
    children.push(meta);
  }
  container.replaceChildren(...children);
}

export function readProfileFields(container) {
  return Object.fromEntries([...container.querySelectorAll(".profile-field")].map(row => {
    const current = readAdvancedField(row);
    if (row.dataset.meta === "true") return [row.dataset.field, simpleFieldRule("ignore", row.dataset.type, current)];
    return [row.dataset.field, row.dataset.advancedChanged === "true"
      ? current
      : simpleFieldRule(row.dataset.priority, row.dataset.type, current)];
  }));
}

export function updateFieldPriority(row, priority) {
  if (row.dataset.meta === "true") return;
  const advanced = row.querySelector(".profile-field-advanced");
  const next = simpleFieldRule(priority, row.dataset.type, readAdvancedField(row));
  if (priority !== "ignore" && row.dataset.apiFilter === "true") next.search = true;
  setAdvancedControls(advanced, next);
  row.dataset.advancedChanged = "false";
  markPriority(row, priority);
}

export function filterProfileFields(container, query) {
  const normalized = String(query ?? "").trim().toLowerCase();
  for (const row of container.querySelectorAll(".profile-field")) {
    const label = row.querySelector(".field-label")?.value ?? "";
    row.hidden = Boolean(normalized) && !`${row.dataset.field} ${label} ${row.textContent}`.toLowerCase().includes(normalized);
  }
}
