import test from "node:test";
import assert from "node:assert/strict";
import { extractWotTanks, extractWotSilver, normalizeItem } from "../src/item-normalizer.js";
import { isPlaceholderPrice } from "../src/market-estimator.js";
import { analyzeItem, wotValueSignal } from "../src/pricing-engine.js";

test("extractWotTanks pulls tank names from a noisy title and drops stat counts", () => {
  const tanks = extractWotTanks("ИС-7 | Type 71 | UDES 03 3 | 26 топ 68 прем | 800 голды | 5.5млн сер Wargaming");
  assert.ok(tanks.includes("ис7"), "keeps IS-7");
  assert.ok(tanks.includes("type"), "keeps Type");
  assert.ok(tanks.includes("udes"), "keeps UDES");
  assert.ok(!tanks.includes("топ") && !tanks.includes("прем"), "drops stat labels");
  assert.ok(!tanks.includes("wargaming"), "drops the seller brand");
  assert.ok(tanks.every(token => !/^\d/.test(token)), "no token starts with a digit");
  assert.ok(tanks.length <= 16, "is capped");
});

test("extractWotTanks returns nothing for a stats-only title", () => {
  assert.deepEqual(extractWotTanks("WoT Blitz 5"), []);
  assert.deepEqual(extractWotTanks("WoT 12 топ 30 прем 4кк сер"), []);
});

test("extractWotSilver understands млн / кк / plain amounts", () => {
  assert.equal(extractWotSilver("5.5млн сер"), 5_500_000);
  assert.equal(extractWotSilver("12кк серебра"), 12_000_000);
  assert.equal(extractWotSilver("800000 silver"), 800_000);
  assert.equal(extractWotSilver("26 топ 68 прем"), undefined);
});

test("isPlaceholderPrice flags filler runs but keeps real prices", () => {
  for (const filler of [8888, 1111, 99999, 8488, 12345, 54321, 1337, 31337]) {
    assert.equal(isPlaceholderPrice(filler), true, `${filler} is filler`);
  }
  for (const real of [999, 1000, 1999, 2500, 4500, 150, 77]) {
    assert.equal(isPlaceholderPrice(real), false, `${real} is a real price`);
  }
});

test("wotValueSignal ranks a stacked garage above an empty account", () => {
  const loaded = wotValueSignal({ category: "world-of-tanks", attributes: { top_count: 20, premium_count: 40, gold: 50_000, tanks: ["a", "b", "c"] } });
  const empty = wotValueSignal({ category: "world-of-tanks", attributes: { top_count: 0, premium_count: 0, gold: 0 } });
  assert.equal(empty, 0);
  assert.ok(loaded > 100, "loaded account scores highly");
});

test("normalizeItem infers tanks from a WoT title but not for other categories", () => {
  const wot = normalizeItem({ item_id: "x", category_name: "world-of-tanks", price: 199, title: "ИС-7 Об.260 гараж 3 топ", attributes: { region: "eu" } });
  assert.ok(Array.isArray(wot.attributes.tanks) && wot.attributes.tanks.includes("ис7"));
  const steam = normalizeItem({ item_id: "y", category_name: "steam", price: 10, title: "CS:GO Prime + ИС-7" });
  assert.equal(steam.attributes.tanks, undefined);
});

test("a valuable WoT account is NOT auto-priced from empty junk analogs", () => {
  const junk = (id, price) => ({ item_id: id, category_name: "world-of-tanks", price, title: `WoT акк ${id}`, seller_id: `s${id}`, attributes: { region: "eu", origin: "brute", top_count: 1, premium_count: 1, gold: 0 } });
  const market = [junk(1, 5), junk(2, 10), junk(3, 10), junk(4, 8), junk(5, 19)];
  const target = { item_id: "t", category_name: "world-of-tanks", price: 199, seller_id: "owner", title: "Ценный акк", attributes: { region: "eu", origin: "brute", top_count: 1, premium_count: 1, gold: 800, tanks: ["is7", "type71", "udes03"] } };
  const result = analyzeItem(target, market);
  assert.equal(result.status, "manual");
  assert.equal(result.proposedPrice, null);
  assert.match(result.source, /слабее/);
});

test("a valuable WoT account is still auto-priced when comparable analogs exist", () => {
  const rich = (id, price, tanks) => ({ item_id: id, category_name: "world-of-tanks", price, title: `WoT ${id}`, seller_id: `s${id}`, attributes: { region: "eu", origin: "brute", top_count: 8, premium_count: 12, gold: 6_000, tanks } });
  const market = [rich(1, 120, ["a1"]), rich(2, 140, ["b2"]), rich(3, 150, ["is7"]), rich(4, 130, ["d4"]), rich(5, 145, ["e5"])];
  const target = { item_id: "t", category_name: "world-of-tanks", price: 199, seller_id: "owner", title: "WoT top", attributes: { region: "eu", origin: "brute", top_count: 8, premium_count: 12, gold: 5_500, tanks: ["is7", "type71", "udes03"] } };
  const result = analyzeItem(target, market);
  assert.equal(result.status, "ready");
  assert.ok(result.proposedPrice >= 100 && result.proposedPrice <= 200, `priced at ${result.proposedPrice}`);
  assert.ok(result.analogs.length >= 2);
});

test("premium-only WoT is not sent to manual review merely for a small gold balance", () => {
  const target = { id: 1, category: "world-of-tanks", attributes: { top_count: 0, premium_count: 18, gold: 850, region: "eu", origin: "brute" } };
  const market = [
    { id: 2, category: "world-of-tanks", price: 30, attributes: { top_count: 0, premium_count: 16, gold: 200, region: "eu", origin: "brute" } },
    { id: 3, category: "world-of-tanks", price: 35, attributes: { top_count: 0, premium_count: 19, gold: 300, region: "eu", origin: "brute" } }
  ];
  const result = analyzeItem(target, market, { strategy: "active" });
  assert.notEqual(result.source, "Аналоги слабее аккаунта — нужна ручная проверка");
  assert.notEqual(result.proposedPrice, null);
});


test("loaded WoT garage accepts materially loaded, non-identical analogs", () => {
  const target = { id: 1, category: "world-of-tanks", attributes: { top_count: 6, premium_count: 100, gold: 1_000, region: "eu", origin: "brute" } };
  const market = [
    { id: 2, category: "world-of-tanks", price: 320, attributes: { top_count: 4, premium_count: 56, gold: 700, region: "eu", origin: "brute" } },
    { id: 3, category: "world-of-tanks", price: 340, attributes: { top_count: 3, premium_count: 48, gold: 500, region: "eu", origin: "brute" } }
  ];
  const result = analyzeItem(target, market, { strategy: "active" });
  assert.notEqual(result.source, "Аналоги слабее аккаунта — нужна ручная проверка");
  assert.notEqual(result.proposedPrice, null);
});
