import type {
  MindooDBAppBridgeLinkOpenedMessage,
  MindooDBAppBridgePortMessage,
  MindooDBAppLink,
  MindooDBAppLinkInput,
  MindooDBAppLinkOpened,
  MindooDBAppLinkOpenedHandler,
  MindooDBAppLinksApi,
} from "../types";
import type { PortRpcClient } from "./portRpcClient";

/** Longest `target` a link carries. */
export const MINDOODB_APP_LINK_TARGET_MAX = 500;

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
    if (!input || typeof input.databaseId !== "string" || !input.databaseId || typeof input.docId !== "string" || !input.docId) {
      throw new Error("links.create needs a databaseId and a docId.");
    }
    if (input.target !== undefined && (typeof input.target !== "string" || input.target.length > MINDOODB_APP_LINK_TARGET_MAX)) {
      throw new Error(`A link target is a string of at most ${MINDOODB_APP_LINK_TARGET_MAX} characters.`);
    }
    return await this.rpc.call<MindooDBAppLink>("links.create", {
      databaseId: input.databaseId,
      docId: input.docId,
      ...(input.target ? { target: input.target } : {}),
      ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    });
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
