import type {
  MindooDBAppBridgeLinkOpenedMessage,
  MindooDBAppBridgePortMessage,
  MindooDBAppLink,
  MindooDBAppLinkCopyResult,
  MindooDBAppLinkInput,
  MindooDBAppLinkOpened,
  MindooDBAppLinkOpenedHandler,
  MindooDBAppLinkOpenResult,
  MindooDBAppLinkParts,
  MindooDBAppLinksApi,
} from "../types";
import type { PortRpcClient } from "./portRpcClient";

/** Longest `target` a link carries. */
export const MINDOODB_APP_LINK_TARGET_MAX = 500;

const LINK_ID_MAX = 200;

function decodeLinkSegment(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw);
    return decoded && decoded.length <= LINK_ID_MAX ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * The parts of `https://<haven>/open/<tenant>/<app>/<database>/<doc>#<target>`, or
 * `null` for any other URL. Pure: it does not say whether the link can be opened.
 */
export function parseMindooDBAppLink(url: string): MindooDBAppLinkParts | null {
  if (typeof url !== "string" || url.length > 4000) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  const segments = parsed.pathname.split("/").filter((segment) => segment !== "");
  const start = segments.lastIndexOf("open");
  // `/open/` may sit below a path prefix of a self-hosted Haven, but ends the path.
  if (start < 0 || segments.length - start !== 5) {
    return null;
  }
  const [tenantId, appId, databaseId, docId] = segments.slice(start + 1).map(decodeLinkSegment);
  if (!tenantId || !appId || !databaseId || !docId) {
    return null;
  }
  let target = parsed.hash.replace(/^#/, "");
  try {
    target = decodeURI(target);
  } catch {
    // keep it as it came
  }
  return {
    tenantId,
    appId,
    databaseId,
    docId,
    ...(target ? { target: target.slice(0, MINDOODB_APP_LINK_TARGET_MAX) } : {}),
  };
}

/** Checked parameters of `links.create` / `links.copy`. */
function linkParams(input: MindooDBAppLinkInput) {
  if (!input || typeof input.databaseId !== "string" || !input.databaseId || typeof input.docId !== "string" || !input.docId) {
    throw new Error("links.create needs a databaseId and a docId.");
  }
  if (input.target !== undefined && (typeof input.target !== "string" || input.target.length > MINDOODB_APP_LINK_TARGET_MAX)) {
    throw new Error(`A link target is a string of at most ${MINDOODB_APP_LINK_TARGET_MAX} characters.`);
  }
  return {
    databaseId: input.databaseId,
    docId: input.docId,
    ...(input.target ? { target: input.target } : {}),
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
  };
}

/** An older Haven without `links.copy`. */
function isUnsupported(error: unknown) {
  const code = error instanceof Error ? error.name || (error as { code?: string }).code : undefined;
  return code === "method-not-found" || code === "unsupported";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * Copies a link from the app's own frame (older Haven): plain text plus an HTML
 * link with the title. Needs the clipboard in this frame, so it may fail.
 */
export async function copyLinkInFrame(url: string, title?: string): Promise<boolean> {
  if (typeof document === "undefined") {
    return false;
  }
  const html = `<a href="${escapeHtml(url)}">${escapeHtml(title?.trim() || url)}</a>`;
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard && typeof clipboard.write === "function" && typeof ClipboardItem !== "undefined") {
    try {
      await clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([url], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return true;
    } catch {
      // fall through
    }
  }
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(url);
      return true;
    } catch {
      // fall through
    }
  }
  const onCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData("text/plain", url);
    event.clipboardData?.setData("text/html", html);
    event.preventDefault();
  };
  const field = document.createElement("textarea");
  field.value = url;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  document.addEventListener("copy", onCopy);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", onCopy);
    field.remove();
  }
}

function isLinkOpenedMessage(message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeLinkOpenedMessage {
  return message.kind === "link-opened";
}

/**
 * `session.links`. Haven delivers opened links only after `links.subscribe`, so
 * a link that started the app waits in Haven until a handler is registered.
 */
export class MindooDBAppLinksApiImpl implements MindooDBAppLinksApi {
  private handler: MindooDBAppLinkOpenedHandler | null = null;
  private readonly pending: MindooDBAppLinkOpened[] = [];
  private readonly stopListening: () => void;

  constructor(private readonly rpc: PortRpcClient) {
    this.stopListening = this.rpc.addMessageListener((message) => {
      if (!isLinkOpenedMessage(message)) {
        return;
      }
      if (this.handler) {
        void this.deliver(message.link);
      } else {
        this.pending.push(message.link);
      }
    });
  }

  async create(input: MindooDBAppLinkInput): Promise<MindooDBAppLink> {
    return await this.rpc.call<MindooDBAppLink>("links.create", linkParams(input));
  }

  async copy(input: MindooDBAppLinkInput): Promise<MindooDBAppLinkCopyResult> {
    const params = linkParams(input);
    try {
      const result = await this.rpc.call<MindooDBAppLinkCopyResult>("links.copy", params);
      if (result && typeof result.url === "string" && (result.status === "copied" || result.status === "shown")) {
        return { url: result.url, markdown: result.markdown, status: result.status };
      }
    } catch (error) {
      // Older Haven versions answer `links.copy` with an unknown-method error;
      // anything else (no such database, a bad target) is the app's to see.
      if (!isUnsupported(error)) {
        throw error;
      }
    }
    const link = await this.create(input);
    const copied = await copyLinkInFrame(link.url, input.title);
    return { ...link, status: copied ? "copiedByApp" : "failed" };
  }

  onOpened(handler: MindooDBAppLinkOpenedHandler): () => void {
    this.handler = handler;
    void this.rpc.call("links.subscribe", {}).catch(() => {
      // Older Haven versions open no links; nothing will be delivered.
    });
    this.pending.splice(0).forEach((opened) => {
      void this.deliver(opened);
    });
    return () => {
      if (this.handler !== handler) {
        return;
      }
      this.handler = null;
      void this.rpc.call("links.unsubscribe", {}).catch(() => {});
    };
  }

  parse(url: string): MindooDBAppLinkParts | null {
    return parseMindooDBAppLink(url);
  }

  async open(url: string): Promise<MindooDBAppLinkOpenResult> {
    if (!parseMindooDBAppLink(url)) {
      return { status: "invalid" };
    }
    try {
      const result = await this.rpc.call<MindooDBAppLinkOpenResult>("links.open", { url: url.trim() });
      if (result && typeof result.status === "string") {
        return { status: result.status };
      }
    } catch {
      // Older Haven versions do not open links for apps: fall through to the browser.
    }
    if (typeof window !== "undefined") {
      window.open(url.trim(), "_blank", "noopener,noreferrer");
    }
    return { status: "external" };
  }

  dispose() {
    this.stopListening();
    this.handler = null;
    this.pending.length = 0;
  }

  private async deliver(opened: MindooDBAppLinkOpened) {
    const handler = this.handler;
    if (!handler) {
      this.pending.push(opened);
      return;
    }
    try {
      await handler(opened);
    } catch (error) {
      console.warn("[mindoodb-app-sdk] A link handler failed.", error);
    }
  }
}
