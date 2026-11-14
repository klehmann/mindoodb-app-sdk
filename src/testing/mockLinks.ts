/**
 * `session.links` as the mocks play Haven: links the app creates point at the mock
 * tenant, and `open()` hands a link to the app as if the user opened it (held until
 * the app listens, like Haven does).
 *
 * @module mockLinks
 */
import { MINDOODB_APP_LINK_TARGET_MAX, parseMindooDBAppLink } from "../client/links";
import type {
  MindooDBAppBridgePortMessage,
  MindooDBAppLink,
  MindooDBAppLinkInput,
  MindooDBAppLinkOpened,
  MindooDBAppLinkOpenedHandler,
  MindooDBAppLinkOpenResult,
  MindooDBAppLinkParts,
  MindooDBAppLinksApi,
} from "../types";

/** The origin Haven puts in front of every link it creates. */
export const MOCK_HAVEN_LINK_ORIGIN = "https://haven.mindoodb.com";
/** The tenant id the mocks use when the launch context names none. */
export const MOCK_LINK_TENANT_ID = "t_mocktenant";

export interface MockCreatedLink extends MindooDBAppLink {
  input: MindooDBAppLinkInput;
}

export interface MockLinksController {
  /** As if the user opened a link to this app: delivered to `session.links.onOpened`. */
  open(link: MindooDBAppLinkOpened): void;
  /** Every link the app created (`session.links.create`), oldest first. */
  created(): MockCreatedLink[];
  /** Every link the app asked Haven to open (`session.links.open`), oldest first. */
  openRequests(): MindooDBAppLinkParts[];
  /**
   * What `session.links.open` answers for links to OTHER apps or tenants (default
   * `opened`). Links to this app in the mock tenant are delivered to its own
   * `onOpened`, as Haven does.
   */
  answerOpen(status: MindooDBAppLinkOpenResult["status"]): void;
}

/** `https://…/open/<tenant>/<app>/<database>/<doc>#<target>`, each part encoded. */
export function mockLinkUrl(parts: { tenantId: string; appId: string; databaseId: string; docId: string; target?: string }) {
  const path = [parts.tenantId, parts.appId, parts.databaseId, parts.docId].map(encodeURIComponent).join("/");
  const fragment = parts.target ? `#${encodeURI(parts.target).replace(/#/g, "%23")}` : "";
  return `${MOCK_HAVEN_LINK_ORIGIN}/open/${path}${fragment}`;
}

export function createMockLinks(options: {
  appId: () => string;
  tenantId: () => string | undefined;
  hasDatabase: (databaseId: string) => boolean;
}) {
  const created: MockCreatedLink[] = [];
  const pending: MindooDBAppLinkOpened[] = [];
  let handler: MindooDBAppLinkOpenedHandler | null = null;
  let post: ((message: MindooDBAppBridgePortMessage) => boolean) | null = null;

  function create(input: MindooDBAppLinkInput): MindooDBAppLink {
    if (!input?.databaseId || !input.docId) throw Object.assign(new Error("links.create needs a databaseId and a docId."), { name: "invalid-params" });
    if (!options.hasDatabase(input.databaseId)) {
      throw Object.assign(new Error(`The app maps no database "${input.databaseId}".`), { name: "database-not-found" });
    }
    if (input.target !== undefined && (typeof input.target !== "string" || input.target.length > MINDOODB_APP_LINK_TARGET_MAX)) {
      throw Object.assign(new Error(`A link target is at most ${MINDOODB_APP_LINK_TARGET_MAX} characters.`), { name: "invalid-params" });
    }
    const url = mockLinkUrl({ tenantId: options.tenantId() || MOCK_LINK_TENANT_ID, appId: options.appId(), ...input });
    const title = input.title?.trim();
    const link = { url, markdown: title ? `[${title.replace(/[[\]\\]/g, "\\$&")}](${url})` : url };
    created.push({ ...link, input: { ...input } });
    return link;
  }

  const openRequests: MindooDBAppLinkParts[] = [];
  let foreignAnswer: MindooDBAppLinkOpenResult["status"] = "opened";

  function open(url: string): MindooDBAppLinkOpenResult {
    const parts = parseMindooDBAppLink(url);
    if (!parts) return { status: "invalid" };
    openRequests.push(parts);
    const own = parts.appId === options.appId() && parts.tenantId === (options.tenantId() || MOCK_LINK_TENANT_ID);
    if (!own) return { status: foreignAnswer };
    if (!options.hasDatabase(parts.databaseId)) return { status: "noDatabase" };
    deliver({ databaseId: parts.databaseId, docId: parts.docId, ...(parts.target ? { target: parts.target } : {}) });
    return { status: "opened" };
  }

  function flush() {
    for (const opened of pending.splice(0)) deliver(opened);
  }

  function deliver(opened: MindooDBAppLinkOpened) {
    if (handler) void Promise.resolve(handler(opened)).catch(() => undefined);
    else if (!post?.({ protocol: "mindoodb-app-bridge", kind: "link-opened", link: opened })) pending.push(opened);
  }

  /** Level 1: the mock session's own `session.links`. */
  const api: MindooDBAppLinksApi = {
    async create(input) {
      return create(input);
    },
    onOpened(next) {
      handler = next;
      flush();
      return () => {
        if (handler === next) handler = null;
      };
    },
    parse: parseMindooDBAppLink,
    async open(url) {
      return open(url);
    },
  };

  /** Level 2: the fake host's `links.*` requests; `send` reaches the app's port. */
  async function dispatch(method: string, params: unknown, send: (message: MindooDBAppBridgePortMessage) => boolean) {
    switch (method) {
      case "links.create":
        return { result: create((params ?? {}) as MindooDBAppLinkInput) };
      case "links.open":
        return { result: open(String((params as { url?: unknown } | null)?.url ?? "")) };
      case "links.subscribe":
        post = send;
        flush();
        return { result: { ok: true } };
      case "links.unsubscribe":
        post = null;
        return { result: { ok: true } };
      default:
        return undefined;
    }
  }

  const controller: MockLinksController = {
    open(link) {
      deliver({ databaseId: link.databaseId, docId: link.docId, ...(link.target ? { target: link.target } : {}) });
    },
    created: () => created.map((link) => ({ ...link, input: { ...link.input } })),
    openRequests: () => openRequests.map((parts) => ({ ...parts })),
    answerOpen(status) {
      foreignAnswer = status;
    },
  };

  return { api, dispatch, controller, reset: () => (post = null) };
}
