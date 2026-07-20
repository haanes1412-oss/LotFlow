import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const CURRENCIES = new Set(["rub", "usd", "eur", "uah", "kzt", "byn", "gbp", "cny", "try", "jpy", "brl"]);

export class PriceJobManager {
  constructor({ client, filePath }) { this.client = client; this.filePath = filePath; this.jobs = new Map(); this.activeJobId = null; }

  async init() {
    try {
      const stored = JSON.parse(await readFile(this.filePath, "utf8"));
      for (const job of stored.jobs ?? []) {
        if (["running", "queued"].includes(job.status)) job.status = "paused";
        this.jobs.set(job.id, job);
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    await this.persist();
  }

  list() { return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(job => this.publicJob(job)); }
  get(id) { const job = this.jobs.get(id); return job ? this.publicJob(job) : null; }

  publicJob(job) {
    const done = job.completed + job.failed;
    const elapsed = job.startedAt ? Math.max(1, Date.now() - job.startedAt) : 0;
    const perItem = done ? elapsed / done : 100;
    return { ...job, percent: job.total ? Math.round(done / job.total * 100) : 0, remainingSeconds: Math.ceil(Math.max(0, job.total - done) * perItem / 1000), changes: undefined };
  }

  validate(changes, currency) {
    if (!Array.isArray(changes) || !changes.length || changes.length > 5_000) throw new Error("Допустимо от 1 до 5000 изменений");
    if (!CURRENCIES.has(currency)) throw new Error("Неподдерживаемая валюта");
    const ids = new Set();
    return changes.map(change => {
      const id = String(change.id ?? ""); const price = Number(change.price);
      if (!/^\d+$/.test(id) || ids.has(id)) throw new Error(`Некорректный или повторяющийся ID: ${id}`);
      if (!Number.isFinite(price) || price < 1 || price > 100_000_000) throw new Error(`Некорректная цена для ${id}`);
      ids.add(id); return { id, price: Math.round(price) };
    });
  }

  async create({ changes, currency = "rub" }) {
    if (this.activeJobId) throw new Error("Другая очередь уже выполняется");
    const validated = this.validate(changes, currency);
    const job = { id: randomUUID(), status: "queued", currency, changes: validated, total: validated.length, completed: 0, failed: 0, cursor: 0, current: null, results: [], createdAt: Date.now(), startedAt: null, finishedAt: null };
    this.jobs.set(job.id, job); await this.persist(); this.run(job.id); return this.publicJob(job);
  }

  async resume(id) {
    const job = this.jobs.get(id);
    if (!job || !["paused", "failed"].includes(job.status)) throw new Error("Эту очередь нельзя продолжить");
    if (this.activeJobId) throw new Error("Другая очередь уже выполняется");
    job.status = "queued"; await this.persist(); this.run(id); return this.publicJob(job);
  }

  async cancel(id) {
    const job = this.jobs.get(id); if (!job) throw new Error("Очередь не найдена");
    if (["completed", "cancelled"].includes(job.status)) return this.publicJob(job);
    job.status = "cancelled"; job.finishedAt = Date.now(); await this.persist(); return this.publicJob(job);
  }

  async run(id) {
    const job = this.jobs.get(id); if (!job || this.activeJobId) return;
    this.activeJobId = id; job.status = "running"; job.startedAt ??= Date.now(); await this.persist();
    try {
      while (job.cursor < job.changes.length && job.status === "running") {
        const change = job.changes[job.cursor]; job.current = change.id; await this.persist();
        try { await this.client.updatePrice(change.id, change.price, job.currency); job.completed++; job.results.push({ ...change, ok: true }); }
        catch (error) { job.failed++; job.results.push({ ...change, ok: false, error: error.message }); }
        job.cursor++; job.current = null; await this.persist();
      }
      if (job.status === "running") { job.status = "completed"; job.finishedAt = Date.now(); }
    } catch (error) { job.status = "paused"; job.error = error.message; }
    finally { this.activeJobId = null; await this.persist(); }
  }

  async persist() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify({ jobs: [...this.jobs.values()] }, null, 2));
    await rename(temporary, this.filePath);
  }
}
