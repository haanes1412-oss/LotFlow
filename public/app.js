import { createProfileBuilder } from "./profile-builder.js";
import { tableCell, textElement } from "./dom-helpers.js";
import { catalogFromParams } from "./profile-builder-data.js";
import { updateProfileNotices } from "./profile-notices.js";
import { selectProfilePreviewTargets } from "./profile-preview-sample.js";
import { REFERENCE_STORAGE_KEY, addConfirmedReference, normalizeReferenceLibrary, readReferenceLibrary, referenceExport } from "./reference-library.js";

const state = { targets: [], market: [], results: [], schemas: {}, categories: [], fieldCatalog: {}, autoProfiles: {}, selected: new Set(), categoryProfiles: {}, references: readReferenceLibrary(), liveConfigured: false, currency: "rub", csrfToken: null, snapshotCurrency: null, snapshotMeta: null, appVersion: "", historyLoaded: false, jobId: null, jobKind: "price", polling: false, uploadItems: [] };
const $ = selector => document.querySelector(selector);
const symbols = { rub: "₽", usd: "$", eur: "€", uah: "₴", kzt: "₸", byn: "Br", gbp: "£", cny: "¥", try: "₺", jpy: "¥", brl: "R$" };
const categoryNames = { battlenet: "Battle.net", discord: "Discord", ea: "EA", epicgames: "Epic Games", "escape-from-tarkov": "Escape from Tarkov", fortnite: "Fortnite", gifts: "Подарки", hytale: "Hytale", instagram: "Instagram", llm: "ИИ-сервисы", mihoyo: "HoYoverse", minecraft: "Minecraft", riot: "Riot Games", roblox: "Roblox", socialclub: "Rockstar Social Club", steam: "Steam", supercell: "Supercell", telegram: "Telegram", tiktok: "TikTok", uplay: "Ubisoft Connect", vpn: "VPN-сервисы", warface: "Warface", "world-of-tanks": "World of Tanks", "wot-blitz": "WoT Blitz" };
const money = value => value == null ? "—" : `${new Intl.NumberFormat("ru-RU").format(value)} ${symbols[state.currency] ?? state.currency.toUpperCase()}`;
const categoryOf = item => String(item?.category_name ?? item?.category ?? item?.category_id ?? "unknown").toLowerCase();
const categoryLabel = category => categoryNames[category] || String(category).replaceAll("-", " ").replace(/\b\p{L}/gu, letter => letter.toUpperCase());
const hasManualProfile = category => state.categoryProfiles?.[category]?.automatic === false;

