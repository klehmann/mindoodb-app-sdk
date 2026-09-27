import type { MindooDBAppDefinition } from "../appDefinition";
import type {
  MindooDBAppBridgeRpcRequest,
  MindooDBAppCapability,
  MindooDBAppHostTheme,
} from "../types";
import {
  createFakeBridgeHost,
  type CreateFakeBridgeHostOptions,
  type FakeBridgeHostController,
  type MockMindooDBAppDatabaseDefinition,
} from "./index";

/**
 * A stand-in Haven for a real browser: the app runs in an iframe, exactly as Haven frames
 * it, and talks to the same in-memory mock host the Vitest helpers use.
 *
 * This is what an app's test URL (`/__haven-test/` in the starter) mounts, so Playwright
 * and a developer's own eyes see the real app — real bridge handshake, real DOM — with
 * seeded data and scriptable host services, and without setting up an identity, a
 * tenant and an install in a real Haven. It is never meant to be deployed where end
 * users can reach it.
 */

/** A scan the test host hands out on the app's next `attachments.scan()` call. */
export interface BrowserTestHostScan {
  fileName: string;
  mimeType: "image/jpeg" | "image/png" | "application/pdf";
  size: number;
}

/** What the test host recorded, in the order the app asked. */
export interface BrowserTestHostLog {
  notifications: Array<{ id?: string; severity?: string; text?: string; durationMs?: number }>;
  previews: Array<{ databaseId: string; docId: string; attachmentName: string }>;
  scans: Array<{ databaseId: string; docId: string; result: "scanned" | "cancelled" }>;
  focusRequests: number;
  requests: MindooDBAppBridgeRpcRequest[];
}

export interface CreateBrowserTestHostOptions extends CreateFakeBridgeHostOptions {
  /** The iframe the app runs in. Its `src` is set by the host. */
  frame: HTMLIFrameElement;
  /** URL of the app page, relative to the test page or absolute. */
  appUrl: string;
  /** Called after every request, e.g. to re-render a control panel. */
  onChange?: () => void;
}

export interface BrowserTestHost {
  host: FakeBridgeHostController;
  log: BrowserTestHostLog;
  /**
   * Decides the outcome of the app's next `attachments.scan()`: a file description to
   * "scan", or `null` to act as if the user cancelled. Without a call, scans cancel.
   */
  setNextScan(scan: BrowserTestHostScan | null): void;
  setTheme(theme: MindooDBAppHostTheme): void;
  setHostFocus(focused: boolean): void;
  /** Reloads the app frame. The mock data survives; the app's in-memory state does not. */
  reloadApp(): void;
  dispose(): void;
}

/**
 * The capabilities Haven grants for the permissions a definition requests. `read` is
 * implied by the mapping, `write` is create plus update.
 */
export function capabilitiesForDefinitionPermissions(
  permissions: readonly string[] | undefined,
): MindooDBAppCapability[] {
  const result = new Set<MindooDBAppCapability>(["read"]);
  for (const permission of permissions ?? []) {
    if (permission === "write") {
      result.add("create");
      result.add("update");
    } else if (
      permission === "delete" ||
      permission === "history" ||
      permission === "attachments" ||
      permission === "views" ||
      permission === "sign" ||
      permission === "timestamps" ||
      permission === "directory" ||
      permission === "sealedchannel"
    ) {
      result.add(permission);
    }
  }
  return [...result];
}

/** Mock databases for every database a `haven-app.json` declares, granted as requested. */
export function mockDatabasesFromDefinition(
  definition: Pick<MindooDBAppDefinition, "databases">,
  seed: Record<string, MockMindooDBAppDatabaseDefinition["documents"]> = {},
): MockMindooDBAppDatabaseDefinition[] {
  return (definition.databases ?? []).map((database) => ({
    info: {
      id: database.logicalDatabaseId,
      title: database.label ?? database.logicalDatabaseId,
      capabilities: capabilitiesForDefinitionPermissions(database.permissions),
    },
    documents: seed[database.logicalDatabaseId],
  }));
}

function withLaunchId(appUrl: string, launchId: string): string {
  const url = new URL(appUrl, window.location.href);
  url.searchParams.set("mindoodbAppLaunchId", launchId);
  return url.toString();
}

