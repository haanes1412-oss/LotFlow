export function textElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = String(text ?? "");
  return element;
}

export function tableCell(...children) {
  const cell = document.createElement("td");
  cell.append(...children);
  return cell;
}