function toast(message, duration = 2600) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), duration); }
function technicalPrices() { return [...new Set($("#technicalPrices").value.split(/[,;\s]+/).map(Number).filter(value => Number.isFinite(value) && value > 0))]; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function formatSeconds(total) { const s = Math.max(0, Math.round(total)); return s >= 60 ? `${Math.floor(s / 60)} мин ${s % 60} с` : `${s} с`; }
function estimateAnalysisSeconds() {
  const categories = new Set(state.targets.map(categoryOf)).size || 1;
  const plans = Math.min(Number($("#searchPlans").value) || 8, 80);
  const pages = Math.max(1, Number($("#marketPages").value) || 1);
  const details = Math.min(Math.max(0, Number($("#marketDetails").value) || 0), 1000);
  return Math.max(10, Math.round(categories * plans * 3 + categories * plans * pages * 0.4 + details * 0.05));
}
const scanPresets = {
  fast: { pages: 1, plans: 8, details: 0, help: "Быстро: все аккаунты, расширенная рыночная выборка без бесполезной догрузки карточек." },
  balanced: { pages: 1, plans: 16, details: 0, help: "Баланс: больше независимых рыночных сегментов; подходит для финальной проверки." },
  deep: { pages: 2, plans: 32, details: 0, help: "Максимальная глубина: для редких и дорогих аккаунтов; заметно дольше." }
};
function applyScanPreset(name) {
  const preset = scanPresets[name]; if (!preset) return;
  $("#marketPages").value = preset.pages; $("#searchPlans").value = preset.plans; $("#marketDetails").value = preset.details;
  $("#scanPresetHelp").textContent = preset.help;
}
function startAnalysisProgress(phase, { indeterminate = false, estimateSeconds = 0 } = {}) {
  const panel = $("#analysisProgress"); if (!panel) return;
  const started = Date.now();
  panel.hidden = false; panel.classList.toggle("indeterminate", indeterminate);
  $("#apPhase").textContent = phase; $("#apBar").style.width = indeterminate ? "" : "2%"; $("#apDetail").textContent = "";
  const tick = () => {
    const elapsed = (Date.now() - started) / 1000;
    $("#apElapsed").textContent = `прошло ${formatSeconds(elapsed)}`;
    if (!indeterminate && estimateSeconds > 0) {
      $("#apBar").style.width = `${Math.min(95, (elapsed / estimateSeconds) * 100).toFixed(0)}%`;
      $("#apDetail").textContent = elapsed < estimateSeconds ? `осталось примерно ${formatSeconds(estimateSeconds - elapsed)} (оценка, аккаунтов много)` : "почти готово, дозагружаем данные…";
    }
  };
  tick(); state.progressTimer = setInterval(tick, 1000);
}
function stopAnalysisProgress(ok = true) {
  if (state.progressTimer) { clearInterval(state.progressTimer); state.progressTimer = null; }
  const panel = $("#analysisProgress"); if (!panel) return;
  panel.classList.remove("indeterminate");
  if (ok) { $("#apBar").style.width = "100%"; setTimeout(() => { panel.hidden = true; $("#apBar").style.width = "0"; }, 600); }
  else { panel.hidden = true; $("#apBar").style.width = "0"; }
}

async function request(url, options) {
  const method = String(options?.method ?? "GET").toUpperCase();
  const headers = new Headers(options?.headers ?? {});
  if (!["GET", "HEAD"].includes(method) && state.csrfToken) headers.set("X-LotFlow-CSRF", state.csrfToken);
  const response = await fetch(url, { ...options, headers }); const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ошибка запроса"); return data;
}

function lockCurrency(currency = null) {
  state.snapshotCurrency = currency;
  $("#currency").disabled = Boolean(currency);
}

function syncCurrencyUi() {
  $("#currency").value = state.currency;
  $("#minimumCurrency").textContent = symbols[state.currency] ?? state.currency.toUpperCase();
}

function analysisSettings() {
  return { strategy: $("#strategy").value, discountPercent: Number($("#discount").value), minimumPrice: Number($("#minimumPrice").value), lowConfidenceAction: $("#lowConfidence").value, excludedPrices: technicalPrices(), categoryProfiles: state.categoryProfiles, referenceItems: state.references.items };
}

function updateReferenceUi() {
  const button = $("#referenceExport"); const clear = $("#referenceClear");
  const count = state.references.items.length;
  $("#referenceSummary").textContent = count ? `Подтверждённых цен: ${count}. Используются только как дополнительный проданный аналог.` : "Подтверждённых цен пока нет.";
  button.disabled = !count; clear.disabled = !count;
}

function saveReferences(next) {
  state.references = normalizeReferenceLibrary(next);
  localStorage.setItem(REFERENCE_STORAGE_KEY, JSON.stringify(state.references));
  updateReferenceUi();
}

function updateMetrics() {
  $("#targetCount").textContent = state.targets.length;
  $("#categoryCount").textContent = `${new Set(state.targets.map(x => x.category_name ?? (typeof x.category === "string" ? x.category : null) ?? x.category_id).filter(Boolean)).size} категорий`;
  const ready = state.results.filter(x => x.status === "ready" && x.proposedPrice != null);
  $("#readyCount").textContent = ready.length; $("#manualCount").textContent = state.results.filter(x => x.status === "manual").length;
  $("#averagePrice").textContent = ready.length ? money(Math.round(ready.reduce((sum, x) => sum + x.proposedPrice, 0) / ready.length)) : "—";
  $("#selectedCount").textContent = state.selected.size; $("#applyPrices").disabled = !state.selected.size || !state.liveConfigured || Boolean(state.jobId);
}

function renderSnapshotDiagnostics(meta = null) {
  const element = $("#snapshotDiagnostics");
  state.snapshotMeta = meta;
  if (!meta) { element.hidden = true; element.textContent = ""; return; }
  const linked = Number(meta.historyLinkedTargets ?? 0);
  const ids = Number(meta.targetHistoryIdsFound ?? 0);
  const exact = Number(meta.exactHistoryTargets ?? 0);
  const sales = Number(meta.exactHistorySalesFound ?? 0);
  const targets = Number(meta.targetsFound ?? 0);
  const details = Number(meta.targetDetailsMerged ?? 0);
  const marketDetails = Number(meta.marketDetailsMerged ?? 0);
  const marketDetailsReceived = Number(meta.marketDetailsReceived ?? 0);
  const marketDetailsErrors = Number(meta.marketDetailsErrors ?? 0);
  const searchedGroups = Number(meta.searchedGroups ?? 0);
  const coverage = meta.fieldCoverage ?? {};
  const detailStatus = meta.targetDetailsError ? "bulk-загрузка деталей завершилась с ошибкой" : `детали раскрыты для ${details} из ${targets}`;
  const summary = document.createElement("div");
  const appendLine = (label, value) => {
    summary.append(textElement("b", "", label), document.createTextNode(` ${value}`), document.createElement("br"));
  };
  appendLine("Диагностика загрузки:", `${detailStatus}; деталей рынка: ${marketDetailsReceived}/${marketDetails}; ошибок пакетов: ${marketDetailsErrors}.`);
  appendLine("Проверка истории:", `у ${linked} лотов найдено ${ids} прошлых ID; реальные цены подтянулись для ${exact} лотов (${sales} продаж).`);
  appendLine("Поля WoT:", `топы ${Number(coverage.top ?? 0)}, премы ${Number(coverage.premium ?? 0)}, танки ${Number(coverage.tanks ?? 0)}, почта ${Number(coverage.emailAccess ?? 0)}.`);
  appendLine("Каталог настройки:", `обнаружено безопасных полей ${Number(meta.discoveredFields ?? 0)}; схем категорий ${Number(meta.categorySchemas ?? 0)}; каталогов игр ${Number(meta.categoryGameCatalogs ?? 0)}.`);
  const automatic = Object.values(state.autoProfiles ?? {}).filter(profile => profile.mode === "automatic");
  if (automatic.length) {
    const calibrated = automatic.filter(profile => profile.calibration?.status === "reliable").length;
    const blocked = automatic.length - calibrated;
    const fields = automatic.reduce((sum, profile) => sum + (profile.selectedFields?.length ?? 0), 0);
    appendLine("Автопрофили:", `${automatic.length} категорий; выбрано ${fields} признаков; надёжно откалибровано ${calibrated}; без массового применения ${blocked}.`);
  }
  const qualityWarnings = meta.quality?.warnings ?? [];
  appendLine("Контроль выборки:", qualityWarnings.length ? qualityWarnings.map(warning => warning.message).join("; ") + "." : "сильных перекосов в ценах и аналогах не найдено.");
  element.classList.toggle("has-warning", qualityWarnings.length > 0 || marketDetailsErrors > 0);
  summary.lastElementChild?.remove();
  const download = textElement("button", "button ghost diagnostic-download", "Скачать диагностику");
  download.type = "button";
  element.replaceChildren(summary, download);
  element.hidden = false;
}

const DIAGNOSTIC_FIELDS = ["top_count", "premium_count", "gold", "silver", "tanks", "region", "email_access", "phone_linked", "origin", "battles", "followers", "cookie_login", "spam_block", "country"];
const DIAGNOSTIC_SAFE_KEYS = new Set(["cookie_login", "email_access", "email_type", "phone_linked", "sessions"]);
const DIAGNOSTIC_SENSITIVE = /(?:^|_)(?:passwords?|passwd|pass|login|mail|email|phone|telephone|token|secret|sessions?|auth|proxy|credential|information|contact|buyer|seller|raw|encoded|username|note|link|url|href)(?:_|$)/i;
function normalizedDiagnosticKey(key) {
  return String(key ?? "").replace(/([a-z\d])([A-Z])/g, "$1_$2").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").toLowerCase();
}
function diagnosticKeySafe(key) {
  const normalized = normalizedDiagnosticKey(key);
  return Boolean(normalized) && (DIAGNOSTIC_SAFE_KEYS.has(normalized) || !DIAGNOSTIC_SENSITIVE.test(normalized));
}
function diagnosticValueSafe(value) {
  if (value === null || ["number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(diagnosticValueSafe);
  if (typeof value !== "string") return false;
  const text = value.trim();
  return text.length <= 1_000 && !/(?:https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|%40|%3a|^[^:\s]{2,100}:[^:\s]{2,100}$)/i.test(text);
}
function sanitizeDiagnostic(value, key = "") {
  if (key && !diagnosticKeySafe(key)) return undefined;
  if (Array.isArray(value)) return value.map(entry => sanitizeDiagnostic(entry)).filter(entry => entry !== undefined);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).flatMap(([childKey, child]) => {
    const sanitized = sanitizeDiagnostic(child, childKey);
    return sanitized === undefined ? [] : [[childKey, sanitized]];
  }));
  return diagnosticValueSafe(value) ? value : undefined;
}
function diagnosticAttributes(item) {
  const configured = Object.values(state.categoryProfiles).flatMap(profile => Object.keys(profile.fields ?? {}));
  const discovered = Object.values(state.fieldCatalog).flatMap(fields => fields.map(field => field.field));
  const fields = new Set([...DIAGNOSTIC_FIELDS, ...configured, ...discovered]);
  return Object.fromEntries([...fields].filter(key => diagnosticKeySafe(key) && item?.attributes?.[key] !== undefined && diagnosticValueSafe(item.attributes[key])).map(key => [key, item.attributes[key]]));
}
function exportDiagnostics() {
  if (!state.snapshotMeta || !state.results.length) return toast("Сначала загрузите и оцените лоты");
  const payload = {
    app: "LotFlow", version: state.appVersion, createdAt: new Date().toISOString(),
    note: "Диагностика автоматически очищена от токенов, реквизитов входа, контактов и служебных полей.", meta: state.snapshotMeta, categoryProfiles: state.categoryProfiles, autoProfiles: state.autoProfiles, fieldCatalog: state.fieldCatalog,
    results: state.results.map(result => ({
      item: { id: result.item.id, title: result.item.title, category: result.item.category, price: result.item.price, attributes: diagnosticAttributes(result.item) },
      proposedPrice: result.proposedPrice, priceRange: result.priceRange, confidence: result.confidence, status: result.status,
      source: result.source, reason: result.reason, diagnostics: result.diagnostics,
      analogs: (result.analogs ?? []).map(analog => ({ id: analog.id, title: analog.title, price: analog.price, state: analog.state, similarity: analog.similarity })),
      nearMisses: (result.nearMisses ?? []).map(analog => ({ id: analog.id, title: analog.title, price: analog.price, state: analog.state, rawSimilarity: analog.rawSimilarity, reason: analog.reason, differences: analog.differences }))
    }))
  };
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(sanitizeDiagnostic(payload), null, 2)], { type: "application/json" }));
  link.download = `lotflow-diagnostics-v${state.appVersion || "unknown"}.json`; link.click(); URL.revokeObjectURL(link.href);
}

