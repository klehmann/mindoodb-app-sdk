import type {
  MindooDBAppHostShortcutAction,
  MindooDBAppHostShortcutBinding,
} from "./types";

/**
 * Haven's default host chords. Both sides of the bridge use this table so a
 * key that Haven handles on its own pages is the same key an iframe reports.
 *
 * `code` is the physical {@link KeyboardEvent.code}: layout-independent, so
 * AltGr on a German keyboard cannot turn these into `@` or a nbsp.
 */
export const DEFAULT_HAVEN_HOST_SHORTCUTS: readonly MindooDBAppHostShortcutBinding[] = [
  { action: "open-workspace", code: "Enter", shiftKey: true, metaOrCtrl: true },
  { action: "toggle-app-drawer", code: "Space", shiftKey: true, metaOrCtrl: true },
];

const HOST_SHORTCUT_ACTIONS = new Set<MindooDBAppHostShortcutAction>([
  "open-workspace",
  "toggle-app-drawer",
]);

/** Numpad Enter is the same chord as the main Enter for "back to workspace". */
function normalizeShortcutCode(code: string) {
  return code === "NumpadEnter" ? "Enter" : code;
}

/**
 * Returns the host action for this key event, or `null` when it is not one
 * of the registered chords. `Alt` is rejected so AltGr (`Ctrl+Alt` on
 * European Windows layouts) never fires a shortcut while typing.
 */
export function matchHostShortcut(
  event: Pick<KeyboardEvent, "code" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey" | "repeat">,
  shortcuts: readonly MindooDBAppHostShortcutBinding[] = DEFAULT_HAVEN_HOST_SHORTCUTS,
): MindooDBAppHostShortcutAction | null {
  if (event.repeat || event.altKey) {
    return null;
  }
  const primary = event.metaKey || event.ctrlKey;
  const code = normalizeShortcutCode(event.code);
  for (const binding of shortcuts) {
    if (code !== binding.code) {
      continue;
    }
    if (Boolean(event.shiftKey) !== Boolean(binding.shiftKey)) {
      continue;
    }
    if (Boolean(binding.metaOrCtrl) !== primary) {
      continue;
    }
    return binding.action;
  }
  return null;
}

export function isHostShortcutAction(value: unknown): value is MindooDBAppHostShortcutAction {
  return typeof value === "string" && HOST_SHORTCUT_ACTIONS.has(value as MindooDBAppHostShortcutAction);
}

/** Accepts a host-pushed table; anything malformed is ignored. */
export function sanitizeHostShortcutBindings(value: unknown): MindooDBAppHostShortcutBinding[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const bindings: MindooDBAppHostShortcutBinding[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const candidate = entry as Partial<MindooDBAppHostShortcutBinding>;
    if (!isHostShortcutAction(candidate.action) || typeof candidate.code !== "string" || !candidate.code) {
      return null;
    }
    bindings.push({
      action: candidate.action,
      code: candidate.code,
      shiftKey: Boolean(candidate.shiftKey),
      metaOrCtrl: Boolean(candidate.metaOrCtrl),
    });
  }
  return bindings;
}

/**
 * Stops wheel chaining out of a hosted app document into Haven's workspace
 * scroller once the app page (or its `body`) has reached its end.
 */
export function applyHostedDocumentOverscrollContain(doc: Document | undefined = globalThis.document) {
  if (!doc?.documentElement) {
    return;
  }
  doc.documentElement.style.overscrollBehavior = "contain";
  if (doc.body) {
    doc.body.style.overscrollBehavior = "contain";
  }
}

/**
 * Capture-phase listener that reports a matched host chord. Returns a disposer.
 * No-ops when `document` is missing (Node tests that stub only `window`).
 */
export function installHostShortcutCapture(options: {
  getShortcuts: () => readonly MindooDBAppHostShortcutBinding[];
  onInvoke: (action: MindooDBAppHostShortcutAction) => void;
  target?: Document;
}): () => void {
  const target = options.target ?? (typeof document === "undefined" ? undefined : document);
  if (!target) {
    return () => undefined;
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const action = matchHostShortcut(event, options.getShortcuts());
    if (!action) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    options.onInvoke(action);
  };
  target.addEventListener("keydown", onKeyDown, true);
  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
  };
}
