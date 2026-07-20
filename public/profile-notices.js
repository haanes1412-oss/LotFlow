function textNode(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  node.textContent = String(text ?? "");
  return node;
}

export function updateProfileNotices(container, { results, categoryOf, categoryLabel, hasManualProfile }) {
  const counts = new Map();
  for (const result of results) {
    const category = categoryOf(result.item);
    if (result.status !== "manual" || hasManualProfile(category)) continue;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const notices = [...counts].sort((left, right) => right[1] - left[1]).slice(0, 6).map(([category, count]) => {
    const notice = textNode("div", "profile-notice", "");
    const copy = document.createElement("div");
    copy.append(
      textNode("b", "", `Категория «${categoryLabel(category)}» ещё не настроена.`),
      document.createTextNode(` ${count} лотов ждут ваших правил. Инструмент не гадает, какие характеристики ценны: выберите их и проверьте профиль за минуту.`)
    );
    const button = textNode("button", "button ghost configure-profile", `Настроить ${categoryLabel(category)}`);
    button.type = "button";
    button.dataset.category = category;
    notice.append(copy, button);
    return notice;
  });
  container.replaceChildren(...notices);
  container.hidden = !notices.length;
}
