import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the universal three-level profile builder and live preview are wired into the browser app", async () => {
  const [html, app, builder, fieldEditor, notices, previewUi, references] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/profile-builder.js", import.meta.url), "utf8"),
    readFile(new URL("../public/profile-field-editor.js", import.meta.url), "utf8"),
    readFile(new URL("../public/profile-notices.js", import.meta.url), "utf8"),
    readFile(new URL("../public/profile-preview-ui.js", import.meta.url), "utf8"),
    readFile(new URL("../public/reference-library.js", import.meta.url), "utf8")
  ]);
  for (const id of ["searchPlans", "marketDetails", "priceSort"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(app, new RegExp(`#${id}[^\\w]`));
  }
  for (const id of ["referenceImport", "referenceExport", "referenceClear", "referenceSummary"]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(app, /referenceItems: state\.references\.items/);
  assert.match(references, /normalizeReferenceLibrary/);
  for (const id of ["profileCatalogSummary", "profileFieldFilter", "profileAutoFields", "profileActiveEstimator", "profileOutlierRatio", "profileFilterPriceOutliers", "profileAutomatic", "profileTest", "profilePreview", "profileNotices", "profileAdvancedSettings", "profileDiscount"]) assert.match(html, new RegExp(`id=["']${id}["']`));
  for (const id of ["profileExperience", "profileExperienceHelp", "profilePricingGoal", "profilePriceMin", "profilePriceMax"]) assert.match(html, new RegExp(`id=["']${id}["']`));
  for (const mode of ["guided", "manual", "expert"]) assert.match(html, new RegExp(`data-experience=["']${mode}["']`));
  for (const priority of ["required", "important", "ignore"]) assert.match(fieldEditor, new RegExp(`\\["${priority}"`));
  assert.match(builder, /autoConfigureFields\(\)/);
  assert.match(builder, /recommendedProfile\(/);
  assert.match(builder, /applyPricingGoal\(/);
  assert.match(builder, /CATEGORY_NAMES/);
  assert.match(builder, /fieldScore/);
  assert.doesNotMatch(fieldEditor, /element\("code", "", field\)/);
  assert.match(fieldEditor, /field-search/);
  assert.match(fieldEditor, /field-required/);
  assert.match(builder, /async open\(category/);
  assert.match(builder, /async testCurrent\(\)/);
  assert.match(builder, /onPreview/);
  assert.match(builder, /refreshMarket: true/);
  assert.match(app, /selectProfilePreviewTargets/);
  assert.match(previewUi, /Сохранить правила и заново собрать рынок/);
  assert.match(`${html}\n${fieldEditor}`, /Обязательно/);
  assert.match(`${html}\n${fieldEditor}`, /Важно/);
  assert.match(`${html}\n${fieldEditor}`, /Не важно/);
  assert.match(app, /updateProfileNotices/);
  assert.match(notices, /profile-notice/);
  assert.match(app, /configure-profile/);
  assert.match(app, /fieldCatalog/);
  assert.match(app, /autoProfiles/);
  assert.match(app, /nearMisses/);
  assert.match(app, /sanitizeDiagnostic/);
  assert.match(builder, /migrateLegacyProfiles/);
});
