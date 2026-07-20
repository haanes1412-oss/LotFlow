import { element } from "./profile-builder-controls.js";

export function showProfileConfigurationWarning(container) {
  container.replaceChildren(
    element("b", "", "Сначала выберите важные характеристики"),
    element("div", "preview-message bad", "Отметьте хотя бы одно поле как «Важно» или «Обязательно». Пустой профиль не должен угадывать цену по всей категории.")
  );
  container.hidden = false;
}

export function showProfilePreview(container, results, currency, onSave) {
  const title = element("b", "", "Проверка профиля на ваших лотах");
  const table = element("div", "profile-preview-table");
  let withAnalogs = 0;
  let withPrices = 0;
  for (const result of results) {
    const count = Number(result.diagnostics?.evidenceCount ?? result.analogs?.length ?? 0);
    if (count) withAnalogs += 1;
    if (result.proposedPrice != null) withPrices += 1;
    const price = result.proposedPrice == null ? "нет цены" : `${result.proposedPrice} ${String(currency).toUpperCase()}`;
    table.append(
      element("span", "preview-id", `#${result.item.id}`),
      element("span", "preview-title", result.item.title),
      element("span", "", `${count} аналогов`),
      element("b", result.proposedPrice == null ? "preview-empty" : "", price)
    );
  }
  const complete = withPrices === results.length;
  const messageClass = complete ? "preview-message good" : withPrices ? "preview-message warn" : "preview-message bad";
  const messageText = complete
    ? `Проверены разные сегменты категории. Цена рассчитана для всех ${results.length} лотов.`
    : withPrices
      ? `Цена рассчитана для ${withPrices} из ${results.length}, аналоги найдены для ${withAnalogs}. Остальные останутся на ручной проверке.`
      : withAnalogs
        ? `Аналоги найдены для ${withAnalogs} из ${results.length}, но безопасной цены нет. Можно ослабить правило или сохранить профиль, чтобы API заново собрал рынок.`
        : "В текущей выборке аналогов нет. Ослабьте одно поле или сохраните профиль, чтобы API заново собрал рынок по вашим правилам.";
  const message = element("div", messageClass, messageText);
  const actions = element("div", "profile-preview-actions");
  const saveLabel = withPrices ? "Сохранить профиль и обновить аналоги" : "Сохранить правила и заново собрать рынок";
  const save = element("button", "button primary", saveLabel);
  save.type = "button";
  save.addEventListener("click", onSave);
  actions.append(save);
  container.replaceChildren(title, message, table, actions);
  container.hidden = false;
}