function emptyResultsRow() {
  const row = document.createElement("tr");
  row.className = "empty";
  const cell = tableCell(
    textElement("div", "empty-icon", ""),
    textElement("b", "", state.results.length ? "Ничего не найдено" : "Запустите анализ"),
    textElement("span", "", state.results.length ? "Измените строку поиска" : "Здесь появятся цены и найденные аналоги")
  );
  cell.colSpan = 8;
  row.append(cell);
  return row;
}

function resultRow(result) {
  const confidence = Math.round(result.confidence * 100);
  const manual = result.status === "manual";
  const row = document.createElement("tr");
  row.dataset.id = String(result.item.id);

  const checkbox = document.createElement("input");
  checkbox.className = "row-check";
  checkbox.type = "checkbox";
  checkbox.checked = state.selected.has(result.item.id);
  checkbox.disabled = result.proposedPrice == null || manual;

  const lot = document.createElement("div");
  lot.className = "lot";
  lot.append(textElement("b", "", result.item.title), textElement("small", "", `#${result.item.id}`));

  const recommendation = document.createElement("div");
  recommendation.className = "recommendation";
  const priceInput = document.createElement("input");
  priceInput.className = "price-input";
  priceInput.type = "number";
  priceInput.min = "1";
  priceInput.value = result.proposedPrice ?? "";
  priceInput.placeholder = "Вручную";
  recommendation.append(priceInput);
  const remember = textElement("button", "remember-price", "Запомнить");
  remember.type = "button";
  remember.title = "Сохранить эту проверенную цену в локальную базу";
  remember.disabled = result.proposedPrice == null;
  recommendation.append(remember);
  if (result.priceRange && result.priceRange.min !== result.priceRange.max) recommendation.append(textElement("small", "", `${money(result.priceRange.min)}–${money(result.priceRange.max)}`));

  const confidenceBlock = document.createElement("div");
  confidenceBlock.className = "confidence";
  const confidenceTop = document.createElement("div");
  confidenceTop.className = "confidence-top";
  confidenceTop.append(textElement("span", "", `${confidence}%`), textElement("small", "", manual ? "Проверить" : "Готово"));
  const bar = document.createElement("div");
  bar.className = `bar${confidence < 55 ? " low" : ""}`;
  const fill = document.createElement("i");
  fill.style.width = `${confidence}%`;
  bar.append(fill);
  confidenceBlock.append(confidenceTop, bar);

  const source = document.createElement("div");
  source.className = "source";
  const configured = hasManualProfile(result.item.category);
  const sourceTitle = manual && !configured && ["Категория ещё не настроена", "Недостаточно проверенных данных", "Нет данных"].includes(result.source)
    ? "Настройте категорию"
    : result.source;
  const sourceReason = manual && configured && result.proposedPrice == null
    ? "Нет похожих аналогов по вашему профилю. Ослабьте одно обязательное поле или обновите «Мои лоты», чтобы поиск API учёл новые правила"
    : manual && !configured && result.diagnostics?.automaticProfile
      ? "Автооценка — черновик. Выберит�� важные поля в конструкторе"
      : result.reason;
  source.append(document.createTextNode(String(sourceTitle ?? "")), textElement("small", "", sourceReason));
  const detailsButton = textElement("button", "details-button", "⋯");
  detailsButton.type = "button";
  detailsButton.title = "Показать аналоги";

  row.append(
    tableCell(checkbox), tableCell(lot), tableCell(textElement("span", "category", categoryNames[result.item.category] || result.item.category)),
    tableCell(textElement("span", "price-old", money(result.item.price))), tableCell(recommendation), tableCell(confidenceBlock), tableCell(source), tableCell(detailsButton)
  );
  return row;
}

