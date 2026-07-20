import test from "node:test";
import assert from "node:assert/strict";
import { calibrateProfile, selectCalibrationTargets } from "../public/profile-calibration.js";

test("calibration examples cover cheap, middle and expensive lots", () => {
  const items = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, price: (index + 1) * 10 }));
  const sample = selectCalibrationTargets(items, 5);
  assert.equal(sample.length, 5);
  assert.equal(sample[0].price, 10);
  assert.equal(sample.at(-1).price, 200);
});

test("seller examples calibrate the category multiplier and quality", () => {
  const profile = { priceMultiplier: 100 };
  const examples = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, title: `Лот ${index + 1}`, expectedPrice: (index + 1) * 100 }));
  const results = examples.map(example => ({ item: { id: example.id }, proposedPrice: example.expectedPrice / 2 }));
  const calibrated = calibrateProfile(profile, examples, results);
  assert.equal(calibrated.priceMultiplier, 200);
  assert.equal(calibrated.status, "ready");
  assert.equal(calibrated.within20, 5);
  assert.equal(calibrated.profile.userCalibration.examples, 5);
});

test("training requires at least three usable prices", () => {
  assert.throws(() => calibrateProfile({ priceMultiplier: 100 }, [{ id: 1, expectedPrice: 10 }], [{ item: { id: 1 }, proposedPrice: 5 }]), /минимум для трёх/);
});
