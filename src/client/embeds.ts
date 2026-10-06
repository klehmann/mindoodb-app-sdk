import type {
  MindooDBAppBridgeEmbedEventMessage,
  MindooDBAppBridgePortMessage,
  MindooDBAppComponentInfo,
  MindooDBAppComponentQuery,
  MindooDBAppComponentsApi,
  MindooDBAppEmbed,
  MindooDBAppEmbedClosedEvent,
  MindooDBAppEmbeddingApi,
  MindooDBAppEmbedOpenInput,
  MindooDBAppEmbedRect,
  MindooDBAppEmbedsApi,
} from "../types";
import type { PortRpcClient } from "./portRpcClient";

function isEmbedEventMessage(message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeEmbedEventMessage {
  return message.kind === "embed-event";
}

function toRect(rect: MindooDBAppEmbedRect): MindooDBAppEmbedRect {
  return {
    left: Number(rect.left) || 0,
    top: Number(rect.top) || 0,
    width: Math.max(0, Number(rect.width) || 0),
    height: Math.max(0, Number(rect.height) || 0),
  };
}

/** One component shown inside this app; settles once when Haven reports it closed. */
class MindooDBAppEmbedImpl implements MindooDBAppEmbed {
  public readonly closed: Promise<MindooDBAppEmbedClosedEvent>;
  private resolveClosed!: (event: MindooDBAppEmbedClosedEvent) => void;
  private closedEvent: MindooDBAppEmbedClosedEvent | null = null;
  private readonly listeners = new Set<(event: MindooDBAppEmbedClosedEvent) => void>();

  constructor(
    private readonly rpc: PortRpcClient,
    public readonly embedId: string,
    public readonly componentKey: string,
    public readonly databaseId: string,
    public readonly docId: string,
  ) {
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  async setRect(rect: MindooDBAppEmbedRect) {
    if (this.closedEvent) {
      return;
    }
    await this.rpc.call("embeds.setRect", { embedId: this.embedId, rect: toRect(rect) });
  }

  async setVisible(visible: boolean) {
    if (this.closedEvent) {
      return;
    }
    await this.rpc.call("embeds.setVisible", { embedId: this.embedId, visible: visible === true });
  }

  async close() {
    if (!this.closedEvent) {
      await this.rpc.call("embeds.close", { embedId: this.embedId });
    }
    return await this.closed;
  }

  onClosed(listener: (event: MindooDBAppEmbedClosedEvent) => void) {
    if (this.closedEvent) {
      const event = this.closedEvent;
      queueMicrotask(() => listener(event));
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  settle(event: MindooDBAppEmbedClosedEvent) {
    if (this.closedEvent) {
      return;
    }
    this.closedEvent = event;
    this.resolveClosed(event);
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error("MindooDB embed closed listener failed.", error);
      }
    });
    this.listeners.clear();
  }
}

/**
 * `session.components`, `session.embeds` and `session.embedding`.
 *
 * Haven does all the work: it finds the components, runs the embedded app in a
 * sandbox and positions its frame over the rectangle this app reports. This class
 * only forwards calls and turns `embed-event` pushes into closed events.
 */
export class MindooDBAppEmbedsClient {
  public readonly components: MindooDBAppComponentsApi;
  public readonly embeds: MindooDBAppEmbedsApi;
  public readonly embedding: MindooDBAppEmbeddingApi;
  private readonly open = new Map<string, MindooDBAppEmbedImpl>();
  /** Events that arrived before `embeds.open` resolved with their id. */
  private readonly early = new Map<string, MindooDBAppEmbedClosedEvent>();
  private readonly stopListening: () => void;

  constructor(private readonly rpc: PortRpcClient) {
    this.stopListening = this.rpc.addMessageListener((message) => {
      if (!isEmbedEventMessage(message) || message.event?.type !== "closed") {
        return;
      }
      const { type: _type, ...event } = message.event;
      const embed = this.open.get(event.embedId);
      if (embed) {
        this.open.delete(event.embedId);
        embed.settle(event);
      } else {
        this.early.set(event.embedId, event);
      }
    });
    this.components = {
      list: async (query?: MindooDBAppComponentQuery) => {
        const response = await this.rpc.call<{ components: MindooDBAppComponentInfo[] }>("components.list", {
          query: query ?? {},
        });
        return response?.components ?? [];
      },
    };
    this.embeds = {
      open: async (input: MindooDBAppEmbedOpenInput) => {
        const response = await this.rpc.call<{ embedId: string }>("embeds.open", {
          input: { ...input, rect: toRect(input.rect) },
        });
        const embed = new MindooDBAppEmbedImpl(
          this.rpc,
          response.embedId,
          input.componentKey,
          input.databaseId,
          input.docId,
        );
        const early = this.early.get(embed.embedId);
        if (early) {
          this.early.delete(embed.embedId);
          embed.settle(early);
        } else {
          this.open.set(embed.embedId, embed);
        }
        return embed;
      },
    };
    this.embedding = {
      complete: async (result?: unknown) => {
        await this.rpc.call("embedding.finish", {
          reason: "completed",
          ...(result === undefined ? {} : { result: JSON.parse(JSON.stringify(result)) as unknown }),
        });
      },
      cancel: async (message?: string) => {
        await this.rpc.call("embedding.finish", {
          reason: "cancelled",
          ...(message ? { message: String(message) } : {}),
        });
      },
    };
  }

  dispose() {
    this.stopListening();
  }
}
