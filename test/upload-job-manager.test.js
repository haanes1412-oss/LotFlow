import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UploadJobManager } from "../src/upload-job-manager.js";

const valid = { title: "WoT | 6 топ 100 прем", price: 350, category_id: 14, item_origin: "personal", information: "login:password" };

test("upload queue validates, resumes locally, and never exposes private data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lotflow-upload-"));
  const filePath = join(directory, "upload-jobs.json");
  const calls = [];
  const manager = new UploadJobManager({ client: { async addAccount(item) { calls.push(item); return { item_id: 77 }; } }, filePath });
  await manager.init();
  const job = await manager.create({ items: [valid], currency: "rub" });
  await new Promise(resolve => setTimeout(resolve, 30));
  const stored = JSON.parse(await readFile(filePath, "utf8"));
  const current = manager.get(job.id);
  assert.equal(calls.length, 1);
  assert.equal(current.status, "completed");
  assert.equal(current.results[0].itemId, 77);
  assert.equal(JSON.stringify(current).includes("login:password"), false);
  assert.equal(stored.jobs[0].items[0].information, "login:password");
  await assert.rejects(() => manager.create({ items: [{ ...valid, category_id: 999 }], currency: "rub" }), /category_id/);
  await rm(directory, { recursive: true, force: true });
});
