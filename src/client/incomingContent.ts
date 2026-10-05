import type {
  MindooDBAppBridgeIncomingContentMessage,
  MindooDBAppBridgePortMessage,
  MindooDBAppIncomingContent,
  MindooDBAppIncomingContentHandler,
  MindooDBAppIncomingContentInfo,
  MindooDBAppIncomingItem,
  MindooDBAppIncomingItemInfo,
  MindooDBAppIncomingResult,
} from "../types";
import type { PortRpcClient } from "./portRpcClient";

/** Bytes per `incoming.read` round trip. */
export const MINDOODB_APP_INCOMING_READ_CHUNK_BYTES = 1024 * 1024;

function isIncomingContentMessage(
  message: MindooDBAppBridgePortMessage,
): message is MindooDBAppBridgeIncomingContentMessage {
  return message.kind === "incoming-content";
}

function toArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  throw new Error("Haven answered incoming.read without bytes.");
}

/**
 * Receives content the user hands to this app (`session.onIncomingContent`).
 *
 * Haven only sends a delivery after `incoming.subscribe`, so a launch started
 * for a delivery gets it as soon as the app registers its handler. Bytes stay
 * in Haven until an item's `read()`, which pulls them in chunks.
 */
export class MindooDBAppIncomingApiImpl {
  private handler: MindooDBAppIncomingContentHandler | null = null;
  private readonly pending: MindooDBAppIncomingContentInfo[] = [];
  private readonly stopListening: () => void;

  constructor(private readonly rpc: PortRpcClient) {
    this.stopListening = this.rpc.addMessageListener((message) => {
      if (!isIncomingContentMessage(message)) {
        return;
      }
      if (this.handler) {
        void this.deliver(message.content);
      } else {
        this.pending.push(message.content);
      }
    });
  }

  onIncomingContent(handler: MindooDBAppIncomingContentHandler): () => void {
    this.handler = handler;
    void this.rpc.call("incoming.subscribe", {}).catch((error: unknown) => {
      // Older Haven versions do not know the call; nothing will be delivered.
      console.warn("[mindoodb-app-sdk] Haven does not support incoming content.", error);
    });
    const queued = this.pending.splice(0);
    queued.forEach((content) => {
      void this.deliver(content);
    });
    return () => {
      if (this.handler !== handler) {
        return;
      }
      this.handler = null;
      void this.rpc.call("incoming.unsubscribe", {}).catch(() => {});
    };
  }

  dispose() {
    this.stopListening();
    this.handler = null;
    this.pending.length = 0;
  }

  private async deliver(info: MindooDBAppIncomingContentInfo) {
    const handler = this.handler;
    if (!handler) {
      this.pending.push(info);
      return;
    }
    const content: MindooDBAppIncomingContent = {
      deliveryId: info.deliveryId,
      acceptId: info.acceptId,
      source: info.source,
      items: info.items.map((item) => this.toItem(info.deliveryId, item)),
    };
    let result: MindooDBAppIncomingResult;
    try {
      result = (await handler(content)) ?? { status: "accepted" };
    } catch (error) {
      result = { status: "rejected", message: error instanceof Error ? error.message : String(error) };
    }
    await this.rpc
      .call("incoming.complete", {
        deliveryId: info.deliveryId,
        status: result.status,
        message: typeof result.message === "string" ? result.message.slice(0, 500) : undefined,
      })
      .catch((error: unknown) => {
        console.warn("[mindoodb-app-sdk] Could not report an incoming content result.", error);
      });
  }

  private toItem(deliveryId: string, info: MindooDBAppIncomingItemInfo): MindooDBAppIncomingItem {
    const read = async (): Promise<Blob> => {
      if ((info.kind === "text" || info.kind === "url") && typeof info.text === "string") {
        return new Blob([info.text], { type: info.type });
      }
      const chunks: ArrayBuffer[] = [];
      let offset = 0;
      while (offset < info.size) {
        const length = Math.min(MINDOODB_APP_INCOMING_READ_CHUNK_BYTES, info.size - offset);
        const chunk = toArrayBuffer(
          await this.rpc.call<unknown>("incoming.read", { deliveryId, itemId: info.itemId, offset, length }),
        );
        if (chunk.byteLength === 0) {
          break;
        }
        chunks.push(chunk);
        offset += chunk.byteLength;
      }
      return new Blob(chunks, { type: info.type });
    };
    return {
      ...info,
      read,
      readText: async () =>
        (info.kind === "text" || info.kind === "url") && typeof info.text === "string"
          ? info.text
          : await (await read()).text(),
    };
  }
}