function render() {
  const query = $("#filter").value.trim().toLowerCase();
  const sort = $("#priceSort").value;
  const results = state.results.filter(result => !query || result.item.title.toLowerCase().includes(query) || result.item.category.includes(query));
  if (sort === "asc" || sort === "desc") results.sort((left, right) => {
    const leftPrice = Number(left.proposedPrice);
    const rightPrice = Number(right.proposedPrice);
    const leftMissing = !Number.isFinite(leftPrice) || left.proposedPrice == null;
    const rightMissing = !Number.isFinite(rightPrice) || right.proposedPrice == null;
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
    if (leftMissing) return 0;
    return sort === "asc" ? leftPrice - rightPrice : rightPrice - leftPrice;
  });
  $("#rows").replaceChildren(...(results.length ? results.map(resultRow) : [emptyResultsRow()]));
  updateProfileNotices($("#profileNotices"), { results: state.results, categoryOf, categoryLabel, hasManualProfile });
  updateMetrics();
}

async function loadDemo() {
  const data = await request("/api/demo"); state.targets = data.targets; state.market = data.market; state.schemas = data.schemas ?? {}; state.categories = data.categories ?? [...new Set(data.targets.map(categoryOf))]; state.fieldCatalog = data.fieldCatalog ?? {}; state.autoProfiles = data.autoProfiles ?? {}; state.currency = data.currency ?? "rub"; syncCurrencyUi(); state.historyLoaded = true; lockCurrency(state.currency); state.results = []; state.selected.clear(); profileBuilder.setCategories(state.categories); profileBuilder.setFieldCatalog(state.fieldCatalog); profileBuilder.refresh(); renderSnapshotDiagnostics(); updateMetrics(); render(); toast("Демоданные загружены: 6 лотов");
}

