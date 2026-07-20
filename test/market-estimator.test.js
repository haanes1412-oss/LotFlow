import test from "node:test";
import assert from "node:assert/strict";
import { coherentPriceCluster, diversifyCandidates, isPlaceholderPrice } from "../src/market-estimator.js";

const candidate = (id, price) => ({ id, price, similarity: { score: 1 } });

test("placeholder price detection catches repeated technical patterns without rejecting normal psychological prices", () => {
  assert.equal(isPlaceholderPrice(8_888), true);
  assert.equal(isPlaceholderPrice(8_488), true);
  assert.equal(isPlaceholderPrice(99_999), true);
  assert.equal(isPlaceholderPrice(1_999), false);
  assert.equal(isPlaceholderPrice(1_000), false);
  assert.equal(isPlaceholderPrice(999), false);
});

test("one hundred thousand is treated as a parked technical price", () => {
  assert.equal(isPlaceholderPrice(100_000), true);
});

test("two isolated incompatible price levels cannot produce an automatic price", () => {
  const result = coherentPriceCluster([
    { id: "a", price: 1_000, similarity: { score: .9 } },
    { id: "b", price: 200_556, similarity: { score: .9 } }
  ], 5);
  assert.equal(result.keptSide, "conflict");
  assert.deepEqual(result.candidates, []);
});

test("price clustering keeps a supported lower tier across a large gap", () => {
  const result = coherentPriceCluster([
    candidate(1, 100), candidate(2, 110), candidate(3, 2_500), candidate(4, 2_600)
  ], 6);
  assert.deepEqual(result.candidates.map(item => item.id), [1, 2]);
  assert.deepEqual(result.rejected.map(item => item.id), [3, 4]);
  assert.equal(result.keptSide, "lower");
});

test("price clustering rejects a lone cheap outlier when the regular tier has support", () => {
  const result = coherentPriceCluster([
    candidate(1, 1), candidate(2, 100), candidate(3, 110)
  ], 6);
  assert.deepEqual(result.candidates.map(item => item.id), [2, 3]);
  assert.deepEqual(result.rejected.map(item => item.id), [1]);
  assert.equal(result.keptSide, "upper");
});

test("price clustering removes detached tiers on both sides of the supported market", () => {
  const result = coherentPriceCluster([
    candidate(1, 1), candidate(2, 100), candidate(3, 110), candidate(4, 2_500), candidate(5, 2_600)
  ], 6);
  assert.deepEqual(result.candidates.map(item => item.id), [2, 3]);
  assert.deepEqual(result.rejected.map(item => item.id), [1, 4, 5]);
  assert.equal(result.keptSide, "upper");
});

test("known low-value targets can prefer the cheapest supported tier", () => {
  const result = coherentPriceCluster([
    candidate(1, 1), candidate(2, 3), candidate(3, 19), candidate(4, 20), candidate(5, 89)
  ], 6, { preferLowerSupported: true });
  assert.deepEqual(result.candidates.map(item => item.id), [1, 2]);
  assert.equal(result.keptSide, "lower");
});

test("candidate diversification prevents one seller and copied title pattern from dominating", () => {
  const result = diversifyCandidates([
    { ...candidate(1, 100), sellerId: "a", title: "Rank 10 account" },
    { ...candidate(2, 101), sellerId: "a", title: "Rank 11 account" },
    { ...candidate(3, 102), sellerId: "b", title: "Rank 12 account" },
    { ...candidate(4, 103), sellerId: "c", title: "Rank 13 account" }
  ]);
  assert.deepEqual(result.candidates.map(item => item.id), [1, 3]);
  assert.deepEqual(result.rejected.map(item => item.id), [2, 4]);
});
