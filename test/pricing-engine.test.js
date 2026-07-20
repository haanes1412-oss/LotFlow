import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBatch, analyzeItem, itemSimilarity } from "../src/pricing-engine.js";

test("WoT without tops and gold is priced at one ruble", () => {
  const result = analyzeItem({ id: 1, category: "world-of-tanks", price: 99999, attributes: { top_count: 0, premium_count: 6, gold: 0 } }, []);
  assert.equal(result.proposedPrice, 1);
  assert.equal(result.confidence, .99);
});

test("WoT without tops does not inherit an expensive active tier", () => {
  const target = { id: 1, category: "world-of-tanks", price: 199, attributes: { top_count: 0, premium_count: 7, gold: 5000, region: "eu" } };
  const market = [
    { id: 2, category: "world-of-tanks", price: 228, attributes: { top_count: 0, premium_count: 7, gold: 5000, region: "eu" } },
    { id: 3, category: "world-of-tanks", price: 235, attributes: { top_count: 0, premium_count: 8, gold: 5000, region: "eu" } }
  ];
  const result = analyzeItem(target, market, { strategy: "active" });
  assert.equal(result.proposedPrice, 1);
  assert.equal(result.source, "Ценовое правило: Без топов");
});

test("low-value premium-only WoT uses a supported cheap tier despite a closer expensive listing", () => {
  const profile = { schemaVersion: 6, automatic: false, strategy: "active", minSimilarity: .58, minAnalogs: 2, manualThreshold: .5, priceOutlierRatio: 6, fields: {
    top_count: { mode: "similarity", weight: 2 }, premium_count: { mode: "similarity", weight: 2 }, gold: { mode: "similarity", weight: 3 }, region: { mode: "similarity", weight: 2 }, origin: { mode: "similarity", weight: 2 }
  }, fixedPriceRules: [] };
  const target = { id: 1, category: "world-of-tanks", attributes: { top_count: 0, premium_count: 3, gold: 200, region: "eu", origin: "brute", tanks: [] } };
  const market = [
    { id: 2, category: "world-of-tanks", price: 225, attributes: { top_count: 0, premium_count: 3, gold: 200, region: "eu", origin: "brute", tanks: [] } },
    { id: 3, category: "world-of-tanks", price: 3, attributes: { top_count: 0, premium_count: 3, gold: 0, region: "eu", origin: "brute", tanks: [] } },
    { id: 4, category: "world-of-tanks", price: 4, attributes: { top_count: 0, premium_count: 3, gold: 0, region: "eu", origin: "brute", tanks: [] } }
  ];
  const result = analyzeItem(target, market, { categoryProfiles: { "world-of-tanks": profile } });
  assert.equal(result.proposedPrice, 3);
  assert.equal(result.status, "ready");
  assert.equal(result.diagnostics.priceCluster.keptSide, "lower");
});

test("one parked WoT listing cannot create an automatic four-digit price", () => {
  const target = { id: 1, category: "world-of-tanks", attributes: { top_count: 0, premium_count: 6, gold: 136, region: "na", origin: "brute" } };
  const parked = { id: 2, category: "world-of-tanks", price: 8648, attributes: { top_count: 0, premium_count: 6, gold: 140, region: "na", origin: "brute" } };
  const result = analyzeItem(target, [parked], { categoryProfiles: { "world-of-tanks": { schemaVersion: 6, automatic: false, minAnalogs: 2, fields: {
    top_count: { mode: "similarity", weight: 2 }, premium_count: { mode: "similarity", weight: 2 }, gold: { mode: "similarity", weight: 2 }, region: { mode: "similarity", weight: 2 }, origin: { mode: "similarity", weight: 2 }
  }, fixedPriceRules: [] } } });
  assert.equal(result.status, "manual");
  assert.equal(result.proposedPrice, null);
  assert.equal(result.source, "Недостаточно независимых аналогов");
});

test("a split two-analog WoT market is manual rather than a high-side guess", () => {
  const target = { id: 1, category: "world-of-tanks", attributes: { top_count: 1, premium_count: 8, gold: 2500, region: "eu", origin: "brute" } };
  const market = [
    { id: 2, category: "world-of-tanks", price: 89, attributes: { top_count: 1, premium_count: 8, gold: 2400, region: "eu", origin: "brute" } },
    { id: 3, category: "world-of-tanks", price: 241, attributes: { top_count: 1, premium_count: 8, gold: 2500, region: "eu", origin: "brute" } },
    { id: 4, category: "world-of-tanks", price: 3, attributes: { top_count: 1, premium_count: 8, gold: 2500, region: "eu", origin: "brute" } }
  ];
  const result = analyzeItem(target, market, { categoryProfiles: { "world-of-tanks": { schemaVersion: 6, automatic: false, minAnalogs: 2, priceOutlierRatio: 6, fields: {
    top_count: { mode: "similarity", weight: 2 }, premium_count: { mode: "similarity", weight: 2 }, gold: { mode: "similarity", weight: 2 }, region: { mode: "similarity", weight: 2 }, origin: { mode: "similarity", weight: 2 }
  }, fixedPriceRules: [] } } });
  assert.equal(result.status, "manual");
  assert.equal(result.proposedPrice, null);
});

