function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function selectCalibrationTargets(items, limit = 8) {
  const source = [...items];
  if (source.length <= limit) return source;
  const sorted = source.sort((left, right) => (Number(left.price) || 0) - (Number(right.price) || 0));
  const selected = [];
  for (let index = 0; index < limit; index += 1) {
    const position = Math.round(index * (sorted.length - 1) / (limit - 1));
    const item = sorted[position];
    if (item && !selected.some(current => String(current.id) === String(item.id))) selected.push(item);
  }
  return selected;
}

export function calibrateProfile(profile, examples, results) {
  const resultById = new Map(results.map(result => [String(result.item?.id), result]));
  const pairs = examples.map(example => {
    const result = resultById.get(String(example.id));
    return { ...example, expected: Number(example.expectedPrice), calculated: Number(result?.proposedPrice) };
  }).filter(pair => pair.expected > 0 && pair.calculated > 0);
  if (pairs.length < 3) throw new Error("Укажите правильную цену минимум для трёх примеров");

  const correction = clamp(median(pairs.map(pair => pair.expected / pair.calculated)), .25, 4);
  const currentMultiplier = Number(profile.priceMultiplier) || 100;
  const priceMultiplier = Math.round(clamp(currentMultiplier * correction, 25, 400));
  const checked = pairs.map(pair => {
    const predicted = Math.max(1, Math.round(pair.calculated * correction));
    const error = Math.abs(predicted - pair.expected) / pair.expected;
    return { ...pair, predicted, error };
  });
  const within20 = checked.filter(pair => pair.error <= .2).length;
  const meanError = checked.reduce((sum, pair) => sum + pair.error, 0) / checked.length;
  const status = checked.length >= 5 && within20 / checked.length >= .6 && meanError <= .3
    ? "ready" : checked.length < 5 ? "needs_examples" : "needs_review";
  return {
    profile: {
      ...profile,
      pricingGoal: "custom",
      priceMultiplier,
      calibrationExamples: examples.map(example => ({ id: example.id, title: example.title, oldPrice: example.oldPrice, expectedPrice: Number(example.expectedPrice) })),
      userCalibration: {
        status,
        examples: checked.length,
        within20,
        meanError: Number(meanError.toFixed(4)),
        correction: Number(correction.toFixed(4)),
        calibratedAt: new Date().toISOString()
      }
    },
    checked,
    status,
    priceMultiplier,
    within20,
    meanError
  };
}
