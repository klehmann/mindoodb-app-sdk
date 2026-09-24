/**
 * Capture-phase listener that tells Haven the user pressed inside this app.
 * Returns a disposer. No-ops when `document` is missing.
 */
export function installHostFocusCapture(options: {
  onPointerDown: () => void;
  target?: {
    addEventListener(
      type: "pointerdown",
      listener: (event: Event) => void,
      capture?: boolean,
    ): void;
    removeEventListener(
      type: "pointerdown",
      listener: (event: Event) => void,
      capture?: boolean,
    ): void;
  };
}): () => void {
  const target = options.target ?? (typeof document === "undefined" ? undefined : document);
  if (!target) {
    return () => undefined;
  }
  const onPointerDown = () => {
    options.onPointerDown();
  };
  target.addEventListener("pointerdown", onPointerDown, true);
  return () => {
    target.removeEventListener("pointerdown", onPointerDown, true);
  };
}