test("WoT titles protect accounts with tops from the one-ruble rule", () => {
  const result = analyzeItem({ id: 1, category: "world-of-tanks", title: "WoT Blitz | 39 топ 29 прем Wargaming", price: 199, attributes: { region: "Wargaming" } }, []);
  assert.equal(result.proposedPrice, null);
  assert.equal(result.status, "manual");
});

test("WoT parser understands both label orders from real Market titles", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT | 2 прем Wargaming", price: 199, attributes: { region: "Wargaming", gold: 900, origin: "brute" } };
  const wrongTier = { id: 2, category: "world-of-tanks", title: "Топов 5Премиум танки 53 Wargaming", price: 163, attributes: { region: "Wargaming", gold: 900, origin: "brute" } };
  const similarity = itemSimilarity(target, wrongTier);
  assert.equal(similarity.score, 0);
  assert.match(similarity.differences.join(" "), /Топы|Премы/);
  const result = analyzeItem(target, [wrongTier], { strategy: "active" });
  assert.equal(result.proposedPrice, 2);
  assert.equal(result.source, "Ценовое правило: Без топов, до 3 премов и мало золота");
});

test("rejected market listings remain visible as explained near misses", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT | 5 топ 9 прем Wargaming", price: 199, attributes: { region: "Wargaming", gold: 900, origin: "brute" } };
  const market = [{ id: 2, category: "world-of-tanks", title: "25 топов 40 премов Wargaming", price: 300, attributes: { region: "Wargaming", gold: 900, origin: "brute" } }];
  const result = analyzeItem(target, market, { strategy: "active" });
  assert.equal(result.status, "manual");
  assert.equal(result.nearMisses[0].id, "2");
  assert.match(result.nearMisses[0].reason, /Топы|Премы/);
  assert.equal(result.diagnostics.candidateFunnel.hardMismatch, 1);
});

test("near-miss explanations never expose sensitive custom values", () => {
  const profile = { fields: { secret_token: { label: "Секрет", mode: "exact", weight: 5, missing: "reject" } } };
  const similarity = itemSimilarity(
    { id: 1, category: "future-game", attributes: { secret_token: "private-target" } },
    { id: 2, category: "future-game", attributes: { secret_token: "private-market" } },
    profile
  );
  assert.equal(similarity.score, 0);
  assert.equal(similarity.differences.join(" ").includes("private"), false);
});

test("near-miss explanations redact credential-shaped values under an innocent field", () => {
  const profile = { fields: { custom_rank: { label: "Ранг", mode: "exact", weight: 5, missing: "reject" } } };
  const similarity = itemSimilarity(
    { id: 1, category: "future-game", attributes: { custom_rank: "person@example.test:sample-value" } },
    { id: 2, category: "future-game", attributes: { custom_rank: "https://example.test/private" } },
    profile
  );
  assert.equal(similarity.score, 0);
  assert.equal(/example\.test|sample-value/.test(similarity.differences.join(" ")), false);
  assert.match(similarity.differences.join(" "), /скрыто/);
});

test("WoT title attributes reject empty one-ruble analogs and accept similar tops", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT | 11 топ 50 прем Wargaming", price: 199, attributes: { region: "Wargaming", origin: "personal" } };
  const empty = { id: 2, category: "world-of-tanks", title: "WoT Wargaming", price: 1, attributes: { region: "Wargaming", origin: "personal" } };
  const similar = { id: 3, category: "world-of-tanks", title: "WoT | 12 топ 48 прем Wargaming", price: 90, attributes: { region: "Wargaming", origin: "personal" } };
  assert.ok(itemSimilarity(target, empty).score < .52);
  const result = analyzeItem(target, [empty, similar], { strategy: "active" });
  assert.equal(result.proposedPrice, 90);
  assert.deepEqual(result.analogs.map(item => item.id), ["3"]);
});

test("WoT recommendation uses the closest price tier instead of cheap weak matches", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT | 26 топ 68 прем Wargaming", price: 199, attributes: { region: "Wargaming", gold: 0, origin: "personal" } };
  const market = [
    { id: 2, category: "world-of-tanks", title: "WoT | 28 топов 67 премов | Wargaming", price: 77, attributes: { region: "Wargaming", gold: 0, origin: "personal" } },
    { id: 3, category: "world-of-tanks", title: "WoT | 29 топ 75 прем | DBV-152 | Wargaming", price: 123, attributes: { region: "Wargaming", gold: 0, origin: "personal" } },
    { id: 4, category: "world-of-tanks", title: "World Of Tanks Wargaming", price: 5, attributes: { region: "Wargaming", gold: 0, origin: "personal" } },
    { id: 5, category: "world-of-tanks", title: "WoT Wargaming", price: 1, attributes: { region: "Wargaming", gold: 0, origin: "personal" } }
  ];
  const result = analyzeItem(target, market, { strategy: "active" });
  assert.equal(result.proposedPrice, 77);
  assert.deepEqual(result.analogs.map(item => item.id), ["2", "3"]);
  assert.deepEqual(result.priceRange, { min: 77, max: 123 });
});

