import {
  conditionRow,
  element,
  readRule,
  ruleCard
} from "./profile-builder-controls.js";
import { filterProfileFields, readProfileFields, renderProfileFields, updateFieldPriority } from "./profile-field-editor.js";
import { computeStrictness } from "./profile-strictness.js";
import { isListingMetaField } from "./listing-meta.js";
import { hasConfiguredProfile } from "./profile-preview-sample.js";
import { showProfileConfigurationWarning, showProfilePreview } from "./profile-preview-ui.js";
import { calibrateProfile, selectCalibrationTargets } from "./profile-calibration.js";
import {
  PROFILE_SCHEMA_VERSION,
  STORAGE_KEY,
  categoryOf,
  deepCopy,
  generatedProfile,
  inferredFieldRule,
  mergeProfile,
  migrateStoredProfile,
  readStoredProfiles,
  simpleFieldRule
} from "./profile-builder-data.js";

const CATEGORY_NAMES = { battlenet: "Battle.net", discord: "Discord", ea: "EA", epicgames: "Epic Games", "escape-from-tarkov": "Escape from Tarkov", fortnite: "Fortnite", gifts: "Подарки", hytale: "Hytale", instagram: "Instagram", llm: "LLM", mihoyo: "HoYoverse", minecraft: "Minecraft", riot: "Riot Games", roblox: "Roblox", socialclub: "Rockstar Social Club", steam: "Steam", supercell: "Supercell", telegram: "Telegram", tiktok: "TikTok", uplay: "Ubisoft Connect", vpn: "VPN-сервисы", warface: "Warface", "world-of-tanks": "World of Tanks", "wot-blitz": "WoT Blitz" };
const categoryName = category => CATEGORY_NAMES[category] ?? String(category).replaceAll("-", " ");
const fieldScore = field => /^(origin|service|account_type)$/.test(field) ? 100 : /region|country|platform|access/.test(field) ? 90 : /subscription|renew|expire/.test(field) ? 80 : /rank|level|count|amount|balance|followers|premium|top|tank|game|skin|character/.test(field) ? 70 : 10;

