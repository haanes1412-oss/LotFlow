const FIELD_MODES = [
  ["ignore", "Не учитывать"],
  ["similarity", "Учитывать сходство"],
  ["exact", "Точное совпадение"],
  ["range", "Числовой допуск"],
  ["overlap", "Общее значение"],
  ["bucket", "Один диапазон"]
];

const MISSING_MODES = [
  ["ignore", "Пропустить"],
  ["penalize", "Снизить сходство"],
  ["reject", "Отклонить аналог"]
];

const OPERATORS = [
  ["eq", "равно"], ["neq", "не равно"], ["gte", "не меньше"], ["lte", "не больше"],
  ["gt", "больше"], ["lt", "меньше"], ["between", "между"], ["contains", "содержит"],
  ["present", "заполнено"], ["missing", "не заполнено"]
];

export function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

export function selectControl(options, value, className) {
  const select = element("select", className);
  for (const [optionValue, label] of options) {
    const option = element("option", "", label);
    option.value = optionValue;
    option.selected = optionValue === value;
    select.append(option);
  }
  return select;
}

export function numberControl(value, { minimum = 0, maximum, step = 1, className = "" } = {}) {
  const input = element("input", className);
  input.type = "number";
  input.min = String(minimum);
  if (maximum !== undefined) input.max = String(maximum);
  input.step = String(step);
  input.value = value ?? "";
  return input;
}

export function conditionRow(condition, fieldNames) {
  const row = element("div", "profile-condition");
  const field = selectControl(fieldNames.map(name => [name, name]), condition.field ?? fieldNames[0], "condition-field");
  const operator = selectControl(OPERATORS, condition.operator ?? "eq", "condition-operator");
  const value = element("input", "condition-value");
  value.value = condition.value ?? "";
  value.placeholder = "значение";
  const valueTo = element("input", "condition-value-to");
  valueTo.value = condition.valueTo ?? "";
  valueTo.placeholder = "до";
  const remove = element("button", "icon-button remove-condition", "×");
  remove.type = "button";
  remove.title = "Удалить условие";
  row.append(field, operator, value, valueTo, remove);
  return row;
}

export function ruleCard(rule, fieldNames) {
  const card = element("article", "profile-rule");
  card.dataset.ruleId = rule.id ?? `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const header = element("div", "profile-rule-header");
  const enabled = element("input", "rule-enabled");
  enabled.type = "checkbox";
  enabled.checked = rule.enabled !== false;
  const name = element("input", "rule-name");
  name.value = rule.name ?? "Новое правило";
  name.placeholder = "Название правила";
  const price = numberControl(rule.price ?? 1, { minimum: 1, className: "rule-price" });
  price.placeholder = "Цена";
  const remove = element("button", "icon-button remove-rule", "×");
  remove.type = "button";
  remove.title = "Удалить правило";
  header.append(enabled, name, element("span", "rule-arrow", ""), price, remove);
  const conditions = element("div", "profile-conditions");
  for (const condition of rule.conditions ?? []) conditions.append(conditionRow(condition, fieldNames));
  if (!conditions.children.length) conditions.append(conditionRow({}, fieldNames));
  const add = element("button", "button ghost add-condition", "+ Условие");
  add.type = "button";
  card.append(header, conditions, add);
  return card;
}

function readCondition(row) {
  return {
    field: row.querySelector(".condition-field").value,
    operator: row.querySelector(".condition-operator").value,
    value: row.querySelector(".condition-value").value,
    valueTo: row.querySelector(".condition-value-to").value
  };
}

export function readRule(card) {
  return {
    id: card.dataset.ruleId,
    name: card.querySelector(".rule-name").value.trim() || "Правило",
    enabled: card.querySelector(".rule-enabled").checked,
    price: Number(card.querySelector(".rule-price").value) || 1,
    conditions: [...card.querySelectorAll(".profile-condition")].map(readCondition)
  };
}

export const fieldControls = { modes: FIELD_MODES, missingModes: MISSING_MODES };