test("WoT profile gives a conservative fallback instead of the distant 574 tier", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT | 6 топ 13 прем Wargaming", price: 199, attributes: { region: "eu", origin: "brute" } };
  const market = [
    { id: 2, category: "world-of-tanks", title: "43 топа 66 премов Wargaming", price: 574, attributes: { region: "eu", origin: "brute" } },
    { id: 3, category: "world-of-tanks", title: "44 топа 69 премов Wargaming", price: 738, attributes: { region: "eu", origin: "brute" } }
  ];
  const result = analyzeItem(target, market, { strategy: "active", lowConfidenceAction: "approximate" });
  assert.ok(result.proposedPrice >= 1 && result.proposedPrice < 100);
  assert.equal(result.status, "ready");
  assert.match(result.source, /Ориентировочно/);
});

test("a custom category profile controls tolerances, evidence and price multiplier", () => {
  const target = { id: 1, category: "epic-games", price: 99999, attributes: { games_count: 10, region: "eu" } };
  const market = [
    { id: 2, category: "epic-games", price: 100, attributes: { games_count: 11, region: "eu" } },
    { id: 3, category: "epic-games", price: 120, attributes: { games_count: 12, region: "eu" } },
    { id: 4, category: "epic-games", price: 574, attributes: { games_count: 80, region: "eu" } }
  ];
  const categoryProfiles = {
    "epic-games": {
      name: "Epic продавца",
      minSimilarity: 0.5,
      minAnalogs: 2,
      manualThreshold: 0.5,
      priceMultiplier: 90,
      allowCategoryFallback: false,
      useUnconfiguredFields: false,
      fields: {
        games_count: { mode: "range", weight: 4, tolerancePercent: 30, toleranceAbsolute: 2, missing: "reject" },
        region: { mode: "exact", weight: 2, missing: "reject" }
      }
    }
  };
  const result = analyzeItem(target, market, { strategy: "active", categoryProfiles });
  assert.equal(result.proposedPrice, 90);
  assert.deepEqual(result.analogs.map(item => item.id), ["2", "3"]);
  assert.equal(result.diagnostics.profile, "Epic продавца");
});

test("custom fixed-price rules work in any category", () => {
  const categoryProfiles = {
    "epic-games": {
      name: "Epic правила",
      fixedPriceRules: [{ id: "empty-library", name: "Без игр", price: 7, conditions: [{ field: "games_count", operator: "eq", value: 0 }] }]
    }
  };
  const result = analyzeItem({ id: 1, category: "epic-games", attributes: { games_count: 0 } }, [], { categoryProfiles });
  assert.equal(result.proposedPrice, 7);
  assert.equal(result.source, "Ценовое правило: Без игр");
});

test("WoT accounts with tops and premiums do not copy zero-zero market prices", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT | 4 топ 82 прем Wargaming", price: 199, attributes: { region: "Wargaming", gold: 800, origin: "old" } };
  const market = [{ id: 2, category: "world-of-tanks", title: "0 Топ / 0 прем / old / gold 800 / доступ к почте Wargaming", price: 25, attributes: { region: "Wargaming", gold: 800, origin: "old" } }];
  assert.equal(itemSimilarity(target, market[0]).score, 0);
  const result = analyzeItem(target, market, { strategy: "active", lowConfidenceAction: "approximate" });
  assert.ok(result.proposedPrice > 25 && result.proposedPrice < 150);
  assert.equal(result.status, "ready");
  assert.match(result.source, /Ориентировочно/);
});

test("the maximum previous sale of the same account outranks generic market listings", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT | 10 топ 36 прем Wargaming", price: 199, same_item_ids: [98, 99], attributes: { region: "Wargaming", email_access: false, top_count: 10, premium_count: 36 } };
  const market = [
    { id: 2, category: "world-of-tanks", title: "WoT | 10 топ 36 прем Wargaming", price: 50, state: "active", attributes: { region: "Wargaming", email_access: false, top_count: 10, premium_count: 36 } },
    { id: 98, category: "world-of-tanks", title: "WoT | 10 топ 36 прем Wargaming", price: 90, state: "sold", sold_at: 200, attributes: { region: "Wargaming", email_access: false, top_count: 10, premium_count: 36 } },
    { id: 99, category: "world-of-tanks", title: "WoT | 10 топ 36 прем Wargaming", price: 120, state: "closed", sold_at: 100, attributes: { region: "Wargaming", email_access: false, top_count: 10, premium_count: 36 } }
  ];
  const result = analyzeItem(target, market, { strategy: "active" });
  assert.equal(result.proposedPrice, 120);
  assert.equal(result.source, "Максимальная цена прошлых продаж этого аккаунта");
  assert.deepEqual(result.priceRange, { min: 90, max: 120 });
  assert.deepEqual(result.analogs.map(item => item.id), ["99", "98"]);
  assert.ok(result.confidence >= .88);
});

