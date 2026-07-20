import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const data = JSON.parse(readFileSync(join(root, "public/category-hints.json"), "utf8"));

const KNOWN_CATEGORIES = new Set([
  "steam", "telegram", "mihoyo", "riot", "supercell", "ea", "world-of-tanks", "wot-blitz",
  "epicgames", "gifts", "minecraft", "escape-from-tarkov", "socialclub", "uplay", "discord",
  "tiktok", "instagram", "llm", "battlenet", "vpn", "roblox", "warface", "hytale", "fortnite"
]);

// Keys that would imply the hints try to configure a profile. Hints must stay highlight-only.
const FORBIDDEN_CONFIG_KEYS = new Set(["fields", "field", "profile", "rules", "fixedPriceRules", "mode", "required", "missing", "weight", "minSimilarity", "automatic"]);

test("category-hints exposes 6-8 highlight-only category guides", () => {
  const categories = data.categories ?? {};
  const keys = Object.keys(categories);
  assert.ok(keys.length >= 6 && keys.length <= 8, `expected 6-8 categories, got ${keys.length}`);
  assert.ok(keys.includes("world-of-tanks"), "includes the category the tester flagged");
});

test("every hint targets a real LZT category and stays informational", () => {
  for (const [category, hint] of Object.entries(data.categories ?? {})) {
    assert.ok(KNOWN_CATEGORIES.has(category), `${category} is a real category`);
    assert.equal(typeof hint.label, "string");
    assert.equal(typeof hint.summary, "string");
    assert.ok(Array.isArray(hint.strong) && hint.strong.length > 0, `${category} lists strong signals`);
    assert.ok(hint.strong.every(item => typeof item === "string"));
    assert.equal(typeof hint.watchout, "string");
    for (const key of Object.keys(hint)) {
      assert.ok(!FORBIDDEN_CONFIG_KEYS.has(key), `${category}.${key} must not configure a profile`);
    }
  }
});
