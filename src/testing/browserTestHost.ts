import type { MindooDBAppDefinition } from "../appDefinition";
import type {
  MindooDBAppBridgeRpcRequest,
  MindooDBAppCapability,
  MindooDBAppHostTheme,
} from "../types";
import {
  createFakeBridgeHost,
  generateDirectoryUsers,
  type CreateFakeBridgeHostOptions,
  type FakeBridgeHostController,
  type FakeBridgeRpcResponse,
  type MockMindooDBAppDatabaseDefinition,
} from "./index";
import { createMemoryAttachments } from "./memoryAttachments";

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

/**
 * A scan the test host hands out on the app's `attachments.scan()` call. With `bytes`
 * the file is written to the document's attachments, as Haven's scanner does; without,
 * only the attachment info is returned.
 */
export interface BrowserTestHostScan {
  fileName: string;
  mimeType: "image/jpeg" | "image/png" | "application/pdf";
  size?: number;
  bytes?: Uint8Array;
}

/**
 * What a scan returns when no {@link BrowserTestHost.setNextScan} is pending: cancel,
 * a generated sample page, or a fixed file.
 */
export type BrowserTestHostScanMode = "cancel" | "sample" | BrowserTestHostScan;

/** What the test host recorded, in the order the app asked. */
export interface BrowserTestHostLog {
  notifications: Array<{ id?: string; severity?: string; text?: string; durationMs?: number }>;
  previews: Array<{ databaseId: string; docId: string; attachmentName: string }>;
  scans: Array<{
    databaseId: string;
    docId: string;
    result: "scanned" | "cancelled";
    fileName?: string;
    mimeType?: string;
    size?: number;
  }>;
  focusRequests: number;
  requests: MindooDBAppBridgeRpcRequest[];
  /** The answer to each request, by request id (result or error, duration). */
  responses: Record<string, FakeBridgeRpcResponse>;
}

export interface CreateBrowserTestHostOptions extends CreateFakeBridgeHostOptions {
  /** The iframe the app runs in. Its `src` is set by the host. */
  frame: HTMLIFrameElement;
  /** URL of the app page, relative to the test page or absolute. */
  appUrl: string;
  /** What scans return while no `setNextScan()` is pending. Default `"cancel"`. */
  scanMode?: BrowserTestHostScanMode;
  /** Called after every request, e.g. to re-render a control panel. */
  onChange?: () => void;
}

export interface BrowserTestHost {
  host: FakeBridgeHostController;
  log: BrowserTestHostLog;
  /**
   * Decides the outcome of the app's next `attachments.scan()`: a file to "scan", or
   * `null` to act as if the user cancelled. Later scans follow {@link setScanMode}.
   */
  setNextScan(scan: BrowserTestHostScan | null): void;
  /** What scans return while no `setNextScan()` is pending. */
  setScanMode(mode: BrowserTestHostScanMode): void;
  getScanMode(): BrowserTestHostScanMode;
  setTheme(theme: MindooDBAppHostTheme): void;
  setHostFocus(focused: boolean): void;
  /** Haven's language changed: the app gets `onLocaleChange`, no reload. */
  setLocale(locale: string): void;
  /**
   * Grants a mapped database these capabilities and reloads the app, like Haven
   * relaunching it after a permission change.
   */
  setCapabilities(databaseId: string, capabilities: MindooDBAppCapability[]): void;
  /** Turns the capability checks on or off (`enforceCapabilities`). */
  setEnforceCapabilities(enforce: boolean): void;
  /** Replaces the usernames of the tenant directory (`directory.listUsers()`). */
  setDirectoryUsers(users: readonly string[]): void;
  /** Reloads the app frame. The mock data survives; the app's in-memory state does not. */
  reloadApp(): void;
  dispose(): void;
}

/** Every capability Haven can grant, in the order the panel lists them. */
export const ALL_CAPABILITIES: readonly MindooDBAppCapability[] = [
  "read",
  "create",
  "update",
  "delete",
  "history",
  "attachments",
  "views",
  "directory",
  "sign",
  "timestamps",
  "sealedchannel",
];

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