test("an exact previous sale bypasses ordinary similarity and seller filters", () => {
  const target = { id: 1, category: "world-of-tanks", seller_id: 7, title: "WoT | 10 топ 36 прем Wargaming", price: 199, same_item_id: 98, attributes: { region: "Wargaming", email_access: false, top_count: 10, premium_count: 36 } };
  const previousSale = { id: 98, category: "world-of-tanks", seller_id: 7, title: "старое название", price: 199, state: "closed", attributes: {} };
  const result = analyzeItem(target, [previousSale], { strategy: "active", excludedPrices: [199] });
  assert.equal(result.proposedPrice, 199);
  assert.equal(result.status, "ready");
  assert.equal(result.source, "Максимальная цена прошлых продаж этого аккаунта");
  assert.equal(result.analogs[0].similarity, 1);
});

test("WoT email access must match", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT | 10 топ 36 прем", attributes: { region: "eu", email_access: false } };
  const candidate = { id: 2, category: "world-of-tanks", title: "WoT | 10 топ 36 прем", attributes: { region: "eu", email_access: true } };
  assert.equal(itemSimilarity(target, candidate).score, 0);
});

test("WoT Blitz never uses ordinary WoT listings as price analogs", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT Blitz | 37 топ 25 прем Wargaming", price: 199, attributes: { region: "eu", origin: "brute" } };
  const market = [
    { id: 2, category: "world-of-tanks", title: "WoT | 37 топ 25 прем Wargaming", price: 3, attributes: { region: "eu", origin: "brute" } },
    { id: 3, category: "world-of-tanks", title: "WoT Blitz | 36 топ 24 прем Wargaming", price: 85, attributes: { region: "eu", origin: "brute" } },
    { id: 4, category: "world-of-tanks", title: "WoT Blitz | 40 топ 28 прем Wargaming", price: 95, attributes: { region: "eu", origin: "brute" } }
  ];
  assert.equal(itemSimilarity(target, market[0]).score, 0);
  const result = analyzeItem(target, market, { strategy: "active", lowConfidenceAction: "approximate" });
  assert.ok(result.proposedPrice >= 80);
  assert.deepEqual(result.analogs.map(item => item.id).sort(), ["3", "4"]);
});

test("one 300-ruble listing cannot overprice a small WoT garage", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT | 2 топ 8 прем Wargaming", attributes: { top_count: 2, premium_count: 8, gold: 500, wot_credits: 4_000_000, origin: "brute" } };
  const market = [{ id: 2, category: "world-of-tanks", title: "Strv 103B | Badger | 8 прем Wargaming", price: 300, seller_id: "one", attributes: { top_count: 2, premium_count: 8, gold: 430, wot_credits: 4_100_000, origin: "brute" } }];
  const result = analyzeItem(target, market, { strategy: "active", lowConfidenceAction: "approximate" });
  assert.ok(result.proposedPrice < 100);
  assert.equal(result.diagnostics.roughEstimate, true);
});

test("a stacked 37-top WoT garage gets a conservative fallback, not 3 or 3000 rubles", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT Blitz | 37 топ 25 прем Wargaming", attributes: { top_count: 37, premium_count: 25, wot_blitz: 1, origin: "brute" } };
  const market = [{ id: 2, category: "world-of-tanks", title: "WoT Blitz base Wargaming", price: 3, seller_id: "one", attributes: { top_count: 0, premium_count: 0, wot_blitz: 1, origin: "brute" } }];
  const result = analyzeItem(target, market, { strategy: "active", lowConfidenceAction: "approximate" });
  assert.ok(result.proposedPrice >= 250 && result.proposedPrice <= 600);
});

test("49 tops cannot create a multi-thousand fallback without market proof", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT Blitz | 49 топ 13 прем Wargaming", attributes: { top_count: 49, premium_count: 13, wot_blitz: 1, origin: "brute" } };
  const result = analyzeItem(target, [], { lowConfidenceAction: "approximate" });
  assert.ok(result.proposedPrice >= 300 && result.proposedPrice <= 600);
  assert.equal(result.diagnostics.roughEstimate, true);
});

test("15 premiums without tops cannot inherit a 300-ruble weak market tier", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT | 15 прем Wargaming", attributes: { top_count: 0, premium_count: 15, gold: 24_544, wot_credits: 2_804_663, origin: "brute" } };
  const market = [
    { id: 2, category: "world-of-tanks", title: "Patton Tank | T-127 | Matilda Wargaming", price: 300, seller_id: "a", attributes: { top_count: 0, premium_count: 3, origin: "brute" } },
    { id: 3, category: "world-of-tanks", title: "Мир танков Wargaming", price: 225, seller_id: "b", attributes: { top_count: 0, premium_count: 0, origin: "brute" } }
  ];
  const result = analyzeItem(target, market, { strategy: "active", lowConfidenceAction: "approximate" });
  assert.equal(result.proposedPrice, 1);
});

