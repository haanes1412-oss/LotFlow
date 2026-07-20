import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PriceJobManager } from "../src/price-job-manager.js";

test("persistent price queue completes and records every result", async () => {
  const calls = []; const directory = await mkdtemp(join(tmpdir(), "lotflow-job-")); const filePath = join(directory, "jobs.json");
  const manager = new PriceJobManager({ client: { updatePrice: async (...args) => calls.push(args) }, filePath }); await manager.init();
  const created = await manager.create({ changes: [{ id: "1", price: 3 }, { id: "2", price: 4 }], currency: "rub" });
  for (let i = 0; i < 100 && manager.get(created.id).status !== "completed"; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const job = manager.get(created.id); assert.equal(job.status, "completed"); assert.equal(job.completed, 2); assert.equal(job.failed, 0); assert.deepEqual(calls, [["1", 3, "rub"], ["2", 4, "rub"]]);
  let stored;
  for (let i = 0; i < 100; i++) { stored = JSON.parse(await readFile(filePath, "utf8")); if (stored.jobs[0].status === "completed") break; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.equal(stored.jobs[0].status, "completed");
});

test("queue rejects duplicate ids and invalid currency", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lotflow-job-")); const manager = new PriceJobManager({ client: {}, filePath: join(directory, "jobs.json") }); await manager.init();
  await assert.rejects(() => manager.create({ changes: [{ id: "1", price: 3 }, { id: "1", price: 4 }] }), /повторяющийся/);
  await assert.rejects(() => manager.create({ changes: [{ id: "1", price: 3 }], currency: "btc" }), /валюта/);
});