/** Changes to one database of a definition, for testing other mappings than requested. */
export interface MockDatabaseOverride {
  title?: string;
  /** Grant exactly these instead of what the definition requests. */
  capabilities?: MindooDBAppCapability[];
  /** `false`: the user did not map this database to the app. */
  mapped?: boolean;
}

export interface MockDatabasesFromDefinitionOptions {
  /** By logical database id. */
  overrides?: Record<string, MockDatabaseOverride>;
  /**
   * `"memory"` (default): attachments the app writes can be listed and read back.
   * `"none"`: the mock's stateless default.
   */
  attachments?: "memory" | "none";
}

/**
 * Mock databases for every database a `haven-app.json` declares, granted as requested
 * unless `options.overrides` says otherwise.
 */
export function mockDatabasesFromDefinition(
  definition: Pick<MindooDBAppDefinition, "databases">,
  seed: Record<string, MockMindooDBAppDatabaseDefinition["documents"]> = {},
  options: MockDatabasesFromDefinitionOptions = {},
): MockMindooDBAppDatabaseDefinition[] {
  return (definition.databases ?? [])
    .filter((database) => options.overrides?.[database.logicalDatabaseId]?.mapped !== false)
    .map((database) => {
      const override = options.overrides?.[database.logicalDatabaseId];
      return {
        info: {
          id: database.logicalDatabaseId,
          title: override?.title ?? database.label ?? database.logicalDatabaseId,
          capabilities: override?.capabilities
            ? [...new Set<MindooDBAppCapability>(override.capabilities)]
            : capabilitiesForDefinitionPermissions(database.permissions),
        },
        documents: seed[database.logicalDatabaseId],
        ...(options.attachments === "none"
          ? {}
          : { methods: { attachments: createMemoryAttachments() } }),
      };
    });
}

/**
 * Test-host settings from the page URL, so a scenario can be linked or scripted:
 *
 * - `db=<id>:<capability>,<capability>` grants exactly these; `db=<id>:none` unmaps it
 * - `enforce=1` turns the capability checks on
 * - `users=<count>` fills the directory with generated users
 * - `locale=<tag>`, `theme=dark|light`
 */
export interface TestHostUrlSettings {
  overrides: Record<string, MockDatabaseOverride>;
  enforceCapabilities?: boolean;
  directoryUserCount?: number;
  locale?: string;
  theme?: "dark" | "light";
}

export function readTestHostUrlSettings(search: string): TestHostUrlSettings {
  const params = new URLSearchParams(search);
  const settings: TestHostUrlSettings = { overrides: {} };
  for (const entry of params.getAll("db")) {
    const separator = entry.indexOf(":");
    if (separator <= 0) continue;
    const id = entry.slice(0, separator);
    const list = entry.slice(separator + 1);
    settings.overrides[id] =
      list === "none"
        ? { mapped: false }
        : {
            capabilities: list
              .split(",")
              .map((capability) => capability.trim())
              .filter((capability): capability is MindooDBAppCapability =>
                (ALL_CAPABILITIES as readonly string[]).includes(capability),
              ),
          };
  }
  const enforce = params.get("enforce");
  if (enforce !== null) settings.enforceCapabilities = enforce === "1" || enforce === "true";
  const users = Number.parseInt(params.get("users") ?? "", 10);
  if (Number.isFinite(users) && users >= 0) settings.directoryUserCount = users;
  const locale = params.get("locale");
  if (locale) settings.locale = locale;
  const theme = params.get("theme");
  if (theme === "dark" || theme === "light") settings.theme = theme;
  return settings;
}

function withLaunchId(appUrl: string, launchId: string): string {
  const url = new URL(appUrl, window.location.href);
  url.searchParams.set("mindoodbAppLaunchId", launchId);
  return url.toString();
}

/** A 1×1 grey PNG, for environments without a canvas. */
const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN4+O7dfwAJYgPUBHcDcgAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