test("one 8655-ruble listing cannot price a zero-top account", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT | 35 прем Wargaming", attributes: { top_count: 0, premium_count: 35, gold: 8_008, wot_credits: 14_141_877, origin: "brute" } };
  const market = [{ id: 2, category: "world-of-tanks", title: "WotkaJule Wargaming", price: 8655, seller_id: "a", attributes: { top_count: 0, premium_count: 0, origin: "brute" } }];
  const result = analyzeItem(target, market, { strategy: "active", lowConfidenceAction: "approximate" });
  assert.ok(result.proposedPrice < 100);
});

test("a five-ruble dominant analog cannot underprice a loaded WoT garage", () => {
  const target = { id: 1, category: "world-of-tanks", title: "WoT | 20 топ 30 прем Wargaming", attributes: { top_count: 20, premium_count: 30, origin: "brute" } };
  const market = [
    { id: 2, category: "world-of-tanks", title: "WOT отлега Wargaming", price: 5, seller_id: "a", attributes: { top_count: 0, premium_count: 2, origin: "brute" } },
    { id: 3, category: "world-of-tanks", title: "WOT дешево Wargaming", price: 10, seller_id: "b", attributes: { top_count: 1, premium_count: 3, origin: "brute" } }
  ];
  const result = analyzeItem(target, market, { strategy: "active", lowConfidenceAction: "approximate" });
  assert.ok(result.proposedPrice >= 80 && result.proposedPrice <= 270);
});

test("Minecraft ignores 100000 placeholders and prices account features", () => {
  const target = { id: 1, category: "minecraft", title: "Java Bedrock | 2 плаща | смена ника", attributes: { minecraft_has_paid_license: true, minecraft_java: 1, minecraft_bedrock: 1, minecraft_can_change_nickname: 1, minecraft_capes_count: 2, minecraft_hypixel_level: 3, minecraft_hypixel_achievement: 180 } };
  const market = [
    { id: 2, category: "minecraft", title: "2 плаща", price: 100000, seller_id: "a", attributes: { minecraft_hypixel_achievement: 180 } },
    { id: 3, category: "minecraft", title: "Minecraft NFA", price: 28, seller_id: "b", attributes: { minecraft_hypixel_achievement: 0 } }
  ];
  const result = analyzeItem(target, market, { strategy: "active", lowConfidenceAction: "approximate" });
  assert.ok(result.proposedPrice >= 50 && result.proposedPrice <= 200);
  assert.notEqual(result.proposedPrice, 100000);
});

test("VPN subscription through 2029 is not priced like a near-expired plan", () => {
  const long = { id: 1, category: "vpn", title: "PIA VPN | Подписка до 11 янв 2029", attributes: {} };
  const short = { id: 2, category: "vpn", title: "PIA VPN | Подписка до 3 дек 2026", attributes: {} };
  const market = [{ id: 3, category: "vpn", title: "PIA VPN", price: 36, seller_id: "a", attributes: {} }];
  const longResult = analyzeItem(long, market, { strategy: "active", lowConfidenceAction: "approximate" });
  const shortResult = analyzeItem(short, market, { strategy: "active", lowConfidenceAction: "approximate" });
  assert.ok(longResult.proposedPrice >= 100);
  assert.ok(longResult.proposedPrice > shortResult.proposedPrice);
});

test("low-confidence approximate mode always returns a selectable estimate", () => {
  const target = { id: 1, category: "future-game", price: 99999, attributes: { level: 100 } };
  const market = [{ id: 2, category: "future-game", price: 50, attributes: { level: 1 } }];
  const result = analyzeItem(target, market, { strategy: "active", lowConfidenceAction: "approximate" });
  assert.equal(result.proposedPrice, 50);
  assert.equal(result.status, "ready");
  assert.equal(result.diagnostics.roughEstimate, true);
});

test("TikTok accounts in one follower bucket are close analogs", () => {
  const similarity = itemSimilarity(
    { id: 1, category: "tiktok", attributes: { followers: 10_000, cookie_login: true } },
    { id: 2, category: "tiktok", attributes: { followers: 18_000, cookie_login: true } }
  );
  assert.ok(similarity.score > .9);
});

test("TikTok accounts from different follower buckets are not analogs", () => {
  const similarity = itemSimilarity(
    { id: 1, category: "tiktok", attributes: { followers: 400, cookie_login: true } },
    { id: 2, category: "tiktok", attributes: { followers: 1500, cookie_login: true } }
  );
  assert.ok(similarity.score < .52);
});

test("active strategy uses cheapest sufficiently similar active listing", () => {
  const target = { id: 1, category: "tiktok", seller_id: 7, price: 99999, attributes: { followers: 412, cookie_login: true } };
  const market = [
    { id: 2, category: "tiktok", seller_id: 8, price: 3, state: "active", attributes: { followers: 380, cookie_login: true } },
    { id: 3, category: "tiktok", seller_id: 9, price: 5, state: "active", attributes: { followers: 600, cookie_login: true } }
  ];
  assert.equal(analyzeItem(target, market, { strategy: "active" }).proposedPrice, 3);
});

