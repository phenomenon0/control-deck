export function isEditableElement(target: EventTarget | Element | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (
    target.closest(
      '.wterm, [role="textbox"], [role="combobox"], [data-hotkeys-ignore="true"]'
    )
  ) {
    return true;
  }

  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function shouldMoveFocusTo(target: HTMLElement | null): boolean {
  if (!target || typeof document === "undefined") {
    return false;
  }

  const active = document.activeElement;
  if (!active || active === document.body) {
    return true;
  }

  if (active === target) {
    return true;
  }

  return !isEditableElement(active);
}