async function loadLive() {
  const prices = technicalPrices(); if (!prices.length) return toast("Укажите хотя бы одну точную техническую цену");
  $("#loadLive").disabled = true; $("#loadLive").textContent = "Загружаем страницы…";
  startAnalysisProgress("Загружаем рынок и считаем цены", { estimateSeconds: estimateAnalysisSeconds() });
  try {
    const data = await request("/api/live/snapshot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technicalPrices: prices, currency: state.currency, strategy: $("#strategy").value, settings: analysisSettings(), maxMarketPages: Number($("#marketPages").value) || 1, maxSearchPlans: Number($("#searchPlans").value) || 8, maxDetailedMarketItems: Math.max(0, Number($("#marketDetails").value) || 0) }) });
    state.targets = data.targets; state.market = data.market; state.schemas = data.schemas ?? {}; state.categories = data.categories ?? []; state.fieldCatalog = data.fieldCatalog ?? {}; state.autoProfiles = data.autoProfiles ?? {}; state.currency = data.meta.currency; syncCurrencyUi(); state.historyLoaded = data.meta.includeHistory; lockCurrency(state.currency); state.results = data.results ?? []; state.selected.clear(); $("#selectAll").checked = false; profileBuilder.setCategories(state.categories); profileBuilder.setFieldCatalog(state.fieldCatalog); profileBuilder.refresh(); renderSnapshotDiagnostics(data.meta); updateMetrics(); render();
    const historyNotice = data.meta.historyTruncated ? " История ограничена: часть цен лучше проверить вручную." : "";
    const historySummary = ` История: ${data.meta.exactHistoryTargets ?? 0} лотов, ${data.meta.exactHistorySalesFound ?? 0} продаж.`;
    toast(`Оценено ${state.results.length} лотов, найдено ${data.meta.marketFound} аналогов.${historySummary}${historyNotice}`, 6000);
    stopAnalysisProgress(true);
  } catch (error) { stopAnalysisProgress(false); toast(error.message); }
  finally { $("#loadLive").disabled = false; $("#loadLive").textContent = "Загрузить мои лоты"; }
}

async function analyze() {
  if (!state.targets.length) return toast("Сначала загрузите лоты");
  if (["blended", "lastSold"].includes($("#strategy").value) && !state.historyLoaded) return toast("Для этой стратегии перезагрузите лоты с историей продаж");
  $("#analyze").disabled = true; $("#analyze").textContent = "Анализируем…";
  startAnalysisProgress("Пересчитываем цены по новым правилам", { indeterminate: true });
  try {
    const settings = analysisSettings();
    const data = await request("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targets: state.targets, market: state.market, schemas: state.schemas, settings }) });
    state.results = data.results; state.fieldCatalog = data.fieldCatalog ?? {}; state.autoProfiles = data.autoProfiles ?? {}; profileBuilder.setFieldCatalog(state.fieldCatalog); state.selected.clear(); $("#selectAll").checked = false;
    if (state.snapshotMeta) renderSnapshotDiagnostics({ ...state.snapshotMeta, quality: data.quality });
    render(); toast(`Оценено ${state.results.length} лотов`);
    stopAnalysisProgress(true);
  } catch (error) { stopAnalysisProgress(false); toast(error.message); }
  finally {
    $("#analyze").disabled = false;
    $("#analyze").replaceChildren(document.createTextNode("Проанализировать"));
  }
}

function showDetails(result) {
  $("#detailTitle").textContent = result.item.title;
  const reason = textElement("p", "", result.reason);
  const source = document.createElement("p");
  const basePrice = result.basePrice ? ` · базовая цена ${money(result.basePrice)}` : "";
  const range = result.priceRange && result.priceRange.min !== result.priceRange.max ? ` · диапазон ${money(result.priceRange.min)}–${money(result.priceRange.max)}` : "";
  const profile = result.diagnostics?.profile ? ` · профиль ${result.diagnostics.profile}` : "";
  source.append(textElement("b", "", "Источник:"), document.createTextNode(` ${result.source ?? ""}${basePrice}${range}${profile}`));
  const funnel = result.diagnostics?.candidateFunnel;
  const priceCluster = result.diagnostics?.priceCluster;
  const priceFilter = funnel ? `; технических цен: ${Number(funnel.technicalPrice ?? 0) + Number(funnel.placeholderPrice ?? 0)}${priceCluster?.rejected ? `; ценовых выбросов: ${priceCluster.rejected}` : ""}` : "";
  const funnelLine = funnel ? textElement("p", "profile-help", `Проверено карточек: ${funnel.checked}; прошло профиль: ${funnel.accepted}; жёстко отклонено: ${funnel.hardMismatch}; ниже порога: ${funnel.belowSimilarity}${priceFilter}.`) : null;
  const analogList = document.createElement("div");
  analogList.className = "analog-list";
  if ((result.analogs ?? []).length) {
    for (const item of result.analogs ?? []) {
      const identity = document.createElement("div");
      identity.append(textElement("b", "", item.title), textElement("small", "", `#${item.id} · сходство ${Math.round(item.similarity * 100)}%`));
      const analog = document.createElement("div");
      analog.className = "analog";
      analog.append(identity, textElement("span", "", ["sold", "paid", "closed", "closed_inactive"].includes(item.state) ? "Продан" : "Активен"), textElement("b", "", money(item.price)));
      analogList.append(analog);
    }
  } else {
    analogList.append(textElement("p", "", result.proposedPrice == null ? "Подходящие аналоги не найдены. Лот оставлен для ручной проверки." : "Цена рассчитана правилом категории — рыночные аналоги не требуются."));
  }
  if ((result.nearMisses ?? []).length) {
    analogList.append(textElement("h3", "near-miss-heading", "Ближайшие отклонённые — в цену не вошли"));
    for (const item of result.nearMisses) {
      const identity = document.createElement("div");
      identity.append(textElement("b", "", item.title), textElement("small", "", `#${item.id} · ${item.reason ?? "не прошёл профиль"}`));
      const analog = document.createElement("div");
      analog.className = "analog rejected";
      analog.append(identity, textElement("span", "", `${Math.round((item.rawSimilarity ?? item.similarity ?? 0) * 100)}% до отсечения`), textElement("b", "", money(item.price)));
      analogList.append(analog);
    }
  }
  $("#detailBody").replaceChildren(...[reason, source, funnelLine, analogList].filter(Boolean));
  $("#details").showModal();
}

function exportCsv() {
  if (!state.results.length) return toast("Сначала выполните анализ");
  const rows = [["id", "title", "category", "currency", "old_price", "proposed_price", "range_min", "range_max", "confidence", "source"], ...state.results.map(x => [x.item.id, x.item.title, x.item.category, state.currency, x.item.price, x.proposedPrice ?? "", x.priceRange?.min ?? "", x.priceRange?.max ?? "", Math.round(x.confidence * 100), x.source])];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n"); const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" })); link.download = "lotflow-results.csv"; link.click(); URL.revokeObjectURL(link.href);
}

function renderJob(job) {
  state.jobKind = "price";
  state.jobId = ["queued", "running", "paused"].includes(job.status) ? job.id : null; $("#jobPanel").hidden = false;
  $("#uploadJobDetails").hidden = true; $("#pauseJob").hidden = true; $("#retryJob").hidden = true;
  const labels = { queued: "Ожидает запуска", running: "Изменяем цены", paused: "Приостановлено", completed: "Очередь завершена", cancelled: "Очередь отменена" };
  $("#jobStatus").textContent = labels[job.status] ?? job.status; $("#jobNumbers").textContent = `${job.completed} готово · ${job.failed} ошибок · ${job.total} всего`;
  $("#jobProgress").style.width = `${job.percent}%`; $("#jobEta").textContent = job.status === "running" ? `Осталось примерно ${Math.ceil(job.remainingSeconds / 60)} мин.` : job.status === "completed" ? "Можно сверить результаты в истории очереди." : "";
  $("#resumeJob").hidden = job.status !== "paused"; $("#cancelJob").hidden = !["queued", "running", "paused"].includes(job.status); updateMetrics();
}