test("weighted median prevents one cheap outlier from setting the market price", () => {
  const target = { id: 1, category: "future-game", price: 99999, attributes: { rank: 10, region: "eu" } };
  const market = [
    { id: 2, category: "future-game", price: 1, state: "active", attributes: { rank: 10, region: "eu" } },
    { id: 3, category: "future-game", price: 100, state: "active", attributes: { rank: 10, region: "eu" } },
    { id: 4, category: "future-game", price: 110, state: "active", attributes: { rank: 10, region: "eu" } }
  ];
  const baseProfile = {
    strategy: "active",
    minSimilarity: .5,
    minAnalogs: 1,
    manualThreshold: .2,
    allowCategoryFallback: false,
    useUnconfiguredFields: false,
    fields: {
      rank: { mode: "exact", weight: 3, missing: "reject" },
      region: { mode: "exact", weight: 2, missing: "reject" }
    }
  };
  const robust = analyzeItem(target, market, { categoryProfiles: { "future-game": { ...baseProfile, activeEstimator: "weightedMedian" } } });
  const aggressive = analyzeItem(target, market, { categoryProfiles: { "future-game": { ...baseProfile, activeEstimator: "lowest", filterPriceOutliers: false } } });
  assert.equal(robust.proposedPrice, 100);
  assert.equal(robust.diagnostics.activeEstimator, "weightedMedian");
  assert.equal(aggressive.proposedPrice, 1);
});

test("technical-looking market prices are removed before any active estimator", () => {
  const target = { id: 1, category: "future-game", price: 199, attributes: { rank: 10 } };
  const market = [
    { id: 2, category: "future-game", price: 225, state: "active", attributes: { rank: 10 } },
    { id: 3, category: "future-game", price: 8_888, state: "active", attributes: { rank: 10 } },
    { id: 4, category: "future-game", price: 8_488, state: "active", attributes: { rank: 10 } }
  ];
  const profile = {
    strategy: "active",
    minSimilarity: .5,
    minAnalogs: 2,
    manualThreshold: .5,
    allowCategoryFallback: false,
    useUnconfiguredFields: false,
    fields: { rank: { mode: "exact", weight: 3, missing: "reject" } }
  };
  const result = analyzeItem(target, market, { categoryProfiles: { "future-game": profile } });
  assert.equal(result.proposedPrice, 225);
  assert.equal(result.status, "manual");
  assert.equal(result.diagnostics.candidateFunnel.placeholderPrice, 2);
  assert.deepEqual(result.analogs.map(item => item.price), [225]);
});

test("a supported normal price tier survives both cheap and expensive outliers", () => {
  const target = { id: 1, category: "future-game", price: 199, attributes: { rank: 10 } };
  const market = [
    { id: 2, category: "future-game", price: 1, state: "active", attributes: { rank: 10 } },
    { id: 3, category: "future-game", price: 100, state: "active", attributes: { rank: 10 } },
    { id: 4, category: "future-game", price: 110, state: "active", attributes: { rank: 10 } },
    { id: 5, category: "future-game", price: 2_500, state: "active", attributes: { rank: 10 } },
    { id: 6, category: "future-game", price: 2_600, state: "active", attributes: { rank: 10 } }
  ];
  const profile = {
    strategy: "active",
    activeEstimator: "median",
    minSimilarity: .5,
    minAnalogs: 2,
    manualThreshold: .5,
    allowCategoryFallback: false,
    useUnconfiguredFields: false,
    fields: { rank: { mode: "exact", weight: 3, missing: "reject" } }
  };
  const result = analyzeItem(target, market, { categoryProfiles: { "future-game": profile } });
  assert.equal(result.proposedPrice, 105);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.analogs.map(item => item.price), [100, 110]);
  assert.equal(result.diagnostics.priceCluster.keptSide, "upper");
  assert.equal(result.diagnostics.priceCluster.rejected, 3);
  assert.equal(result.nearMisses[0].price, 1);
});

test("a supported lower tier is used instead of a detached expensive tier", () => {
  const target = { id: 1, category: "future-game", price: 199, attributes: { rank: 10 } };
  const market = [
    { id: 2, category: "future-game", price: 100, state: "active", attributes: { rank: 10 } },
    { id: 3, category: "future-game", price: 110, state: "active", attributes: { rank: 10 } },
    { id: 4, category: "future-game", price: 2_500, state: "active", attributes: { rank: 10 } },
    { id: 5, category: "future-game", price: 2_600, state: "active", attributes: { rank: 10 } }
  ];
  const profile = {
    strategy: "active",
    minSimilarity: .5,
    minAnalogs: 2,
    manualThreshold: .5,
    allowCategoryFallback: false,
    useUnconfiguredFields: false,
    fields: { rank: { mode: "exact", weight: 3, missing: "reject" } }
  };
  const result = analyzeItem(target, market, { categoryProfiles: { "future-game": profile } });
  assert.equal(result.proposedPrice, 100);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.priceRange, { min: 100, max: 110 });
  assert.equal(result.diagnostics.priceCluster.rejected, 2);
  assert.equal(result.diagnostics.filterPriceOutliers, true);
  assert.equal(result.diagnostics.priceOutlierRatio, 6);
});

