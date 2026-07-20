function share(count, total) {
  return total ? count / total : 0;
}

function topEntries(map, total, maximum = 5) {
  return [...map.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, maximum)
    .map(entry => ({ ...entry, share: share(entry.count, total) }));
}

export function buildQualityReport(results = []) {
  const priced = results.filter(result => Number.isFinite(Number(result.proposedPrice)) && Number(result.proposedPrice) > 0);
  const marketPriced = priced.filter(result => !String(result.source ?? "").startsWith("Ценовое правило:"));
  const priceCounts = new Map();
  for (const result of marketPriced) {
    const price = Number(result.proposedPrice);
    const current = priceCounts.get(price) ?? { price, count: 0 };
    current.count += 1;
    priceCounts.set(price, current);
  }
  const analogCounts = new Map();
  for (const result of marketPriced) {
    const seen = new Set();
    for (const analog of result.analogs ?? []) {
      const id = String(analog.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const current = analogCounts.get(id) ?? { id, title: String(analog.title ?? "").slice(0, 120), price: Number(analog.price) || 0, count: 0 };
      current.count += 1;
      analogCounts.set(id, current);
    }
  }
  const topPrices = topEntries(priceCounts, marketPriced.length);
  const topAnalogs = topEntries(analogCounts, marketPriced.length);
  const warnings = [];
  const dominantPrice = topPrices[0];
  if (marketPriced.length >= 20 && dominantPrice?.count >= 10 && dominantPrice.share >= .2) {
    warnings.push({
      code: "price-concentration",
      message: `${dominantPrice.count} рыночных рекомендаций (${Math.round(dominantPrice.share * 100)}%) дали одну цену ${dominantPrice.price}`
    });
  }
  const dominantAnalog = topAnalogs[0];
  if (marketPriced.length >= 20 && dominantAnalog?.count >= 10 && dominantAnalog.share >= .1) {
    warnings.push({
      code: "analog-concentration",
      message: `аналог #${dominantAnalog.id} участвует в ${dominantAnalog.count} оценках (${Math.round(dominantAnalog.share * 100)}%)`
    });
  }
  const manual = results.filter(result => result.status === "manual").length;
  if (results.length >= 20 && share(manual, results.length) >= .35) {
    warnings.push({
      code: "manual-share",
      message: `${manual} лотов (${Math.round(share(manual, results.length) * 100)}%) требуют ручной проверки`
    });
  }
  return {
    total: results.length,
    priced: priced.length,
    marketPriced: marketPriced.length,
    ready: results.filter(result => result.status === "ready").length,
    manual,
    uniqueMarketPrices: priceCounts.size,
    topPrices,
    topAnalogs,
    warnings
  };
}