export function createBrowserTestHost(options: CreateBrowserTestHostOptions): BrowserTestHost {
  const { frame, appUrl, onChange, ...hostOptions } = options;
  let nextScan: BrowserTestHostScan | null = null;
  let scanCounter = 0;
  const log: BrowserTestHostLog = {
    notifications: [],
    previews: [],
    scans: [],
    focusRequests: 0,
    requests: [],
  };

  const host = createFakeBridgeHost({
    ...hostOptions,
    onRequest(request) {
      log.requests.push(request);
      const params = (request.params ?? {}) as Record<string, unknown>;
      if (request.method === "notifications.show") {
        log.notifications.push({
          id: typeof params.id === "string" ? params.id : undefined,
          severity: typeof params.severity === "string" ? params.severity : undefined,
          text: typeof params.text === "string" ? params.text : undefined,
          durationMs: typeof params.durationMs === "number" ? params.durationMs : undefined,
        });
      } else if (request.method === "session.requestHostFocus") {
        log.focusRequests += 1;
      } else if (
        request.method === "attachments.openPreview" ||
        request.method === "attachments.preparePreviewSession"
      ) {
        log.previews.push({
          databaseId: String(params.databaseId),
          docId: String(params.docId),
          attachmentName: String(params.attachmentName),
        });
      }
      hostOptions.onRequest?.(request);
      queueMicrotask(() => onChange?.());
    },
    requestHandlers: {
      "attachments.scanAndWrite": (params) => {
        const input = (params ?? {}) as Record<string, unknown>;
        const scan = nextScan;
        nextScan = null;
        log.scans.push({
          databaseId: String(input.databaseId),
          docId: String(input.docId),
          result: scan ? "scanned" : "cancelled",
        });
        if (!scan) {
          return { ok: false };
        }
        scanCounter += 1;
        return {
          ok: true,
          attachment: {
            attachmentId: `test-scan-${scanCounter}`,
            fileName: scan.fileName,
            mimeType: scan.mimeType,
            size: scan.size,
          },
        };
      },
      ...hostOptions.requestHandlers,
    },
  });

  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== frame.contentWindow) {
      return;
    }
    host.acceptConnection(event.data, event.ports);
  };
  window.addEventListener("message", onMessage);
  frame.src = withLaunchId(appUrl, host.launchId);

  return {
    host,
    log,
    setNextScan(scan) {
      nextScan = scan;
    },
    setTheme(theme) {
      host.emitThemeChange(theme);
      onChange?.();
    },
    setHostFocus(focused) {
      host.emitHostFocusChange(focused);
      onChange?.();
    },
    reloadApp() {
      frame.src = withLaunchId(appUrl, host.launchId);
    },
    dispose() {
      window.removeEventListener("message", onMessage);
      host.dispose();
    },
  };
}

export interface MountHavenTestHostOptions extends Omit<CreateBrowserTestHostOptions, "frame" | "onChange"> {
  /** Element to render into. Defaults to `document.body`, which is cleared. */
  container?: HTMLElement;
  /** Heading of the control panel, e.g. the app label. */
  title?: string;
}

declare global {
  interface Window {
    /** Set by {@link mountHavenTestHost} so Playwright can script the host. */
    __havenTestHost?: BrowserTestHost;
  }
}

const STYLE = `
.htest{display:grid;grid-template-columns:minmax(0,1fr) 300px;height:100vh;margin:0;font:13px/1.45 system-ui,sans-serif;background:#eef1f7;color:#172033}
.htest *{box-sizing:border-box}
.htest__frame{width:100%;height:100%;border:0;background:#fff}
.htest__panel{border-left:1px solid #d7dce8;overflow:auto;padding:14px;background:#f8f9fc}
.htest__badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#fde68a;color:#713f12;font-weight:600;font-size:11px;letter-spacing:.04em}
.htest h1{font-size:15px;margin:8px 0 12px}
.htest h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#5b6478;margin:16px 0 6px}
.htest__row{display:flex;gap:6px;flex-wrap:wrap}
.htest button{font:inherit;padding:5px 9px;border-radius:7px;border:1px solid #c9d0e0;background:#fff;cursor:pointer}
.htest ul{list-style:none;margin:0;padding:0}
.htest li{padding:5px 0;border-bottom:1px solid #e4e8f1;word-break:break-word}
.htest__muted{color:#5b6478}
@media (max-width:720px){.htest{grid-template-columns:1fr;grid-template-rows:65vh auto}.htest__panel{border-left:0;border-top:1px solid #d7dce8}}
`;