test("last sold strategy selects most recent comparable sale", () => {
  const target = { id: 1, category: "future-game", price: 99999, attributes: { games_count: 20, level: 5 } };
  const market = [
    { id: 2, category: "future-game", price: 100, state: "sold", sold_at: 10, attributes: { games_count: 19, level: 5 } },
    { id: 3, category: "future-game", price: 130, state: "sold", sold_at: 20, attributes: { games_count: 22, level: 6 } }
  ];
  assert.equal(analyzeItem(target, market, { strategy: "lastSold" }).proposedPrice, 130);
});

test("discount is configurable from zero to ninety-nine percent", () => {
  const target = { id: 1, category: "future-game", price: 99999, attributes: { games_count: 20 } };
  const market = [{ id: 2, category: "future-game", price: 100, state: "active", attributes: { games_count: 20 } }];
  assert.equal(analyzeItem(target, market, { strategy: "active", discountPercent: 25 }).proposedPrice, 75);
  assert.equal(analyzeItem(target, market, { strategy: "active", discountPercent: 99 }).proposedPrice, 1);
});

test("a category profile discount overrides the global discount", () => {
  const target = { id: 1, category: "future-game", price: 99999, attributes: { rank: 10 } };
  const market = [{ id: 2, category: "future-game", price: 100, state: "active", attributes: { rank: 10 } }];
  const profile = {
    automatic: false,
    strategy: "active",
    discountPercent: 20,
    minSimilarity: .5,
    manualThreshold: .2,
    allowCategoryFallback: false,
    useUnconfiguredFields: false,
    fields: { rank: { mode: "exact", weight: 5, missing: "reject" } }
  };
  const result = analyzeItem(target, market, { discountPercent: 50, categoryProfiles: { "future-game": profile } });
  assert.equal(result.proposedPrice, 80);
});

test("a manual universal profile rejects cheap empty accounts and prices valuable ones", () => {
  const target = { id: 1, category: "world-of-tanks", price: 199, attributes: { origin: "brute", top_count: 8 } };
  const market = [
    { id: 2, category: "world-of-tanks", price: 1, state: "active", attributes: { origin: "brute", top_count: 0 } },
    { id: 3, category: "world-of-tanks", price: 120, state: "active", attributes: { origin: "brute", top_count: 8 } },
    { id: 4, category: "world-of-tanks", price: 130, state: "active", attributes: { origin: "brute", top_count: 8 } }
  ];
  const profile = {
    schemaVersion: 5,
    automatic: false,
    name: "Правила продавца",
    strategy: "active",
    minSimilarity: .5,
    minAnalogs: 2,
    manualThreshold: .4,
    activeEstimator: "weightedMedian",
    allowCategoryFallback: false,
    useUnconfiguredFields: false,
    fields: {
      origin: { mode: "exact", weight: 5, missing: "reject" },
      top_count: { mode: "range", weight: 5, tolerancePercent: 25, toleranceAbsolute: 1, missing: "reject" }
    },
    fixedPriceRules: []
  };
  const result = analyzeItem(target, market, { categoryProfiles: { "world-of-tanks": profile } });
  assert.equal(result.proposedPrice, 120);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.analogs.map(analog => analog.id), ["3", "4"]);
  assert.equal(result.nearMisses.some(analog => analog.id === "2"), true);
  assert.equal(result.diagnostics.profile, "Правила продавца");
});

test("an empty manual profile never guesses from listing titles", () => {
  const target = { id: 1, category: "future-game", price: 99999, title: "Rare account", attributes: { rank: 50 } };
  const market = [{ id: 2, category: "future-game", price: 5000, state: "active", title: "Rare account", attributes: { rank: 1 } }];
  const profile = {
    automatic: false,
    name: "Пустой профиль",
    allowCategoryFallback: false,
    useUnconfiguredFields: false,
    fields: { rank: { mode: "ignore", weight: 0, missing: "ignore" } },
    fixedPriceRules: []
  };
  const result = analyzeItem(target, market, { categoryProfiles: { "future-game": profile } });
  assert.equal(result.proposedPrice, null);
  assert.equal(result.status, "manual");
  assert.equal(result.source, "Нет аналогов по вашему профилю");
});

test("unknown categories use dynamic attributes", () => {
  const target = { id: 1, category: "future-game", price: 99999, attributes: { rank: 50, region: "eu" } };
  const market = [{ id: 2, category: "future-game", price: 70, state: "active", attributes: { rank: 52, region: "eu" } }];
  const result = analyzeBatch([target], market, { strategy: "active" })[0];
  assert.equal(result.proposedPrice, 70);
  assert.ok(result.confidence > .4);
});

