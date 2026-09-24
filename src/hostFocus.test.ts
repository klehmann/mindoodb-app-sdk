import { describe, expect, it } from "vitest";

import { installHostFocusCapture } from "./hostFocus";
import { createMockMindooDBAppSession } from "./testing/index";

describe("installHostFocusCapture", () => {
  it("posts a focus request on pointerdown and stops when disposed", () => {
    const requests: string[] = [];
    const listeners: Array<(event: Event) => void> = [];
    const target = {
      addEventListener(_type: "pointerdown", next: (event: Event) => void) {
        listeners.push(next);
      },
      removeEventListener(_type: "pointerdown", next: (event: Event) => void) {
        const index = listeners.indexOf(next);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      },
    };
    const stop = installHostFocusCapture({
      target,
      onPointerDown: () => {
        requests.push("workspace-focus-requested");
      },
    });

    listeners[0]?.({} as Event);
    expect(requests).toEqual(["workspace-focus-requested"]);

    stop();
    listeners[0]?.({} as Event);
    expect(requests).toEqual(["workspace-focus-requested"]);
  });
});

describe("mock session host focus and notify", () => {
  it("reports host focus and keeps a notification id", async () => {
    const mock = createMockMindooDBAppSession();
    expect(await mock.session.hasHostFocus()).toBe(false);

    const seen: boolean[] = [];
    const stop = mock.session.onHostFocusChange((focused) => {
      seen.push(focused);
    });
    await mock.session.requestHostFocus();
    expect(await mock.session.hasHostFocus()).toBe(true);
    expect(seen).toEqual([true]);

    mock.emitHostFocusChange(false);
    expect(await mock.session.hasHostFocus()).toBe(false);
    expect(seen).toEqual([true, false]);
    stop();

    const first = await mock.session.notify({
      id: "progress",
      severity: "info",
      text: "10%",
      durationMs: 1000,
    });
    const second = await mock.session.notify({
      id: "progress",
      severity: "info",
      text: "20%",
    });
    const third = await mock.session.notify({
      severity: "warning",
      text: "done",
    });
    expect(first.id).toBe("progress");
    expect(second.id).toBe(first.id);
    expect(third.id).not.toBe(first.id);
  });
});