function renderUploadJob(job) {
  state.jobKind = "upload"; state.jobId = job.id; $("#jobPanel").hidden = false; $("#uploadJobDetails").hidden = false;
  const labels = { queued: "Очередь публикации ожидает", running: "Проверяем и публикуем аккаунты", paused: "Публикация на паузе", completed: "Автозалив завершён", completed_with_errors: "Автозалив завершён с проверками", cancelled: "Автозалив остановлен" };
  $("#jobStatus").textContent = labels[job.status] ?? job.status;
  $("#jobNumbers").textContent = `${job.completed} с применённой ценой · ${job.ready} рекомендаций · ${job.review} на проверке · ${job.failed} ошибок · ${job.total} всего`;
  $("#jobProgress").style.width = `${job.percent}%`; $("#jobEta").textContent = job.status === "running" ? `Осталось примерно ${Math.ceil(job.remainingSeconds / 60)} мин. Пауза не отменяет уже отправленные запросы.` : "Защитная цена сохраняется, пока рекомендация не прошла проверки.";
  $("#pauseJob").hidden = !["queued", "running"].includes(job.status); $("#resumeJob").hidden = job.status !== "paused"; $("#retryJob").hidden = !(job.status === "completed_with_errors" && job.failed > 0); $("#cancelJob").hidden = !["queued", "running", "paused"].includes(job.status);
  const statusNames = { queued: "В очереди", submitting: "Отправляется", reconciling: "Сверяем после timeout", published: "Опубликован", normalizing: "Получаем карточку", pricing: "Оцениваем", price_ready: "Цена рассчитана", applying_price: "Применяем цену", done: "Готово", needs_review: "Нужна проверка", failed: "Ошибка", invalid: "Неверная строка", cancelled: "Остановлено" };
  const body = $("#uploadJobRows"); body.replaceChildren();
  for (const row of job.rows ?? []) {
    const tr = document.createElement("tr");
    const result = row.errorMessage || row.warning || row.explanation || "—";
    tr.append(tableCell(row.label), tableCell(statusNames[row.status] ?? row.status), tableCell(row.itemId ? `#${row.itemId}` : "—"), tableCell(row.suggestedPrice == null ? "—" : `${money(row.suggestedPrice)} · ${Math.round((row.confidence ?? 0) * 100)}%`), tableCell(row.appliedPrice == null ? "—" : money(row.appliedPrice)), tableCell(result));
    body.append(tr);
  }
  updateMetrics();
}

async function pollJob(id) {
  if (state.polling) return; state.polling = true;
  try {
    while (true) {
      const { job } = await request(`/api/live/jobs/${id}`); renderJob(job);
      if (!["queued", "running"].includes(job.status)) break; await sleep(1_000);
    }
  } catch (error) { toast(error.message); }
  finally { state.polling = false; }
}

async function pollUploadJob(id) {
  if (state.polling) return; state.polling = true;
  try {
    while (true) {
      const { job } = await request(`/api/live/upload-jobs/${id}`); renderUploadJob(job);
      if (!["queued", "running"].includes(job.status)) break; await sleep(1_000);
    }
  } catch (error) { toast(error.message); }
  finally { state.polling = false; }
}