test("own and placeholder listings are excluded from analogs", () => {
  const target = { id: 1, category: "future-game", seller_id: 7, price: 99999, attributes: { level: 5 } };
  const market = [
    { id: 2, category: "future-game", seller_id: 7, price: 1, attributes: { level: 5 } },
    { id: 3, category: "future-game", seller_id: 9, price: 99999, attributes: { level: 5 } },
    { id: 4, category: "future-game", seller_id: 8, price: 80, attributes: { level: 5 } }
  ];
  assert.equal(analyzeItem(target, market, { strategy: "active" }).proposedPrice, 80);
});

test("legitimate expensive analogs are not excluded", () => {
  const target = { id: 1, category: "future-game", seller_id: 7, price: 99999, attributes: { level: 50 } };
  const market = [{ id: 2, category: "future-game", seller_id: 8, price: 25000, attributes: { level: 50 } }];
  assert.equal(analyzeItem(target, market, { strategy: "active", excludedPrices: [99999] }).proposedPrice, 25000);
});

test("WoT tank lists rank analogs but do not reject them by default", () => {
  const target = { id: 1, category: "world-of-tanks", price: 99999, attributes: { top_count: 31, gold: 4000, region: "eu", tanks: ["IS-7", "Leopard 1"] } };
  const market = [{ id: 2, category: "world-of-tanks", price: 50, attributes: { top_count: 31, gold: 4000, region: "eu", tanks: ["Maus", "E 100"] } }];
  assert.equal(itemSimilarity(target, market[0]).rejected, false);
  assert.equal(analyzeItem(target, market, { strategy: "active", lowConfidenceAction: "manual" }).status, "manual");
});

test("two good analogs can satisfy the confidence threshold", () => {
  const target = { id: 1, category: "future-game", price: 199, attributes: { rank: 10, region: "eu" } };
  const market = [
    { id: 2, category: "future-game", price: 100, attributes: { rank: 20, region: "eu" } },
    { id: 3, category: "future-game", price: 110, attributes: { rank: 21, region: "eu" } }
  ];
  const profile = {
    minSimilarity: .5,
    minAnalogs: 2,
    manualThreshold: .7,
    allowCategoryFallback: false,
    useUnconfiguredFields: false,
    fields: {
      rank: { mode: "similarity", weight: 1, missing: "reject" },
      region: { mode: "exact", weight: 1, missing: "reject" }
    }
  };
  const result = analyzeItem(target, market, { strategy: "active", categoryProfiles: { "future-game": profile } });
  assert.equal(result.status, "ready");
  assert.ok(result.confidence >= .7);
  assert.equal(result.diagnostics.evidenceFactor, .85);
});

test("WoT candidates may share part of the tank list without matching every tank", () => {
  const target = { id: 1, category: "world-of-tanks", price: 99999, attributes: { top_count: 31, premium_count: 40, gold: 4000, region: "eu", tanks: ["IS-7", "Leopard 1"] } };
  const market = [{ id: 2, category: "world-of-tanks", price: 90, attributes: { top_count: 30, premium_count: 42, gold: 4200, region: "eu", tanks: ["IS-7", "Maus"] } }];
  assert.equal(analyzeItem(target, market, { strategy: "active" }).proposedPrice, 90);
});

test("missing candidate detail lowers WoT confidence instead of discarding it before hydration", () => {
  const target = { id: 1, category: "world-of-tanks", price: 199, attributes: { top_count: 10, premium_count: 20, region: "eu", tanks: ["101"] } };
  const candidate = { id: 2, category: "world-of-tanks", price: 80, attributes: { top_count: 10, premium_count: 20, region: "eu" } };
  assert.ok(itemSimilarity(target, candidate).score > 0);
});

test("different origin is never treated as a comparable listing", () => {
  const target = { id: 1, category: "tiktok", price: 99999, item_origin: "stealer", attributes: { followers: 400, cookie_login: true } };
  const market = [{ id: 2, category: "tiktok", price: 3, item_origin: "brute", attributes: { followers: 400, cookie_login: true } }];
  assert.equal(analyzeItem(target, market, { strategy: "active", lowConfidenceAction: "manual" }).status, "manual");
});

test("approximate spam-block Telegram price includes the seller's eighty percent penalty", () => {
  const result = analyzeItem({ id: 1, category: "telegram", price: 99999, attributes: { spam_block: true } }, [{ id: 2, category: "telegram", price: 100, attributes: { spam_block: false } }], { strategy: "active" });
  assert.equal(result.proposedPrice, 20);
});

test("minimum price protects an automatic recommendation", () => {
  const target = { id: 1, category: "future-game", price: 99999, attributes: { level: 5 } };
  const market = [{ id: 2, category: "future-game", price: 3, attributes: { level: 5 } }];
  assert.equal(analyzeItem(target, market, { strategy: "active", minimumPrice: 10 }).proposedPrice, 10);
});