function item(text: string): HTMLLIElement {
  const li = document.createElement("li");
  li.textContent = text;
  return li;
}

/**
 * Renders the full test page: the app frame plus a control panel for theme, host focus
 * and the next scan, and a live log of notifications, previews, scans and requests.
 * The returned host is also available as `window.__havenTestHost`.
 */
export function mountHavenTestHost(options: MountHavenTestHostOptions): BrowserTestHost {
  const { container = document.body, title = "Haven test host", ...hostOptions } = options;
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);

  const root = document.createElement("div");
  root.className = "htest";
  const frame = document.createElement("iframe");
  frame.className = "htest__frame";
  frame.title = title;
  frame.dataset.testid = "haven-test-app-frame";
  const panel = document.createElement("aside");
  panel.className = "htest__panel";
  root.append(frame, panel);
  container.replaceChildren(root);
  if (container === document.body) {
    document.body.style.margin = "0";
  }

  let focused = false;
  let dark = false;
  const lists = {
    notifications: document.createElement("ul"),
    previews: document.createElement("ul"),
    scans: document.createElement("ul"),
    requests: document.createElement("ul"),
  };
  const focusState = document.createElement("span");
  focusState.className = "htest__muted";

  function button(label: string, onClick: () => void): HTMLButtonElement {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.addEventListener("click", onClick);
    return node;
  }

  function section(label: string, ...children: HTMLElement[]) {
    const heading = document.createElement("h2");
    heading.textContent = label;
    panel.append(heading, ...children);
  }

  function render() {
    const { log } = testHost;
    focusState.textContent = `focused: ${focused ? "yes" : "no"} · requests: ${log.focusRequests}`;
    lists.notifications.replaceChildren(
      ...log.notifications.map((entry) => item(`[${entry.severity ?? "?"}] ${entry.text ?? ""}`)),
    );
    lists.previews.replaceChildren(
      ...log.previews.map((entry) => item(`${entry.attachmentName} (${entry.databaseId}/${entry.docId})`)),
    );
    lists.scans.replaceChildren(...log.scans.map((entry) => item(`${entry.result} → ${entry.docId}`)));
    lists.requests.replaceChildren(...log.requests.slice(-30).reverse().map((entry) => item(entry.method)));
  }

  const testHost = createBrowserTestHost({ ...hostOptions, frame, onChange: render });

  const badge = document.createElement("span");
  badge.className = "htest__badge";
  badge.textContent = "TEST HOST · MOCK DATA";
  const heading = document.createElement("h1");
  heading.textContent = title;
  panel.append(badge, heading);

  const hostRow = document.createElement("div");
  hostRow.className = "htest__row";
  hostRow.append(
    button("Toggle theme", () => {
      dark = !dark;
      testHost.setTheme({ mode: dark ? "dark" : "light", preset: "mindoo" });
    }),
    button("Toggle focus", () => {
      focused = !focused;
      testHost.setHostFocus(focused);
    }),
    button("Reload app", () => testHost.reloadApp()),
  );
  section("Host", hostRow, focusState);

  const scanInput = document.createElement("input");
  scanInput.type = "file";
  scanInput.accept = "image/jpeg,image/png,application/pdf";
  scanInput.addEventListener("change", () => {
    const file = scanInput.files?.[0];
    testHost.setNextScan(
      file
        ? {
            fileName: file.name,
            mimeType:
              file.type === "image/png" || file.type === "application/pdf" ? file.type : "image/jpeg",
            size: file.size,
          }
        : null,
    );
  });
  const scanHint = document.createElement("p");
  scanHint.className = "htest__muted";
  scanHint.textContent = "The app's next scan returns this file. Without one it is cancelled.";
  section("Next scan", scanInput, scanHint);
  section("Notifications", lists.notifications);
  section("Previews", lists.previews);
  section("Scans", lists.scans);
  section("Requests (latest first)", lists.requests);

  void testHost.host.session.getLaunchContext().then((context) => {
    dark = context.theme.mode === "dark";
  });
  render();
  window.__havenTestHost = testHost;
  return testHost;
}