async function applyPrices() {
  const selectedResults = state.results.filter(x => state.selected.has(x.item.id) && x.status === "ready" && x.proposedPrice != null);
  const changes = selectedResults.map(x => ({ id: x.item.id, price: x.proposedPrice }));
  if (!state.liveConfigured) return toast("Для применения настройте локальный API-токен"); if (!changes.length) return;
  const risky = selectedResults.filter(result => {
    const oldPrice = Number(result.item?.price) || 0;
    const ratio = oldPrice > 0 ? Math.max(result.proposedPrice / oldPrice, oldPrice / result.proposedPrice) : 1;
    return Number(result.confidence) < .5 || /ориентировочно/i.test(result.source ?? "") || ratio >= 3;
  });
  if (risky.length && prompt(`В выбранных ценах есть ${risky.length} рискованных результатов: низкая уверенность, ориентировочная модель или изменение в 3 раза. Для продолжения введите ПРОВЕРИЛ`) !== "ПРОВЕРИЛ") return;
  if (!confirm(`Создать очередь изменения цены для ${changes.length} лотов? Процесс можно остановить и продолжить.`)) return;
  if (changes.length > 100 && prompt(`Для большой очереди введите число ${changes.length}`) !== String(changes.length)) return;
  try { const { job } = await request("/api/live/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes, confirmed: true, currency: state.currency }) }); renderJob(job); pollJob(job.id); }
  catch (error) { toast(error.message); }
}

async function restoreJob() {
  if (!state.liveConfigured) return;
  try { const { jobs } = await request("/api/live/jobs"); const job = jobs.find(x => ["running", "queued", "paused"].includes(x.status)) ?? jobs[0]; if (job) { renderJob(job); if (["running", "queued"].includes(job.status)) pollJob(job.id); } } catch { return; }
}

async function restoreUploadJob() {
  if (!state.liveConfigured) return;
  try { const { jobs } = await request("/api/live/upload-jobs"); const job = jobs.find(x => ["running", "queued", "paused"].includes(x.status)) ?? jobs[0]; if (job) { renderUploadJob(job); if (["running", "queued"].includes(job.status)) pollUploadJob(job.id); } } catch { return; }
}

async function loadUploadCategories() {
  try {
    const data = await request("/api/live/upload-categories"); const select = $("#uploadCategory"); const current = select.value;
    select.replaceChildren(...data.categories.map(category => { const option = document.createElement("option"); option.value = category.slug; option.textContent = category.title; option.dataset.categoryId = category.id; option.dataset.baseTitle = category.title; return option; }));
    profileBuilder.setCategories([...new Set([...(state.categories ?? []).map(category => category?.name ?? category?.category ?? category), ...data.categories.map(category => category.slug)])]);
    if ([...select.options].some(option => option.value === current)) select.value = current;
  } catch { /* WoT and Blitz fallback options remain available */ }
}
async function openUploadDialog() { if (!state.liveConfigured) return toast("Для публикации настройте локальный API-токен"); await loadUploadCategories(); updateUploadSummary(); $("#uploadDialog").showModal(); }
function updateUploadSummary() {
  const lines = $("#uploadAccountsText").value.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
  $("#uploadSummary").textContent = lines.length ? `В очереди будет ${lines.length} строк. Неверный формат будет показан отдельно.` : "Добавьте хотя бы одну строку.";
  $("#startUpload").disabled = !lines.length;
}
async function readUploadFile(file) {
  try { $("#uploadAccountsText").value = await file.text(); updateUploadSummary(); }
  catch { $("#uploadSummary").textContent = "Не удалось прочитать TXT-файл"; $("#startUpload").disabled = true; }
}
async function startUpload() {
  const accountsText = $("#uploadAccountsText").value; const total = accountsText.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith("#")).length; if (!total) return;
  const autoApply = $("#uploadAutoApply").checked;
  if (autoApply && prompt("LotFlow применит только рекомендации, прошедшие safety checks. Для подтверждения риска введите ПРОВЕРИЛ") !== "ПРОВЕРИЛ") return;
  if (!confirm(`Запустить fast-sell для ${total} строк? Стартовая цена останется защитной до завершения оценки.`)) return;
  if (total > 100 && prompt(`Для большой очереди введите число ${total}`) !== String(total)) return;
  let extra; try { extra = JSON.parse($("#uploadExtra").value || "{}"); if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Error(); } catch { return toast("Дополнительные параметры должны быть JSON-объектом"); }
  const selectedCategory = $("#uploadCategory").selectedOptions[0];
  const config = { category: $("#uploadCategory").value, categoryId: Number(selectedCategory?.dataset.categoryId), baseTitle: selectedCategory?.dataset.baseTitle || selectedCategory?.textContent, extra, region: $("#uploadRegion").value, itemOrigin: $("#uploadOrigin").value, emailType: $("#uploadEmailType").value, guaranteeDuration: Number($("#uploadGuarantee").value), initialPrice: Number($("#uploadInitialPrice").value), parallelism: Number($("#uploadParallel").value), confidenceThreshold: Number($("#uploadConfidence").value), autoEvaluate: $("#uploadAutoEvaluate").checked, autoApply };
  try { const { job } = await request("/api/live/upload-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountsText, config, settings: analysisSettings(), confirmed: true, currency: state.currency }) }); $("#uploadDialog").close(); renderUploadJob(job); pollUploadJob(job.id); }
  catch (error) { toast(error.message); }
}

const profileBuilder = createProfileBuilder({
  getTargets: () => state.targets,
  getMarket: () => state.market,
  getCurrency: () => state.currency,
  async loadCategoryCatalog(category) {
    if (state.fieldCatalog[category]?.length) return state.fieldCatalog[category];
    if (!state.liveConfigured) return [];
    return catalogFromParams(await request(`/api/live/params/${encodeURIComponent(category)}`));
  },
  async onPreview(category, profile, requestedIds = []) {
    const categoryTargets = state.targets.filter(item => categoryOf(item) === category);
    const requested = new Set(requestedIds.map(String));
    const targets = requested.size ? categoryTargets.filter(item => requested.has(String(item.id))) : selectProfilePreviewTargets(categoryTargets, profile, 5);
    if (!targets.length) return [];
    const settings = { ...analysisSettings(), categoryProfiles: { ...state.categoryProfiles, [category]: profile } };
    const data = await request("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets, market: state.market, schemas: state.schemas, settings })
    });
    return data.results ?? [];
  },
  notify: toast,
  onSave(profiles, context = {}) {
    state.categoryProfiles = profiles;
    if (!state.targets.length) return undefined;
    if (context.refreshMarket && state.liveConfigured) return loadLive();
    return analyze();
  }
});
state.categoryProfiles = profileBuilder.getProfiles();

$("#scanPreset").addEventListener("change", event => applyScanPreset(event.target.value));
for (const id of ["#marketPages", "#searchPlans", "#marketDetails"]) $(id).addEventListener("input", () => { $("#scanPreset").value = "custom"; $("#scanPresetHelp").textContent = "Свои настройки: больше сценариев и карточек увеличивают время почти линейно."; });
$("#loadDemo").addEventListener("click", loadDemo); $("#loadLive").addEventListener("click", loadLive); $("#uploadAccounts").addEventListener("click", openUploadDialog); $("#uploadClose").addEventListener("click", () => $("#uploadDialog").close()); $("#uploadFile").addEventListener("change", event => event.target.files[0] && readUploadFile(event.target.files[0])); $("#uploadAccountsText").addEventListener("input", updateUploadSummary); $("#startUpload").addEventListener("click", startUpload); $("#analyze").addEventListener("click", analyze); $("#filter").addEventListener("input", render); $("#priceSort").addEventListener("change", render); $("#exportCsv").addEventListener("click", exportCsv); $("#applyPrices").addEventListener("click", applyPrices);
$("#uploadConfigureCategory").addEventListener("click", () => { const category = $("#uploadCategory").value; $("#uploadDialog").close(); profileBuilder.open(category); });
$("#currency").addEventListener("change", event => { if (state.snapshotCurrency) { event.target.value = state.currency; return toast("Валюта зафиксирована для загруженной выборки"); } state.currency = event.target.value; syncCurrencyUi(); render(); }); $("#details .dialog-close").addEventListener("click", () => $("#details").close());
$("#resumeJob").addEventListener("click", async () => { try { const endpoint = state.jobKind === "upload" ? "/api/live/upload-jobs" : "/api/live/jobs"; const { job } = await request(`${endpoint}/${state.jobId}/resume`, { method: "POST" }); if (state.jobKind === "upload") { renderUploadJob(job); pollUploadJob(job.id); } else { renderJob(job); pollJob(job.id); } } catch (error) { toast(error.message); } });
$("#pauseJob").addEventListener("click", async () => { if (state.jobKind !== "upload" || !state.jobId) return; try { const { job } = await request(`/api/live/upload-jobs/${state.jobId}/pause`, { method: "POST" }); renderUploadJob(job); } catch (error) { toast(error.message); } });
$("#retryJob").addEventListener("click", async () => { if (state.jobKind !== "upload" || !state.jobId) return; try { const { job } = await request(`/api/live/upload-jobs/${state.jobId}/retry-failed`, { method: "POST" }); renderUploadJob(job); pollUploadJob(job.id); } catch (error) { toast(error.message); } });
$("#cancelJob").addEventListener("click", async () => { if (!state.jobId || !confirm("Остановить очередь после текущего запроса?")) return; try { const endpoint = state.jobKind === "upload" ? "/api/live/upload-jobs" : "/api/live/jobs"; const { job } = await request(`${endpoint}/${state.jobId}/cancel`, { method: "POST" }); state.jobKind === "upload" ? renderUploadJob(job) : renderJob(job); } catch (error) { toast(error.message); } });
$("#selectAll").addEventListener("change", event => { state.selected = event.target.checked ? new Set(state.results.filter(x => x.status === "ready" && x.proposedPrice != null).map(x => x.item.id)) : new Set(); render(); });
$("#rows").addEventListener("change", event => {
  const row = event.target.closest("tr"); if (!row) return; const result = state.results.find(x => x.item.id === row.dataset.id); if (!result) return;
  if (event.target.classList.contains("row-check")) {
    if (event.target.checked) state.selected.add(result.item.id);
    else state.selected.delete(result.item.id);
  }
  if (event.target.classList.contains("price-input")) { result.proposedPrice = Math.max(1, Number(event.target.value) || 1); result.status = "ready"; result.confidence = 1; result.source = "Ручная цена"; result.reason = "Цена подтверждена пользователем"; state.selected.add(result.item.id); render(); }
  updateMetrics();
});
$("#rows").addEventListener("click", event => { const button = event.target.closest(".details-button"); if (!button) return; const result = state.results.find(x => x.item.id === button.closest("tr").dataset.id); if (result) showDetails(result); });
$("#rows").addEventListener("click", event => {
  const button = event.target.closest(".remember-price"); if (!button) return;
  const result = state.results.find(x => x.item.id === button.closest("tr").dataset.id); if (!result || result.proposedPrice == null) return;
  if (!confirm(`Сохранить ${money(result.proposedPrice)} как подтверждённую цену для «${result.item.title}»? Она будет использоваться только локально как дополнительный проданный аналог.`)) return;
  saveReferences(addConfirmedReference(state.references, result, result.proposedPrice));
  toast("Цена добавлена в локальную базу подтверждённых цен");
});
$("#referenceImport").addEventListener("change", async event => {
  try {
    if (!event.target.files[0]) return;
    const imported = normalizeReferenceLibrary(JSON.parse(await event.target.files[0].text()));
    if (!imported.items.length) throw new Error("empty");
    saveReferences({ items: [...state.references.items, ...imported.items] });
    toast(`Импортировано подтверждённых цен: ${imported.items.length}. Нажмите «Проанализировать», чтобы применить.`);
  } catch { toast("Не удалось прочитать базу цен: нужен JSON из LotFlow"); }
  event.target.value = "";
});
$("#referenceExport").addEventListener("click", () => {
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(referenceExport(state.references), null, 2)], { type: "application/json" })); link.download = "lotflow-confirmed-prices.json"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
});
$("#referenceClear").addEventListener("click", () => { if (confirm("Удалить локальную базу подтверждённых цен? Экспортируйте её заранее, если хотите сохранить.")) { saveReferences({ items: [] }); toast("Локальная база подтверждённых цен очищена"); } });
$("#profileNotices").addEventListener("click", event => { const button = event.target.closest(".configure-profile"); if (button) profileBuilder.open(button.dataset.category); });
$("#snapshotDiagnostics").addEventListener("click", event => { if (event.target.closest(".diagnostic-download")) exportDiagnostics(); });
$("#fileInput").addEventListener("change", async event => { try { const data = JSON.parse(await event.target.files[0].text()); state.targets = data.targets ?? data.items ?? []; state.market = data.market ?? data.comparables ?? []; state.schemas = data.schemas ?? {}; state.categories = data.categories ?? [...new Set(state.targets.map(categoryOf))]; state.fieldCatalog = data.fieldCatalog ?? {}; state.autoProfiles = data.autoProfiles ?? {}; state.currency = data.currency ?? "rub"; syncCurrencyUi(); state.historyLoaded = Boolean(data.historyLoaded ?? true); lockCurrency(state.currency); state.results = []; state.selected.clear(); profileBuilder.setCategories(state.categories); profileBuilder.setFieldCatalog(state.fieldCatalog); profileBuilder.refresh(); renderSnapshotDiagnostics(data.meta); updateMetrics(); render(); toast(`Импортировано ${state.targets.length} лотов`); } catch { toast("Не удалось прочитать JSON"); } });