function saveFile(filename, payload) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = element("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

class ProfileBuilder {
  constructor({ getTargets, getCurrency = () => "rub", getMarket = () => [], loadCategoryCatalog, onPreview, onSave, notify }) {
    this.getTargets = getTargets;
    this.getCurrency = getCurrency;
    this.getMarket = getMarket;
    this.loadCategoryCatalog = loadCategoryCatalog;
    this.onPreview = onPreview;
    this.onSave = onSave;
    this.notify = notify;
    this.defaults = {};
    this.profiles = readStoredProfiles();
    this.fieldCatalog = {};
    this.availableCategories = [];
    this.drafts = {};
    this.activeCategory = "";
    this.dialog = document.querySelector("#profileDialog");
    this.categorySelect = document.querySelector("#profileCategory");
    this.fieldsContainer = document.querySelector("#profileFields");
    this.rulesContainer = document.querySelector("#profileRules");
    this.preview = document.querySelector("#profilePreview");
    this.strictness = document.querySelector("#profileStrictness");
    this.strictnessTimer = null;
    this.hintsContainer = document.querySelector("#profileHints");
    this.categoryHints = {};
    this.experienceMode = "guided";
    this.learningExamples = document.querySelector("#profileLearningExamples");
    this.learningStatus = document.querySelector("#profileLearningStatus");
    this.buildWorkbench();
    this.loadCategoryHints();
    this.bindEvents();
  }

  categories() {
    const values = new Set([
      ...Object.keys(CATEGORY_NAMES),
      ...this.availableCategories,
      ...Object.keys(this.profiles),
      ...Object.keys(this.fieldCatalog),
      ...this.getTargets().map(categoryOf)
    ]);
    return [...values].filter(Boolean).sort();
  }

  buildWorkbench() {
    const first = this.dialog.querySelector(".profile-persona");
    const last = this.dialog.querySelector("#profilePreview");
    const footer = this.dialog.querySelector(".profile-footer");
    if (!first || !last || !footer || this.dialog.querySelector(".profile-workbench")) return;
    const shell = element("div", "profile-workbench");
    const sidebar = element("aside", "profile-category-sidebar");
    sidebar.append(element("p", "eyebrow", "РАЗДЕЛЫ МАРКЕТА"), element("h3", "", "Категории"));
    const search = element("input", "profile-category-search");
    search.type = "search";
    search.placeholder = "Найти категорию";
    const rail = element("div", "profile-category-rail");
    sidebar.append(search, rail);
    const workspace = element("div", "profile-workspace");
    let node = first;
    while (node) {
      const next = node.nextSibling;
      workspace.append(node);
      if (node === last) break;
      node = next;
    }
    shell.append(sidebar, workspace);
    this.dialog.insertBefore(shell, footer);
    this.categoryRail = rail;
    search.addEventListener("input", () => this.renderCategoryRail(this.categories(), search.value));
  }

  renderCategoryRail(categories = this.categories(), query = "") {
    if (!this.categoryRail) return;
    const normalized = String(query).trim().toLowerCase();
    const buttons = categories.filter(category => `${category} ${categoryName(category)}`.toLowerCase().includes(normalized)).map(category => {
      const button = element("button", `profile-category-item${category === this.activeCategory ? " active" : ""}`);
      button.type = "button";
      button.dataset.category = category;
      button.append(element("span", "category-dot"), element("span", "", categoryName(category)));
      button.addEventListener("click", async () => {
        if (category === this.activeCategory) return;
        this.commitDraft();
        await this.open(category);
      });
      return button;
    });
    this.categoryRail.replaceChildren(...buttons);
  }

  baseProfile(category) {
    const profile = generatedProfile(category, this.getTargets());
    const builtin = this.defaults[category];
    if (!builtin) return profile;
    return {
      ...profile,
      activeEstimator: builtin.activeEstimator ?? profile.activeEstimator,
      minSimilarity: builtin.minSimilarity ?? profile.minSimilarity,
      manualThreshold: builtin.manualThreshold ?? profile.manualThreshold,
      minAnalogs: builtin.minAnalogs ?? profile.minAnalogs,
      maxAnalogs: builtin.maxAnalogs ?? profile.maxAnalogs,
      similarityWindow: builtin.similarityWindow ?? profile.similarityWindow,
      priceOutlierRatio: builtin.priceOutlierRatio ?? profile.priceOutlierRatio
    };
  }

  profileFor(category) {
    return this.drafts[category] ?? mergeProfile(this.baseProfile(category), this.profiles[category]);
  }

  catalogFor(category = this.activeCategory) {
    return this.fieldCatalog[category] ?? [];
  }

  renderRules(profile) {
    const fieldNames = Object.keys(profile.fields).sort();
    this.rulesContainer.replaceChildren(...(profile.fixedPriceRules ?? []).map(rule => ruleCard(rule, fieldNames)));
  }

  setForm(profile) {
    if (!hasConfiguredProfile(profile) && this.catalogFor().length) profile = this.recommendedProfile(profile);
    this.setExperienceMode(profile.experienceMode ?? "guided");
    document.querySelector("#profilePricingGoal").value = profile.pricingGoal ?? "market";
    const storedName = String(profile.name ?? "");
    const rawDefaultName = `${this.activeCategory} — мой профиль`;
    document.querySelector("#profileName").value = !storedName || storedName === rawDefaultName
      ? `${categoryName(this.activeCategory)} — мой профиль`
      : storedName;
    document.querySelector("#profileStrategy").value = profile.strategy ?? "blended";
    document.querySelector("#profileDiscount").value = profile.discountPercent ?? "";
    document.querySelector("#profileCurrency").value = String(this.getCurrency() ?? "rub").toUpperCase();
    document.querySelector("#profileActiveEstimator").value = profile.activeEstimator ?? "weightedMedian";
    document.querySelector("#profileMinSimilarity").value = Math.round((profile.minSimilarity ?? .55) * 100);
    document.querySelector("#profileManualThreshold").value = Math.round((profile.manualThreshold ?? .5) * 100);
    document.querySelector("#profileMinAnalogs").value = profile.minAnalogs ?? 1;
    document.querySelector("#profileMaxAnalogs").value = profile.maxAnalogs ?? 5;
    document.querySelector("#profileWindow").value = Math.round((profile.similarityWindow ?? .15) * 100);
    document.querySelector("#profileOutlierRatio").value = profile.priceOutlierRatio ?? 6;
    document.querySelector("#profileMultiplier").value = profile.priceMultiplier ?? 100;
    document.querySelector("#profilePriceMin").value = profile.priceMin ?? "";
    document.querySelector("#profilePriceMax").value = profile.priceMax ?? "";
    document.querySelector("#profileFallback").checked = profile.allowCategoryFallback === true;
    document.querySelector("#profileFilterPriceOutliers").checked = profile.filterPriceOutliers !== false;
    document.querySelector("#profileUnconfigured").checked = profile.useUnconfiguredFields === true;
    document.querySelector("#profileAutomatic").checked = false;
    const catalog = this.catalogFor();
    const configured = Object.values(profile.fields ?? {}).filter(rule => rule?.mode !== "ignore" && Number(rule?.weight) > 0).length;
    document.querySelector("#profileCatalogSummary").textContent = catalog.length
      ? configured
        ? `Показано ${configured} ключевых параметров. Остальные технические поля доступны только экспертам.`
        : "Ключевые параметры появятся после загрузки данных. Технические поля скрыты и доступны только экспертам."
      : "Сначала загрузите лоты: параметры категории появятся здесь автоматически.";
    renderProfileFields(this.fieldsContainer, { catalog, category: this.activeCategory, targets: this.getTargets(), profile });
    this.renderRules(profile);
    this.renderTraining(profile);
    this.preview.hidden = true;
    this.preview.replaceChildren();
    this.renderCategoryHints();
    this.scheduleStrictness();
  }

  async loadCategoryHints() {
    try {
      const response = await fetch("/category-hints.json");
      if (!response.ok) return;
      const data = await response.json();
      this.categoryHints = data?.categories ?? {};
      if (this.dialog.open) this.renderCategoryHints();
    } catch {
      // Подсказки необязательны — конструктор работает и без них.
    }
  }

  renderCategoryHints() {
    const box = this.hintsContainer;
    if (!box) return;
    const hint = this.categoryHints?.[this.activeCategory];
    if (!hint) { box.hidden = true; box.replaceChildren(); return; }
    const summary = element("summary", "", `Подсказки по категории: ${categoryName(this.activeCategory)}`);
    const body = element("div", "category-hints-body");
    if (hint.summary) body.append(element("p", "category-hints-lead", hint.summary));
    const lists = element("div", "category-hints-lists");
    const column = (title, items, className) => {
      const col = element("div", `category-hints-col ${className}`);
      col.append(element("b", "", title));
      const ul = element("ul", "");
      for (const item of items) ul.append(element("li", "", String(item).replace(/\s*\([a-z\d_]+\)/gi, "")));
      col.append(ul);
      return col;
    };
    if (hint.strong?.length) lists.append(column("Обычно тянет цену", hint.strong, "strong"));
    if (hint.weak?.length) lists.append(column("Обычно слабый сигнал", hint.weak, "weak"));
    body.append(lists);
    if (hint.watchout) body.append(element("p", "category-hints-watchout", `⚠ ${String(hint.watchout).replace(/\s*\([a-z\d_]+\)/gi, "")}`));
    body.append(element("small", "category-hints-note", "Это только ориентир. Поля вы включаете сами кнопками [Обязательно]/[Важно]/[Не важно] — подсказки ничего не меняют сами."));
    box.replaceChildren(summary, body);
    box.hidden = false;
  }

  readProfile() {
    const discountValue = document.querySelector("#profileDiscount").value;
    const saved = this.drafts[this.activeCategory] ?? this.profiles[this.activeCategory] ?? {};
    return {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      category: this.activeCategory,
      name: document.querySelector("#profileName").value.trim() || `${categoryName(this.activeCategory)} — мой профиль`,
      experienceMode: this.experienceMode,
      pricingGoal: document.querySelector("#profilePricingGoal").value,
      strategy: document.querySelector("#profileStrategy").value,
      discountPercent: discountValue === "" ? null : Number(discountValue),
      activeEstimator: document.querySelector("#profileActiveEstimator").value,
      minSimilarity: Number(document.querySelector("#profileMinSimilarity").value) / 100,
      manualThreshold: Number(document.querySelector("#profileManualThreshold").value) / 100,
      minAnalogs: Number(document.querySelector("#profileMinAnalogs").value) || 1,
      maxAnalogs: Number(document.querySelector("#profileMaxAnalogs").value) || 5,
      similarityWindow: Number(document.querySelector("#profileWindow").value) / 100,
      priceOutlierRatio: Number(document.querySelector("#profileOutlierRatio").value) || 6,
      priceMultiplier: Number(document.querySelector("#profileMultiplier").value) || 100,
      priceMin: Number(document.querySelector("#profilePriceMin").value) || null,
      priceMax: Number(document.querySelector("#profilePriceMax").value) || null,
      allowCategoryFallback: document.querySelector("#profileFallback").checked,
      filterPriceOutliers: document.querySelector("#profileFilterPriceOutliers").checked,
      useUnconfiguredFields: document.querySelector("#profileUnconfigured").checked,
      automatic: false,
      fields: readProfileFields(this.fieldsContainer),
      fixedPriceRules: [...this.rulesContainer.querySelectorAll(".profile-rule")].map(readRule),
      calibrationExamples: this.readTrainingExamples(),
      userCalibration: saved.userCalibration ?? null
    };
  }

  refreshCategories(preferred = this.activeCategory) {
    const values = this.categories();
    if (!values.length) values.push("unknown");
    this.activeCategory = values.includes(preferred) ? preferred : values[0];
    this.categorySelect.replaceChildren(...values.map(category => {
      const option = element("option", "", categoryName(category));
      option.value = category;
      option.selected = category === this.activeCategory;
      return option;
    }));
    this.renderCategoryRail(values, this.dialog.querySelector(".profile-category-search")?.value ?? "");
  }

  render(category = this.activeCategory) {
    this.refreshCategories(category);
    this.setForm(deepCopy(this.profileFor(this.activeCategory)));
  }

  async open(category = this.activeCategory) {
    if (!this.getTargets().length && !this.availableCategories.length && !Object.keys(this.profiles).length) {
      this.notify("Сначала загрузите лоты из Market — категории и их параметры появятся автоматически", 6000);
      return;
    }
    const requestedCategory = category || this.activeCategory;
    this.render(requestedCategory);
    if (!this.dialog.open) this.dialog.showModal();
    if (requestedCategory && !this.fieldCatalog[requestedCategory]?.length && this.loadCategoryCatalog) {
      this.dialog.setAttribute("aria-busy", "true");
      try {
        const catalog = await this.loadCategoryCatalog(requestedCategory);
        if (catalog?.length) this.fieldCatalog[requestedCategory] = deepCopy(catalog);
        if (this.activeCategory === requestedCategory) this.render(requestedCategory);
      } catch {
        this.notify("Не удалось загрузить параметры категории; показаны поля из текущих лотов");
      } finally {
        this.dialog.removeAttribute("aria-busy");
      }
    }
  }

  commitDraft() {
    if (this.activeCategory) this.drafts[this.activeCategory] = this.readProfile();
  }

  persist(nextProfiles, context = {}) {
    this.profiles = nextProfiles;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profiles));
    return this.onSave(deepCopy(this.profiles), context);
  }

  saveCurrent() {
    const category = this.activeCategory;
    let profile = this.readProfile();
    if (this.experienceMode === "guided" && !hasConfiguredProfile(profile)) profile = this.recommendedProfile(profile);
    this.drafts[category] = profile;
    const refresh = this.persist(
      { ...this.profiles, [category]: this.drafts[category] },
      { category, refreshMarket: true }
    );
    this.dialog.close();
    this.notify(`Профиль ${category} сохранён. Обновляю рынок и пересчитываю цены по новым правилам`, 7000);
    Promise.resolve(refresh).catch(error => this.notify(error.message || "Профиль сохранён, но обновить рынок не удалось"));
  }

  resetCurrent() {
    this.drafts[this.activeCategory] = this.baseProfile(this.activeCategory);
    this.setForm(deepCopy(this.drafts[this.activeCategory]));
    this.notify("Все поля сброшены в «Не важно»");
  }

  autoConfigureFields() {
    const catalog = this.catalogFor();
    if (!catalog.length) return this.notify("Сначала загрузите лоты");
    const profile = this.readProfile();
    let enabled = 0;
    for (const entry of [...catalog].sort((a, b) => fieldScore(b.field) - fieldScore(a.field)).slice(0, 8)) {
      if (isListingMetaField(entry.field)) continue;
      if (!entry.autoEligible || ((entry.targetCoverage < .4 || entry.marketCoverage < .2) && !entry.apiFilter)) continue;
      profile.fields[entry.field] = simpleFieldRule(entry.suggestedPriority ?? "important", entry.type, { label: entry.label, search: Boolean(entry.apiFilter), ...entry.suggestedRule });
      enabled += 1;
    }
    profile.automatic = false;
    profile.useUnconfiguredFields = false;
    this.drafts[this.activeCategory] = profile;
    this.setForm(deepCopy(profile));
    this.notify(`Предложено важных полей: ${enabled}. Проверьте их на пяти лотах`);
  }

  recommendedProfile(profile = this.readProfile()) {
    const next = deepCopy(profile);
    let enabled = 0;
    for (const entry of [...this.catalogFor()].sort((a, b) => fieldScore(b.field) - fieldScore(a.field)).slice(0, 8)) {
      if (isListingMetaField(entry.field)) continue;
      if (!entry.autoEligible || ((entry.targetCoverage < .4 || entry.marketCoverage < .2) && !entry.apiFilter)) continue;
      next.fields[entry.field] = simpleFieldRule(entry.suggestedPriority ?? "important", entry.type, { label: entry.label, search: Boolean(entry.apiFilter), ...entry.suggestedRule });
      enabled += 1;
    }
    next.minAnalogs = 2;
    next.maxAnalogs = 5;
    next.minSimilarity = .55;
    next.manualThreshold = .5;
    next.similarityWindow = .15;
    next.priceOutlierRatio = 6;
    next.filterPriceOutliers = true;
    next.allowCategoryFallback = false;
    next.useUnconfiguredFields = enabled === 0;
    next.automatic = false;
    return next;
  }

  setExperienceMode(mode) {
    this.experienceMode = ["guided", "manual", "expert"].includes(mode) ? mode : "guided";
    this.dialog.dataset.experienceMode = this.experienceMode;
    for (const button of document.querySelectorAll("#profileExperience [data-experience]")) button.classList.toggle("active", button.dataset.experience === this.experienceMode);
    const messages = {
      guided: "Три шага без технических настроек. LotFlow сам изучит поля и рынок этой категории.",
      manual: "Отметьте только действительно важные характеристики. Остальное останется безопасным по умолчанию.",
      expert: "Полный контроль: пороги, коэффициенты, фильтры API и собственные ценовые правила."
    };
    document.querySelector("#profileExperienceHelp").textContent = messages[this.experienceMode];
    document.querySelector("#profileAdvancedSettings").open = this.experienceMode === "expert";
    document.querySelector("#profileTest").textContent = this.experienceMode === "guided" ? "Показать 5 рассчитанных цен" : "Проверить на 5 моих лотах";
    document.querySelector("#profileSave").textContent = this.experienceMode === "guided" ? "Использовать эту настройку" : "Сохранить и использовать";
  }

  applyPricingGoal(goal) {
    if (goal === "custom") return;
    const settings = {
      fast: { estimator: "lowerQuartile", multiplier: 90 },
      market: { estimator: "weightedMedian", multiplier: 100 },
      premium: { estimator: "median", multiplier: 110 }
    }[goal] ?? { estimator: "weightedMedian", multiplier: 100 };
    document.querySelector("#profileActiveEstimator").value = settings.estimator;
    document.querySelector("#profileMultiplier").value = settings.multiplier;
    this.scheduleStrictness();
  }

  readTrainingExamples() {
    if (!this.learningExamples) return [];
    return [...this.learningExamples.querySelectorAll(".learning-example")].map(row => ({
      id: row.dataset.id,
      title: row.dataset.title,
      oldPrice: Number(row.dataset.oldPrice) || null,
      expectedPrice: Number(row.querySelector("input").value) || null
    })).filter(example => example.expectedPrice);
  }

  renderTraining(profile) {
    if (!this.learningExamples || !this.learningStatus) return;
    const targets = this.getTargets().filter(item => categoryOf(item) === this.activeCategory);
    const examples = selectCalibrationTargets(targets, 8);
    const saved = new Map((profile.calibrationExamples ?? []).map(example => [String(example.id), example]));
    const rows = examples.map(item => {
      const row = element("label", "learning-example");
      row.dataset.id = String(item.id);
      row.dataset.title = item.title ?? `Лот #${item.id}`;
      row.dataset.oldPrice = String(Number(item.price) || 0);
      const copy = element("span", "learning-example-copy");
      copy.append(element("b", "", item.title ?? `Лот #${item.id}`), element("small", "", item.price ? `Текущая цена: ${item.price} ${String(this.getCurrency()).toUpperCase()}` : "Текущая цена не указана"));
      const input = element("input", "learning-price");
      input.type = "number";
      input.min = "1";
      input.placeholder = "Правильная цена";
      input.value = saved.get(String(item.id))?.expectedPrice ?? "";
      row.append(copy, input);
      return row;
    });
    this.learningExamples.replaceChildren(...rows);
    const calibration = profile.userCalibration;
    const labels = {
      ready: `Проверен · ${calibration?.within20 ?? 0} из ${calibration?.examples ?? 0} близко к вашим ценам`,
      needs_examples: `Нужно ещё примеров · заполнено ${calibration?.examples ?? 0}`,
      needs_review: `Нужна корректировка · среднее отклонение ${Math.round((calibration?.meanError ?? 0) * 100)}%`
    };
    this.learningStatus.textContent = calibration ? labels[calibration.status] ?? "Обучен" : "Не обучен";
    this.learningStatus.className = `learning-status ${calibration?.status ?? "empty"}`;
    document.querySelector("#profileLearn").disabled = examples.length < 3;
  }

  async learnFromExamples() {
    const examples = this.readTrainingExamples();
    if (examples.length < 3) return this.notify("Укажите правильную цену минимум для трёх лотов", 5000);
    const button = document.querySelector("#profileLearn");
    button.disabled = true;
    button.textContent = "Сравниваем цены…";
    try {
      const profile = this.recommendedProfile(this.readProfile());
      const results = await this.onPreview(this.activeCategory, profile, examples.map(example => example.id));
      const calibration = calibrateProfile(profile, examples, results);
      this.drafts[this.activeCategory] = calibration.profile;
      this.setForm(deepCopy(calibration.profile));
      const accuracy = Math.round((1 - calibration.meanError) * 100);
      this.notify(`Профиль подстроен: коэффициент ${calibration.priceMultiplier}%, совпадение около ${Math.max(0, accuracy)}%`, 7000);
    } catch (error) {
      this.notify(error.message || "Не удалось обучить профиль", 6000);
    } finally {
      button.disabled = false;
      button.textContent = "Настроить по моим ценам";
    }
  }

  scheduleStrictness() {
    if (!this.strictness || !this.dialog.open) return;
    clearTimeout(this.strictnessTimer);
    this.strictnessTimer = setTimeout(() => this.renderStrictness(), 300);
  }

  renderStrictness() {
    if (!this.strictness) return;
    const profile = this.readProfile();
    const summary = computeStrictness({ targets: this.getTargets(), market: this.getMarket(), profile, category: this.activeCategory });
    this.strictness.className = `profile-strictness ${summary.level}`;
    this.strictness.hidden = false;
    const head = element("div", "strictness-head");
    head.append(
      element("span", "", `Обязательных: ${summary.requiredCount} · Важных: ${summary.importantCount}`),
      element("span", "strictness-value", summary.rejectRate == null ? "—" : `отсев ${Math.round(summary.rejectRate * 100)}%`)
    );
    const children = [head];
    if (summary.rejectRate != null) {
      const track = element("div", "strictness-track");
      const fill = element("i");
      fill.style.width = `${Math.round(summary.rejectRate * 100)}%`;
      track.append(fill);
      children.push(track);
    }
    const notes = [];
    if (summary.level === "empty") notes.push("Выберите хотя бы одно важное поле, иначе все лоты уйдут в ручную проверку.");
    else if (summary.level === "no-market") notes.push("Строгость появится после первого анализа — рыночная выборка ещё не загружена в память.");
    else {
      if (summary.requiredCount > 5) notes.push(`Обязательных полей ${summary.requiredCount}. Обычно достаточно 2–4 — иначе аналоги перестают находиться.`);
      if (summary.level === "high") notes.push("Профиль почти всё отсекает: ослабьте часть обязательных полей или переведите их в «Важно».");
      else if (summary.level === "warn") notes.push("Профиль строгий: заметная часть лотов уйдёт в ручную проверку.");
      if (summary.tooFewCount) notes.push(`Лотов без достаточного числа аналогов в выборке: ${summary.tooFewCount} из ${summary.sampleSize}.`);
    }
    if (notes.length) children.push(element("small", "strictness-note", notes.join(" ")));
    this.strictness.replaceChildren(...children);
  }

  async testCurrent() {
    if (!this.onPreview) return this.notify("Предпросмотр недоступен");
    const button = document.querySelector("#profileTest");
    button.disabled = true;
    button.textContent = "Проверяем…";
    try {
      const profile = this.experienceMode === "guided" ? this.recommendedProfile(this.readProfile()) : this.readProfile();
      if (!hasConfiguredProfile(profile)) {
        showProfileConfigurationWarning(this.preview);
        return;
      }
      const results = await this.onPreview(this.activeCategory, profile);
      if (!results.length) return this.notify("В этой категории нет загруженных лотов");
      showProfilePreview(this.preview, results, this.getCurrency(), () => this.saveCurrent());
    } catch (error) {
      this.notify(error.message || "Не удалось проверить профиль");
    } finally {
      button.disabled = false;
      button.textContent = this.experienceMode === "guided" ? "Показать 5 рассчитанных цен" : "Проверить на 5 моих лотах";
    }
  }

  exportProfiles() {
    this.commitDraft();
    saveFile("lotflow-category-profiles.json", { schemaVersion: PROFILE_SCHEMA_VERSION, profiles: { ...this.profiles, ...this.drafts } });
  }

  async importProfiles(file) {
    try {
      const payload = JSON.parse(await file.text());
      const imported = payload.profiles ?? payload;
      if (!imported || typeof imported !== "object" || Array.isArray(imported)) throw new Error("Неверный формат");
      this.drafts = {};
      this.persist({ ...this.profiles, ...imported });
      this.migrateLegacyProfiles();
      this.render(Object.keys(imported)[0]);
      this.notify(`Импортировано профилей: ${Object.keys(imported).length}`);
    } catch {
      this.notify("Не удалось импортировать профили");
    }
  }

  addField() {
    const input = document.querySelector("#profileNewField");
    const field = input.value.trim().toLowerCase().replace(/[^\w.-]+/gu, "_").slice(0, 80);
    if (!field) return this.notify("Введите ключ поля");
    const profile = this.readProfile();
    profile.fields[field] = { ...inferredFieldRule(field, []), mode: "ignore", weight: 0, missing: "ignore", required: false };
    this.drafts[this.activeCategory] = profile;
    input.value = "";
    this.setForm(deepCopy(profile));
  }

  addRule() {
    const fields = [...this.fieldsContainer.querySelectorAll(".profile-field")].map(row => row.dataset.field);
    this.rulesContainer.append(ruleCard({ name: "Новое правило", price: 1, conditions: [{}] }, fields));
  }

  handleRulesClick(event) {
    const removeRule = event.target.closest(".remove-rule");
    if (removeRule) removeRule.closest(".profile-rule").remove();
    const removeCondition = event.target.closest(".remove-condition");
    if (removeCondition) {
      const list = removeCondition.closest(".profile-conditions");
      removeCondition.closest(".profile-condition").remove();
      if (!list.children.length) list.append(conditionRow({}, Object.keys(readProfileFields(this.fieldsContainer))));
    }
    const addCondition = event.target.closest(".add-condition");
    if (addCondition) {
      const list = addCondition.closest(".profile-rule").querySelector(".profile-conditions");
      list.append(conditionRow({}, Object.keys(readProfileFields(this.fieldsContainer))));
    }
  }

  bindEvents() {
    document.querySelector("#openProfiles").addEventListener("click", () => this.open());
    document.querySelector("#profileClose").addEventListener("click", () => this.dialog.close());
    document.querySelector("#profileSave").addEventListener("click", () => this.saveCurrent());
    document.querySelector("#profileTest").addEventListener("click", () => this.testCurrent());
    document.querySelector("#profileReset").addEventListener("click", () => this.resetCurrent());
    document.querySelector("#profileExport").addEventListener("click", () => this.exportProfiles());
    document.querySelector("#profileImport").addEventListener("change", event => {
      if (event.target.files[0]) this.importProfiles(event.target.files[0]);
      event.target.value = "";
    });
    this.categorySelect.addEventListener("change", async event => {
      this.commitDraft();
      await this.open(event.target.value);
    });
    document.querySelector("#profileAddField").addEventListener("click", () => this.addField());
    document.querySelector("#profileAddRule").addEventListener("click", () => this.addRule());
    document.querySelector("#profileAutoFields").addEventListener("click", () => this.autoConfigureFields());
    document.querySelector("#profileExperience").addEventListener("click", event => {
      const button = event.target.closest("[data-experience]");
      if (!button) return;
      this.setExperienceMode(button.dataset.experience);
      if (this.experienceMode === "guided") {
        const profile = this.recommendedProfile(this.readProfile());
        this.drafts[this.activeCategory] = profile;
        this.setForm(profile);
      }
    });
    document.querySelector("#profilePricingGoal").addEventListener("change", event => this.applyPricingGoal(event.target.value));
    document.querySelector("#profileLearn").addEventListener("click", () => this.learnFromExamples());
    document.querySelector("#profileFieldFilter").addEventListener("input", event => filterProfileFields(this.fieldsContainer, event.target.value));
    this.fieldsContainer.addEventListener("click", event => {
      const button = event.target.closest("[data-field-priority]");
      if (button) {
        updateFieldPriority(button.closest(".profile-field"), button.dataset.fieldPriority);
        this.scheduleStrictness();
      }
    });
    this.fieldsContainer.addEventListener("change", event => {
      const row = event.target.closest(".profile-field");
      if (row && event.target.closest(".profile-field-advanced")) {
        row.dataset.advancedChanged = "true";
        this.scheduleStrictness();
      }
    });
    this.rulesContainer.addEventListener("click", event => this.handleRulesClick(event));
  }

  getProfiles() {
    return deepCopy(this.profiles);
  }

  setCategories(categories) {
    this.availableCategories = [...new Set((categories ?? []).map(value => String(value?.name ?? value?.category_name ?? value?.category ?? value?.id ?? value)).filter(Boolean))];
    if (!this.dialog.open) {
      const preferred = this.availableCategories.includes(this.activeCategory) ? this.activeCategory : this.availableCategories[0] ?? this.activeCategory;
      this.refreshCategories(preferred);
    }
  }

  setDefaults(nextDefaults) {
    this.defaults = deepCopy(nextDefaults ?? {});
    this.migrateLegacyProfiles();
    if (this.dialog.open) this.render(this.activeCategory);
    else this.refreshCategories();
  }

  setFieldCatalog(nextCatalog) {
    this.fieldCatalog = deepCopy(nextCatalog ?? {});
    this.migrateLegacyProfiles();
    if (this.dialog.open) this.render(this.activeCategory);
  }

  migrateLegacyProfiles() {
    const nextProfiles = deepCopy(this.profiles);
    let changed = false;
    for (const [category, profile] of Object.entries(nextProfiles)) {
      if (Number(profile?.schemaVersion) >= PROFILE_SCHEMA_VERSION) continue;
      const catalog = this.fieldCatalog[category] ?? [];
      if (Number(profile?.schemaVersion) < 2 && !catalog.length) continue;
      const allowed = [...Object.keys(this.defaults[category]?.fields ?? {}), ...catalog.map(entry => entry.field)];
      const migration = migrateStoredProfile(category, profile, this.defaults[category], allowed);
      if (!migration.changed) continue;
      nextProfiles[category] = migration.profile;
      changed = true;
    }
    if (!changed) return;
    this.profiles = nextProfiles;
    this.drafts = {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profiles));
    this.onSave(deepCopy(this.profiles));
    this.notify("Сохранённые профили обновлены до новой версии конструктора", 5200);
  }

  refresh() {
    if (this.dialog.open) this.render(this.activeCategory);
  }
}

export function createProfileBuilder(options) {
  return new ProfileBuilder(options);
}
