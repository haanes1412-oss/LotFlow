export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, ratio));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function weightedMedian(candidates) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((left, right) => left.price - right.price);
  const weighted = sorted.map(candidate => ({
    candidate,
    weight: 0.5 + Math.min(1, Math.max(0, Number(candidate.similarity?.score) || 0))
  }));
  const midpoint = weighted.reduce((sum, entry) => sum + entry.weight, 0) / 2;
  let cumulative = 0;
  for (const entry of weighted) {
    cumulative += entry.weight;
    if (cumulative >= midpoint) return entry.candidate.price;
  }
  return weighted.at(-1).candidate.price;
}

const LABELS = {
  lowest: "минимальная цена",
  lowerQuartile: "нижний квартиль",
  median: "медиана",
  weightedMedian: "взвешенная медиана"
};

export function activeEstimatorLabel(estimator) {
  return LABELS[estimator] ?? LABELS.weightedMedian;
}

// Curated "anchor" prices sellers park unsold lots at instead of a real market
// price. Filtering these out of the ACTIVE analog pool keeps a wall of 8888 /
// 9999 / 12345 placeholders from dragging an honest estimate up or down. Sold
// lots are never filtered by this — a real sale at any price is real evidence.
// Only clearly-artificial four-digit-and-up numbers are treated as placeholders.
// We deliberately keep the original >=1000 floor so plausible real prices (1, 5,
// 77, 100, 999, 1000...) are never blanket-filtered — blanket-filtering them would
// break categories that already work and throw away real cheap analogs. Genuinely
// low junk analogs (an empty account parked at 1 ₽) are handled by the
// value-mismatch guardrail in the pricing engine, not here. Beyond the original
// repeated-digit rule we now also catch ascending/descending keyboard runs
// (1234, 12345, 4321, 54321) and a couple of well-known filler numbers.
export const PLACEHOLDER_ANCHOR_PRICES = new Set([
  1_337, 31_337, 13_337, 100_000
]);

function hasUniformDigits(digits) {
  const firstDigitCount = [...digits].filter(digit => digit === digits[0]).length;
  return firstDigitCount / digits.length >= 0.75;
}

function isSequentialDigits(digits) {
  if (digits.length < 4) return false;
  let ascending = true; let descending = true;
  for (let index = 1; index < digits.length; index += 1) {
    const delta = Number(digits[index]) - Number(digits[index - 1]);
    if (delta !== 1) ascending = false;
    if (delta !== -1) descending = false;
  }
  return ascending || descending;
}

export function isPlaceholderPrice(value) {
  const price = Number(value);
  if (!Number.isInteger(price) || price < 1_000) return false;
  if (PLACEHOLDER_ANCHOR_PRICES.has(price)) return true;
  const digits = String(price);
  if (hasUniformDigits(digits)) return true;
  if (isSequentialDigits(digits)) return true;
  return false;
}

function clusterSupport(cluster) {
  return cluster.reduce((sum, candidate) => sum + .5 + Math.min(1, Math.max(0, Number(candidate.similarity?.score) || 0)), 0);
}

export function coherentPriceCluster(candidates, maximumRatio = 6, { preferLowerSupported = false } = {}) {
  const sorted = [...candidates].filter(candidate => Number.isFinite(Number(candidate.price)) && candidate.price > 0).sort((left, right) => left.price - right.price);
  if (sorted.length < 2) return { candidates: sorted, rejected: [], gapRatio: 1, keptSide: "all" };
  const clusters = [[]];
  let gapRatio = 1;
  for (const candidate of sorted) {
    const previous = clusters.at(-1).at(-1);
    const ratio = previous ? candidate.price / previous.price : 1;
    gapRatio = Math.max(gapRatio, ratio);
    if (previous && ratio >= maximumRatio) clusters.push([]);
    clusters.at(-1).push(candidate);
  }
  if (clusters.length === 1) return { candidates: sorted, rejected: [], gapRatio, keptSide: "all" };
  const supported = clusters.filter(cluster => cluster.length >= 2);
  if (!supported.length) return { candidates: [], rejected: sorted, gapRatio, keptSide: "conflict" };
  const ranked = supported.map(cluster => ({ cluster, support: clusterSupport(cluster) }))
    .sort((left, right) => right.support - left.support || left.cluster[0].price - right.cluster[0].price);
  // A low-value target must not jump to a detached expensive tier merely
  // because that tier has one slightly stronger similarity score. The caller
  // enables this only when domain evidence says the target belongs to the
  // cheapest supported segment (currently WoT accounts without top tanks).
  const selected = preferLowerSupported ? supported[0] : ranked[0].cluster;
  return {
    candidates: selected,
    rejected: clusters.filter(cluster => cluster !== selected).flat(),
    gapRatio,
    keptSide: selected === clusters[0] ? "lower" : "upper"
  };
}

function comparableTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\d+(?:[.,]\d+)?/g, "#")
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .trim()
    .slice(0, 120);
}

export function diversifyCandidates(candidates, { perSeller = 1, perTitlePattern = 2 } = {}) {
  const kept = []; const rejected = []; const sellers = new Map(); const titles = new Map();
  for (const candidate of candidates) {
    const seller = String(candidate.sellerId ?? "");
    const title = seller ? comparableTitle(candidate.title) : "";
    const sellerCount = seller ? sellers.get(seller) ?? 0 : 0;
    const titleCount = title ? titles.get(title) ?? 0 : 0;
    if ((seller && sellerCount >= perSeller) || (title && titleCount >= perTitlePattern)) {
      rejected.push(candidate);
      continue;
    }
    kept.push(candidate);
    if (seller) sellers.set(seller, sellerCount + 1);
    if (title) titles.set(title, titleCount + 1);
  }
  return { candidates: kept, rejected };
}

export function activeMarketPrice(candidates, estimator) {
  const prices = candidates.map(candidate => candidate.price);
  if (!prices.length) return null;
  if (estimator === "lowest") return Math.min(...prices);
  if (estimator === "lowerQuartile") return quantile(prices, 0.25);
  if (estimator === "median") return median(prices);
  return weightedMedian(candidates);
}
