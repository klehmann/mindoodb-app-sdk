import { describe, expect, it } from "vitest";

import {
  DEFAULT_HAVEN_HOST_SHORTCUTS,
  matchHostShortcut,
  sanitizeHostShortcutBindings,
} from "./hostShortcuts";

function chord(partial: Partial<KeyboardEvent> & { code: string }): KeyboardEvent {
  return {
    code: partial.code,
    shiftKey: partial.shiftKey ?? false,
    metaKey: partial.metaKey ?? false,
    ctrlKey: partial.ctrlKey ?? false,
    altKey: partial.altKey ?? false,
    repeat: partial.repeat ?? false,
  } as KeyboardEvent;
}

describe("matchHostShortcut", () => {
  it("matches Ctrl+Shift+Enter and Meta+Shift+Space", () => {
    expect(
      matchHostShortcut(chord({ code: "Enter", shiftKey: true, ctrlKey: true })),
    ).toBe("open-workspace");
    expect(
      matchHostShortcut(chord({ code: "Space", shiftKey: true, metaKey: true })),
    ).toBe("toggle-app-drawer");
    expect(
      matchHostShortcut(chord({ code: "KeyM", shiftKey: true, metaKey: true })),
    ).toBe("toggle-workspace-maximize");
    expect(
      matchHostShortcut(chord({ code: "Backspace", shiftKey: true, metaKey: true })),
    ).toBe("quit-app");
    expect(matchHostShortcut(chord({ code: "Backspace", metaKey: true }))).toBeNull();
    expect(
      matchHostShortcut(chord({ code: "NumpadEnter", shiftKey: true, metaKey: true })),
    ).toBe("open-workspace");
  });

  it("rejects AltGr-style Ctrl+Alt and key repeat", () => {
    expect(
      matchHostShortcut(chord({ code: "Enter", shiftKey: true, ctrlKey: true, altKey: true })),
    ).toBeNull();
    expect(
      matchHostShortcut(chord({ code: "Space", shiftKey: true, metaKey: true, repeat: true })),
    ).toBeNull();
    expect(matchHostShortcut(chord({ code: "Enter", shiftKey: true }))).toBeNull();
  });
});

describe("sanitizeHostShortcutBindings", () => {
  it("accepts the default table and rejects a malformed one", () => {
    expect(sanitizeHostShortcutBindings([...DEFAULT_HAVEN_HOST_SHORTCUTS])).toEqual([
      ...DEFAULT_HAVEN_HOST_SHORTCUTS,
    ]);
    expect(sanitizeHostShortcutBindings([{ action: "open-workspace" }])).toBeNull();
    expect(sanitizeHostShortcutBindings("Enter")).toBeNull();
    expect(
      sanitizeHostShortcutBindings([{ action: "Not An Action", code: "KeyX", shiftKey: true, metaOrCtrl: true }]),
    ).toBeNull();
  });

  it("keeps chords a newer host adds, so they reach the host from older apps", () => {
    const pushed = [
      ...DEFAULT_HAVEN_HOST_SHORTCUTS,
      { action: "some-future-action", code: "KeyK", shiftKey: true, metaOrCtrl: true },
    ];
    const table = sanitizeHostShortcutBindings(pushed);
    expect(table).toEqual(pushed);
    expect(
      matchHostShortcut(chord({ code: "KeyK", shiftKey: true, ctrlKey: true }), table!),
    ).toBe("some-future-action");
  });
});
