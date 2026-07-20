import test from "node:test";
import assert from "node:assert/strict";
import { glossaryEntry, glossaryLabel, FIELD_GLOSSARY } from "../public/field-glossary.js";

test("glossary covers common and category-specific fields", () => {
  assert.equal(glossaryEntry("origin").label, "Происхождение");
  assert.ok(glossaryEntry("origin").hint.length > 0);
  assert.equal(glossaryLabel("wot_top_premium_tanks"), "Топ-премы");
  assert.ok(glossaryEntry("spam_block"));
  assert.ok(glossaryEntry("adventure_rank"));
  assert.ok(glossaryEntry("steam_level"));
  assert.ok(glossaryEntry("hypixel_level"));
});

test("glossary lookups normalize technical keys", () => {
  assert.equal(glossaryLabel("accountLastActivity"), "Отлёга аккаунта");
  assert.equal(glossaryEntry("Email Access").label, "Доступ к почте");
});

test("unknown fields have no glossary entry", () => {
  assert.equal(glossaryEntry("totally_unknown_field"), null);
  assert.equal(glossaryLabel("totally_unknown_field"), null);
});

test("glossary stays lean (i18n, not a preset)", () => {
  assert.ok(Object.keys(FIELD_GLOSSARY).length <= 70);
});

test("subscription constructor fields have Russian labels", () => {
  assert.equal(glossaryLabel("autorenewal"), "Автопродление");
  assert.equal(glossaryLabel("service"), "Сервис или тип аккаунта");
  assert.equal(glossaryLabel("subscription_length"), "Срок подписки");
  assert.equal(glossaryLabel("subscription_period"), "Единица срока");
});