$("#pricingNav").addEventListener("click", () => $(".control-card").scrollIntoView({ behavior: "smooth" }));
$("#historyNav").addEventListener("click", () => {
  const panel = $("#jobPanel");
  if (panel.hidden) toast("Очередь пока пуста. Сначала выберите цены и создайте очередь изменений");
  else panel.scrollIntoView({ behavior: "smooth", block: "center" });
});
$("#settingsNav").addEventListener("click", () => toast("Токен задаётся только локально через LZT_TOKEN — он не сохраняется в браузере"));
$("#strategy").addEventListener("change", () => { if (state.targets.length && ["blended", "lastSold"].includes($("#strategy").value) && !state.historyLoaded) toast("После смены стратегии загрузите выборку заново, чтобы получить историю продаж"); });

request("/api/status").then(status => { state.liveConfigured = status.liveConfigured; state.csrfToken = status.csrfToken; state.currency = status.currency ?? "rub"; state.appVersion = status.version ? "1.0" : ""; syncCurrencyUi(); $("#loadLive").hidden = !status.liveConfigured; $("#uploadAccounts").hidden = !status.liveConfigured; $("#apiBadge").textContent = `${status.liveConfigured ? "API подключён" : "Деморежим"}${status.version ? ` · v${status.version}` : ""}`; $("#apiBadge").className = `badge ${status.liveConfigured ? "good" : "neutral"}`; updateMetrics(); restoreJob(); restoreUploadJob(); }).catch(() => $("#apiBadge").textContent = "API недоступен");
request("/api/profiles/defaults").then(data => profileBuilder.setDefaults(data.profiles)).catch(() => toast("Стандартные профили недоступны"));
updateMetrics();
updateReferenceUi();