/** A generated "scanned page": paper, a heading, lines of text and a stamp. */
async function sampleScan(): Promise<BrowserTestHostScan> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 900;
  const g = typeof canvas.toBlob === "function" ? canvas.getContext("2d") : null;
  if (!g) {
    return { fileName: "sample-scan.png", mimeType: "image/png", bytes: TINY_PNG };
  }
  g.fillStyle = "#f4f1ea";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#1f2a44";
  g.font = "bold 64px sans-serif";
  g.fillText("Scanned page", 90, 150);
  g.fillStyle = "#8a93a6";
  for (let line = 0; line < 9; line += 1) {
    g.fillRect(90, 240 + line * 60, line % 3 === 2 ? 620 : 1020, 18);
  }
  g.strokeStyle = "#c0392b";
  g.lineWidth = 8;
  g.beginPath();
  g.arc(960, 740, 110, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#c0392b";
  g.font = "bold 40px sans-serif";
  g.fillText("TEST", 910, 755);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) {
    return { fileName: "sample-scan.png", mimeType: "image/png", bytes: TINY_PNG };
  }
  return {
    fileName: "sample-scan.jpg",
    mimeType: "image/jpeg",
    bytes: new Uint8Array(await blob.arrayBuffer()),
  };
}

export function createBrowserTestHost(options: CreateBrowserTestHostOptions): BrowserTestHost {
  const { frame, appUrl, onChange, scanMode: initialScanMode, ...hostOptions } = options;
  let nextScan: BrowserTestHostScan | null | undefined;
  let scanMode: BrowserTestHostScanMode = initialScanMode ?? "cancel";
  let scanCounter = 0;
  const log: BrowserTestHostLog = {
    notifications: [],
    previews: [],
    scans: [],
    focusRequests: 0,
    requests: [],
    responses: {},
  };
  const changed = () => queueMicrotask(() => onChange?.());

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
      changed();
    },
    onResponse(request, response) {
      log.responses[request.id] = response;
      hostOptions.onResponse?.(request, response);
      changed();
    },
    requestHandlers: {
      "attachments.scanAndWrite": async (params, { host: controller }) => {
        const input = (params ?? {}) as Record<string, unknown>;
        const databaseId = String(input.databaseId);
        const docId = String(input.docId);
        if (controller.getEnforceCapabilities()) {
          const info = controller.listDatabases().find((entry) => entry.id === databaseId);
          const missing = (["attachments", "update"] as const).find(
            (capability) => !info?.capabilities.includes(capability),
          );
          if (missing) {
            const error = new Error(
              `Database "${databaseId}" was not granted the "${missing}" capability (attachments.scan)`,
            );
            error.name = "forbidden";
            throw error;
          }
        }
        const pending = nextScan;
        nextScan = undefined;
        const mode = pending === undefined ? scanMode : pending;
        const scan =
          mode === null || mode === "cancel" ? null : mode === "sample" ? await sampleScan() : mode;
        if (!scan) {
          log.scans.push({ databaseId, docId, result: "cancelled" });
          return { ok: false };
        }
        scanCounter += 1;
        const fileName =
          mode === "sample" && typeof input.defaultFileName === "string"
            ? input.defaultFileName
            : scan.fileName;
        if (scan.bytes) {
          const database = await controller.session.openDatabase(databaseId);
          const writer = await database.attachments.openWriteStream(docId, fileName, scan.mimeType);
          await writer.write(scan.bytes);
          await writer.close();
        }
        const size = scan.bytes?.length ?? scan.size ?? 0;
        log.scans.push({ databaseId, docId, result: "scanned", fileName, mimeType: scan.mimeType, size });
        return {
          ok: true,
          attachment: {
            attachmentId: `test-scan-${scanCounter}`,
            fileName,
            mimeType: scan.mimeType,
            size,
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

  const reloadApp = () => {
    frame.src = withLaunchId(appUrl, host.launchId);
  };

  return {
    host,
    log,
    setNextScan(scan) {
      nextScan = scan;
    },
    setScanMode(mode) {
      scanMode = mode;
    },
    getScanMode: () => scanMode,
    setTheme(theme) {
      host.emitThemeChange(theme);
      onChange?.();
    },
    setHostFocus(focused) {
      host.emitHostFocusChange(focused);
      onChange?.();
    },
    setLocale(locale) {
      host.emitLocaleChange(locale);
      onChange?.();
    },
    setCapabilities(databaseId, capabilities) {
      host.setCapabilities(databaseId, capabilities);
      reloadApp();
      onChange?.();
    },
    setEnforceCapabilities(enforce) {
      host.setEnforceCapabilities(enforce);
      onChange?.();
    },
    setDirectoryUsers(users) {
      host.setDirectoryUsers(users);
      onChange?.();
    },
    reloadApp,
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
  /** Locales offered in the panel's language switcher. */
  locales?: ReadonlyArray<{ tag: string; label: string }>;
  /**
   * Read `db=`, `enforce=`, `users=`, `locale=` and `theme=` from the page URL (see
   * {@link readTestHostUrlSettings}) and keep the URL in sync with the panel. Default
   * true. URL settings win over the options passed here.
   */
  urlSettings?: boolean;
}

/** The locales Haven's UI offers; the default of the panel's language switcher. */
export const TEST_HOST_LOCALES: ReadonlyArray<{ tag: string; label: string }> = [
  { tag: "en-US", label: "English" },
  { tag: "de-DE", label: "Deutsch" },
  { tag: "fr-FR", label: "Français" },
  { tag: "es-ES", label: "Español" },
  { tag: "it-IT", label: "Italiano" },
  { tag: "pt-BR", label: "Português" },
  { tag: "nl-NL", label: "Nederlands" },
  { tag: "pl-PL", label: "Polski" },
  { tag: "cs-CZ", label: "Čeština" },
  { tag: "ru-RU", label: "Русский" },
  { tag: "zh-CN", label: "简体中文" },
  { tag: "zh-TW", label: "繁體中文" },
  { tag: "ja-JP", label: "日本語" },
  { tag: "ko-KR", label: "한국어" },
  { tag: "th-TH", label: "ไทย" },
  { tag: "vi-VN", label: "Tiếng Việt" },
  { tag: "id-ID", label: "Bahasa Indonesia" },
  { tag: "ms-MY", label: "Bahasa Melayu" },
  { tag: "hi-IN", label: "हिन्दी" },
  { tag: "ar-SA", label: "العربية" },
  { tag: "he-IL", label: "עברית" },
];

const DIRECTORY_SIZES = [0, 5, 25, 120, 500];

declare global {
  interface Window {
    /** Set by {@link mountHavenTestHost} so Playwright can script the host. */
    __havenTestHost?: BrowserTestHost;
  }
}

const STYLE = `
.htest{display:grid;grid-template-columns:minmax(0,1fr) 320px;height:100vh;margin:0;font:13px/1.45 system-ui,sans-serif;background:#eef1f7;color:#172033}
.htest *{box-sizing:border-box}
.htest__frame{width:100%;height:100%;border:0;background:#fff}
.htest__panel{border-left:1px solid #d7dce8;overflow:auto;padding:14px;background:#f8f9fc}
.htest__badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#fde68a;color:#713f12;font-weight:600;font-size:11px;letter-spacing:.04em}
.htest h1{font-size:15px;margin:8px 0 12px}
.htest h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#5b6478;margin:16px 0 6px}
.htest h3{font-size:12px;margin:10px 0 4px}
.htest__row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.htest button,.htest select{font:inherit;padding:5px 9px;border-radius:7px;border:1px solid #c9d0e0;background:#fff;cursor:pointer;max-width:100%}
.htest ul{list-style:none;margin:0;padding:0}
.htest li{padding:5px 0;border-bottom:1px solid #e4e8f1;word-break:break-word}
.htest__muted{color:#5b6478}
.htest__caps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 8px}
.htest__caps label,.htest__check{display:flex;gap:5px;align-items:center}
.htest details summary{cursor:pointer;display:flex;gap:6px;align-items:baseline}
.htest details summary::-webkit-details-marker{display:none}
.htest details summary::before{content:"▸";color:#8a93a6}
.htest details[open] summary::before{content:"▾"}
.htest__meta{margin-left:auto;color:#5b6478;font-size:11px;white-space:nowrap}
.htest__error{color:#b42318}
.htest pre{margin:4px 0 2px;padding:6px 8px;background:#fff;border:1px solid #e4e8f1;border-radius:6px;font:11px/1.4 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all;max-height:260px;overflow:auto}
@media (max-width:720px){.htest{grid-template-columns:1fr;grid-template-rows:65vh auto}.htest__panel{border-left:0;border-top:1px solid #d7dce8}}
`;

/**
 * JSON for the request log: binary as size plus a hex preview, long strings and arrays
 * cut, deep objects summarized.
 */
export function previewJson(value: unknown, maxString = 400, maxItems = 30, maxDepth = 6): string {
  const seen = new WeakSet<object>();
  const walk = (entry: unknown, depth: number): unknown => {
    if (entry instanceof Uint8Array || entry instanceof ArrayBuffer) {
      const bytes = entry instanceof ArrayBuffer ? new Uint8Array(entry) : entry;
      const hex = Array.from(bytes.subarray(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join(" ");
      return `<${bytes.length} bytes${bytes.length ? `: ${hex}${bytes.length > 16 ? " …" : ""}` : ""}>`;
    }
    if (typeof entry === "string") {
      return entry.length > maxString ? `${entry.slice(0, maxString)}… (${entry.length} chars)` : entry;
    }
    if (entry === null || typeof entry !== "object") return entry;
    if (seen.has(entry)) return "<circular>";
    if (depth >= maxDepth) return Array.isArray(entry) ? `<array(${entry.length})>` : "<object>";
    seen.add(entry);
    if (Array.isArray(entry)) {
      const items = entry.slice(0, maxItems).map((child) => walk(child, depth + 1));
      if (entry.length > maxItems) items.push(`… ${entry.length - maxItems} more`);
      return items;
    }
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(entry)) result[key] = walk(child, depth + 1);
    return result;
  };
  try {
    return JSON.stringify(walk(value, 0), null, 2) ?? "undefined";
  } catch {
    return String(value);
  }
}

function item(text: string): HTMLLIElement {
  const li = document.createElement("li");
  li.textContent = text;
  return li;
}

/**
 * Renders the full test page: the app frame plus a control panel — theme, host focus,
 * language, capabilities per database, directory users, the scanner — and a live log
 * of notifications, previews, scans and requests (click an entry for details).
 * The returned host is also available as `window.__havenTestHost`.
 */
export function mountHavenTestHost(options: MountHavenTestHostOptions): BrowserTestHost {
  const {
    container = document.body,
    title = "Haven test host",
    locales = TEST_HOST_LOCALES,
    urlSettings: useUrl = true,
    ...hostOptions
  } = options;

  const url = useUrl ? readTestHostUrlSettings(window.location.search) : { overrides: {} };
  const databases = (hostOptions.databases ?? [])
    .filter((database) => url.overrides[database.info.id]?.mapped !== false)
    .map((database) => {
      const capabilities = url.overrides[database.info.id]?.capabilities;
      return capabilities ? { ...database, info: { ...database.info, capabilities } } : database;
    });
  const launchContext = {
    ...hostOptions.launchContext,
    ...(url.locale ? { locale: url.locale } : {}),
    ...(url.theme ? { theme: { mode: url.theme, preset: "mindoo" } as MindooDBAppHostTheme } : {}),
  };

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
  let dark = url.theme === "dark";
  // the launch context's theme; only a different one goes into the URL
  let initialDark: boolean | undefined = url.theme ? undefined : false;
  const openRequests = new Set<string>();
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

  function hint(text: string): HTMLParagraphElement {
    const node = document.createElement("p");
    node.className = "htest__muted";
    node.textContent = text;
    return node;
  }

  function section(label: string, ...children: HTMLElement[]) {
    const heading = document.createElement("h2");
    heading.textContent = label;
    panel.append(heading, ...children);
  }

  /** Keeps the page URL in step with the panel, so the scenario can be linked. */
  function syncUrl() {
    if (!useUrl) return;
    const params = new URLSearchParams(window.location.search);
    for (const key of ["db", "enforce", "users", "locale", "theme"]) params.delete(key);
    const initial = new Map((hostOptions.databases ?? []).map((database) => [database.info.id, database]));
    for (const info of testHost.host.listDatabases()) {
      const requested = initial.get(info.id)?.info.capabilities ?? [];
      const same =
        requested.length === info.capabilities.length &&
        requested.every((capability) => info.capabilities.includes(capability));
      if (!same) params.append("db", `${info.id}:${info.capabilities.join(",")}`);
    }
    for (const [id, override] of Object.entries(url.overrides)) {
      if (override.mapped === false) params.append("db", `${id}:none`);
    }
    if (testHost.host.getEnforceCapabilities()) params.set("enforce", "1");
    const users = testHost.host.getDirectoryUsers().length;
    if (users) params.set("users", String(users));
    if (currentLocale) params.set("locale", currentLocale);
    if (initialDark === undefined || dark !== initialDark) params.set("theme", dark ? "dark" : "light");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }

  function requestEntry(request: MindooDBAppBridgeRpcRequest): HTMLLIElement {
    const li = document.createElement("li");
    const details = document.createElement("details");
    const response = testHost.log.responses[request.id];
    const params = (request.params ?? {}) as Record<string, unknown>;
    const summary = document.createElement("summary");
    const method = document.createElement("span");
    method.textContent = request.method;
    if (response && !response.ok) method.className = "htest__error";
    const meta = document.createElement("span");
    meta.className = "htest__meta";
    meta.textContent = [
      typeof params.databaseId === "string" ? params.databaseId : null,
      response ? `${response.durationMs.toFixed(1)} ms` : "…",
    ]
      .filter(Boolean)
      .join(" · ");
    summary.append(method, meta);
    details.append(summary);
    // the body is built when opened: the log re-renders on every request
    const fill = () => {
      if (details.childElementCount > 1) return;
      const body = document.createElement("div");
      const label = (text: string) => {
        const node = document.createElement("div");
        node.className = "htest__muted";
        node.textContent = text;
        return node;
      };
      const pre = (text: string, error = false) => {
        const node = document.createElement("pre");
        node.textContent = text;
        if (error) node.className = "htest__error";
        return node;
      };
      body.append(label("params"), pre(previewJson(request.params ?? null)));
      if (!response) body.append(label("pending"));
      else if (response.ok) body.append(label("result"), pre(previewJson(response.result)));
      else body.append(label("error"), pre(`${response.error.code}: ${response.error.message}`, true));
      details.append(body);
    };
    details.addEventListener("toggle", () => {
      if (details.open) {
        openRequests.add(request.id);
        fill();
      } else {
        openRequests.delete(request.id);
      }
    });
    if (openRequests.has(request.id)) {
      details.open = true;
      fill();
    }
    li.append(details);
    return li;
  }

  function scanEntry(entry: BrowserTestHostLog["scans"][number]): HTMLLIElement {
    const li = document.createElement("li");
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `${entry.result} → ${entry.docId}`;
    const pre = document.createElement("pre");
    pre.textContent = previewJson(entry);
    details.append(summary, pre);
    li.append(details);
    return li;
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
    lists.scans.replaceChildren(...log.scans.map(scanEntry));
    lists.requests.replaceChildren(...log.requests.slice(-50).reverse().map(requestEntry));
  }

  const testHost = createBrowserTestHost({
    ...hostOptions,
    databases,
    launchContext,
    enforceCapabilities: url.enforceCapabilities ?? hostOptions.enforceCapabilities,
    directoryUsers:
      url.directoryUserCount !== undefined
        ? generateDirectoryUsers(url.directoryUserCount)
        : hostOptions.directoryUsers,
    frame,
    onChange: render,
  });
  // the locale goes into the URL once it came from there or the panel changed it
  let currentLocale: string | undefined = url.locale;

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
      syncUrl();
    }),
    button("Toggle focus", () => {
      focused = !focused;
      testHost.setHostFocus(focused);
    }),
    button("Reload app", () => testHost.reloadApp()),
  );
  section("Host", hostRow, focusState);

  // Language: Haven's locale changes live, the app gets onLocaleChange
  const language = document.createElement("select");
  language.dataset.testid = "haven-test-language";
  language.setAttribute("aria-label", "Language");
  for (const { tag, label } of locales) language.add(new Option(`${label} (${tag})`, tag));
  void testHost.host.session.getLaunchContext().then((context) => {
    if (![...language.options].some((option) => option.value === context.locale)) {
      language.add(new Option(context.locale, context.locale), 0);
    }
    language.value = context.locale;
    dark = context.theme.mode === "dark";
    if (!url.theme) initialDark = dark;
  });
  language.addEventListener("change", () => {
    currentLocale = language.value;
    testHost.setLocale(language.value);
    syncUrl();
  });
  section("Language", language, hint("Haven's locale; the app switches without a reload."));

  // Capabilities per mapped database
  const enforce = document.createElement("label");
  enforce.className = "htest__check";
  const enforceBox = document.createElement("input");
  enforceBox.type = "checkbox";
  enforceBox.dataset.testid = "haven-test-enforce";
  enforceBox.checked = testHost.host.getEnforceCapabilities();
  enforceBox.addEventListener("change", () => {
    testHost.setEnforceCapabilities(enforceBox.checked);
    syncUrl();
  });
  enforce.append(enforceBox, "Enforce capabilities (reject calls not granted)");
  const databaseBlocks = testHost.host.listDatabases().map((info) => {
    const block = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = info.title === info.id ? info.id : `${info.title} (${info.id})`;
    const grid = document.createElement("div");
    grid.className = "htest__caps";
    const boxes = new Map<MindooDBAppCapability, HTMLInputElement>();
    for (const capability of ALL_CAPABILITIES) {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = info.capabilities.includes(capability);
      box.dataset.testid = `haven-test-cap-${info.id}-${capability}`;
      box.addEventListener("change", () => {
        const granted = ALL_CAPABILITIES.filter((entry) => boxes.get(entry)?.checked);
        testHost.setCapabilities(info.id, granted);
        syncUrl();
      });
      boxes.set(capability, box);
      label.append(box, capability);
      grid.append(label);
    }
    block.append(name, grid);
    return block;
  });
  section(
    "Databases",
    enforce,
    ...databaseBlocks,
    hint("Changing a capability relaunches the app. Unmap a database with ?db=<id>:none in the URL."),
  );

  // Directory users
  const directory = document.createElement("select");
  directory.dataset.testid = "haven-test-directory";
  directory.setAttribute("aria-label", "Directory users");
  const userCount = testHost.host.getDirectoryUsers().length;
  const sizes = DIRECTORY_SIZES.includes(userCount) ? DIRECTORY_SIZES : [...DIRECTORY_SIZES, userCount];
  for (const size of sizes.sort((a, b) => a - b)) {
    directory.add(new Option(size === userCount && !DIRECTORY_SIZES.includes(size) ? `${size} (custom)` : `${size} users`, String(size)));
  }
  directory.value = String(userCount);
  directory.addEventListener("change", () => {
    testHost.setDirectoryUsers(generateDirectoryUsers(Number(directory.value)));
    syncUrl();
  });
  section("Directory", directory, hint("Usernames directory.listUsers() returns, e.g. to test paging."));

  // Scanner
  const scan = document.createElement("select");
  scan.dataset.testid = "haven-test-scan-mode";
  scan.setAttribute("aria-label", "Scanner result");
  scan.add(new Option("Cancel the scan", "cancel"));
  scan.add(new Option("Sample image", "sample"));
  scan.add(new Option("Chosen file", "file"));
  const scanInput = document.createElement("input");
  scanInput.type = "file";
  scanInput.accept = "image/jpeg,image/png,application/pdf";
  const initialMode = testHost.getScanMode();
  scan.value = typeof initialMode === "string" ? initialMode : "file";
  scanInput.hidden = scan.value !== "file";
  const applyScanMode = async () => {
    scanInput.hidden = scan.value !== "file";
    if (scan.value !== "file") {
      testHost.setScanMode(scan.value as "cancel" | "sample");
      return;
    }
    const file = scanInput.files?.[0];
    testHost.setScanMode(
      file
        ? {
            fileName: file.name,
            mimeType:
              file.type === "image/png" || file.type === "application/pdf" ? file.type : "image/jpeg",
            bytes: new Uint8Array(await file.arrayBuffer()),
          }
        : "cancel",
    );
  };
  scan.addEventListener("change", () => void applyScanMode());
  scanInput.addEventListener("change", () => void applyScanMode());
  section(
    "Scanner",
    scan,
    scanInput,
    hint("What attachments.scan() returns; the file is attached to the document like in Haven."),
  );

  section("Notifications", lists.notifications);
  section("Previews", lists.previews);
  section("Scans", lists.scans);
  section("Requests (latest first, click for details)", lists.requests);

  render();
  syncUrl();
  window.__havenTestHost = testHost;
  return testHost;
}
