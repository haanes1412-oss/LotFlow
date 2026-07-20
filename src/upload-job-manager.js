import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const CURRENCIES = new Set(["rub", "usd", "eur", "uah", "kzt", "byn", "gbp", "cny", "try", "jpy", "brl"]);
const ORIGINS = new Set(["brute", "phishing", "stealer", "autoreg", "personal", "resale", "dummy", "self_registration", "retrieve_via_support"]);
const CATEGORY_IDS = new Set([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 28, 30, 31]);
const OPTIONAL = ["title", "title_en", "auto_generate_title", "guarantee_duration", "description", "information", "forceTempEmail", "resell_item_id", "has_email_login_data", "email_login_data", "email_type", "tfa_secret", "allow_ask_discount", "proxy_id", "random_proxy"];
const limit = (value, maximum, label) => {
  const result = String(value ?? "").trim();
  if (result.length > maximum) throw new Error(`${label}: превышена допустимая длина`);
  return result;
};

// Resumable local-only publishing queue. Private login data remains in the
// server's local runtime file solely until its row has been sent; public job
// responses deliberately exclude it.
export class UploadJobManager {
  constructor({ client, filePath }) { this.client = client; this.filePath = filePath; this.jobs = new Map(); this.activeJobId = null; }

  async init() {
    try {
      const stored = JSON.parse(await readFile(this.filePath, "utf8"));
      for (const job of stored.jobs ?? []) { if (["running", "queued"].includes(job.status)) job.status = "paused"; this.jobs.set(job.id, job); }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    await this.persist();
  }

  isActive() { return Boolean(this.activeJobId); }
  list() { return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(job => this.publicJob(job)); }
  get(id) { const job = this.jobs.get(id); return job ? this.publicJob(job) : null; }

  publicJob(job) {
    const done = job.completed + job.failed;
    const elapsed = job.startedAt ? Math.max(1, Date.now() - job.startedAt) : 0;
    const perItem = done ? elapsed / done : 2_100;
    return { id: job.id, kind: "upload", status: job.status, total: job.total, completed: job.completed, failed: job.failed, cursor: job.cursor, current: job.current ? { index: job.current.index, title: job.current.title } : null, results: job.results, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, error: job.error, percent: job.total ? Math.round(done / job.total * 100) : 0, remainingSeconds: Math.ceil(Math.max(0, job.total - done) * perItem / 1000) };
  }

  validate(items, currency) {
    if (!Array.isArray(items) || !items.length || items.length > 1_000) throw new Error("Допустимо от 1 до 1000 аккаунтов");
    if (!CURRENCIES.has(currency)) throw new Error("Неподдерживаемая валюта");
    return items.map((source, index) => {
      if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error(`Строка ${index + 1}: ожидается объект`);
      const price = Number(source.price); const categoryId = Number(source.category_id); const origin = String(source.item_origin ?? "");
      if (!Number.isFinite(price) || price < 1 || price > 100_000_000) throw new Error(`Строка ${index + 1}: некорректная цена`);
      if (!CATEGORY_IDS.has(categoryId)) throw new Error(`Строка ${index + 1}: неизвестная category_id`);
      if (!ORIGINS.has(origin)) throw new Error(`Строка ${index + 1}: некорректный item_origin`);
      const title = limit(source.title, 500, `Строка ${index + 1}, title`);
      const titleEn = limit(source.title_en, 500, `Строка ${index + 1}, title_en`);
      if (!title && !titleEn && source.auto_generate_title !== true) throw new Error(`Строка ${index + 1}: нужен title, title_en или auto_generate_title=true`);
      const item = { price: Math.round(price), category_id: categoryId, currency, item_origin: origin };
      if (title) item.title = title; if (titleEn) item.title_en = titleEn;
      for (const key of OPTIONAL) {
        if (!(key in source) || source[key] === undefined || source[key] === null || key === "title" || key === "title_en") continue;
        if (["auto_generate_title", "forceTempEmail", "has_email_login_data", "allow_ask_discount", "random_proxy"].includes(key)) { if (typeof source[key] !== "boolean") throw new Error(`Строка ${index + 1}: ${key} должен быть true/false`); item[key] = source[key]; continue; }
        if (["guarantee_duration", "resell_item_id", "proxy_id"].includes(key)) { const value = Number(source[key]); if (!Number.isInteger(value) || value < 0) throw new Error(`Строка ${index + 1}: ${key} должен быть целым числом`); item[key] = value; continue; }
        if (key === "email_type") { if (!["native", "autoreg"].includes(source[key])) throw new Error(`Строка ${index + 1}: email_type должен быть native или autoreg`); item[key] = source[key]; continue; }
        item[key] = limit(source[key], key === "information" ? 30_000 : 10_000, `Строка ${index + 1}, ${key}`);
      }
      if (item.guarantee_duration !== undefined && ![0, 43200, 86400, 259200].includes(item.guarantee_duration)) throw new Error(`Строка ${index + 1}: недопустимый срок гарантии`);
      return item;
    });
  }

  async create({ items, currency = "rub" }) {
    if (this.activeJobId) throw new Error("Другая очередь публикации уже выполняется");
    const validated = this.validate(items, currency);
    const job = { id: randomUUID(), status: "queued", items: validated, total: validated.length, completed: 0, failed: 0, cursor: 0, current: null, results: [], createdAt: Date.now(), startedAt: null, finishedAt: null };
    this.jobs.set(job.id, job); await this.persist(); this.run(job.id); return this.publicJob(job);
  }

  async resume(id) { const job = this.jobs.get(id); if (!job || !["paused", "failed"].includes(job.status)) throw new Error("Эту очередь нельзя продолжить"); if (this.activeJobId) throw new Error("Другая очередь публикации уже выполняется"); job.status = "queued"; await this.persist(); this.run(id); return this.publicJob(job); }
  async cancel(id) { const job = this.jobs.get(id); if (!job) throw new Error("Очередь не найдена"); if (!["completed", "cancelled"].includes(job.status)) { job.status = "cancelled"; job.finishedAt = Date.now(); await this.persist(); } return this.publicJob(job); }

  async run(id) {
    const job = this.jobs.get(id); if (!job || this.activeJobId) return;
    this.activeJobId = id; job.status = "running"; job.startedAt ??= Date.now(); await this.persist();
    try {
      while (job.cursor < job.items.length && job.status === "running") {
        const item = job.items[job.cursor]; job.current = { index: job.cursor + 1, title: item.title ?? item.title_en ?? "Автозаголовок" }; await this.persist();
        try { const response = await this.client.addAccount(item); job.completed++; job.results.push({ index: job.cursor + 1, title: job.current.title, ok: true, itemId: response?.item_id ?? response?.item?.item_id ?? null }); }
        catch (error) { job.failed++; job.results.push({ index: job.cursor + 1, title: job.current.title, ok: false, error: `Ошибка API: ${error.status ?? "network"}` }); }
        job.cursor++; job.current = null; await this.persist();
      }
      if (job.status === "running") { job.status = "completed"; job.finishedAt = Date.now(); }
    } catch (error) { job.status = "paused"; job.error = "Очередь остановлена из-за локальной ошибки"; }
    finally { this.activeJobId = null; await this.persist(); }
  }

  async persist() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify({ jobs: [...this.jobs.values()] }, null, 2), { mode: 0o600 });
    await rename(temporary, this.filePath); await chmod(this.filePath, 0o600);
  }
}
