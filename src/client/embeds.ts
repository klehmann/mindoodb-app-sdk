import type {
  MindooDBAppBridgeEmbedEventMessage,
  MindooDBAppBridgeEmbeddingRequestMessage,
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

function isEmbeddingRequestMessage(
  message: MindooDBAppBridgePortMessage,
): message is MindooDBAppBridgeEmbeddingRequestMessage {
  return message.kind === "embedding-request";
}

function toRect(rect: MindooDBAppEmbedRect): MindooDBAppEmbedRect {
  return {
    left: Number(rect.left) || 0,
    top: Number(rect.top) || 0,
    width: Math.max(0, Number(rect.width) || 0),
    height: Math.max(0, Number(rect.height) || 0),
  };
}

/** A component's rectangle: the container's, in this app's viewport. */
function containerRect(container: HTMLElement): MindooDBAppEmbedRect {
  const bounds = container.getBoundingClientRect();
  return toRect({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height });
}

/** What Haven answers to `embeds.open`; older Havens send only the id. */
interface EmbedOpenResponse {
  embedId: string;
  frame?: { url: string; allow?: string };
}

/**
 * Reports the container's rectangle whenever it may have moved: Haven needs it to
 * lay an overlay over the container and, with `frame` placement, to position
 * menus and drag feedback of the component.
 */
class ContainerTracker {
  private frameRequest: number | null = null;
  private readonly observer: ResizeObserver | null;
  private readonly schedule = () => {
    if (this.frameRequest !== null) {
      return;
    }
    this.frameRequest = window.requestAnimationFrame(() => {
      this.frameRequest = null;
      this.report(containerRect(this.container));
    });
  };

  constructor(
    private readonly container: HTMLElement,
    private readonly report: (rect: MindooDBAppEmbedRect) => void,
  ) {
    this.observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(this.schedule);
    this.observer?.observe(container);
    window.addEventListener("resize", this.schedule);
    window.addEventListener("scroll", this.schedule, true);
  }

  dispose() {
    this.observer?.disconnect();
    window.removeEventListener("resize", this.schedule);
    window.removeEventListener("scroll", this.schedule, true);
    if (this.frameRequest !== null) {
      window.cancelAnimationFrame(this.frameRequest);
    }
  }
}

/**
 * The frame for `frame` placement. It loads Haven's relay page, which frames the
 * component; this app never sees the component's document or its connection.
 */
function createComponentFrame(container: HTMLElement, url: string, allow: string | undefined) {
  const frame = container.ownerDocument.createElement("iframe");
  frame.src = url;
  if (allow) {
    frame.setAttribute("allow", allow);
  }
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  frame.dataset.mindoodbEmbed = "";
  Object.assign(frame.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    border: "0",
    display: "block",
  });
  container.appendChild(frame);
  return frame;
}

/** One component shown inside this app; settles once when Haven reports it closed. */
class MindooDBAppEmbedImpl implements MindooDBAppEmbed {
  public readonly closed: Promise<MindooDBAppEmbedClosedEvent>;
  private resolveClosed!: (event: MindooDBAppEmbedClosedEvent) => void;
  private closedEvent: MindooDBAppEmbedClosedEvent | null = null;
  private readonly listeners = new Set<(event: MindooDBAppEmbedClosedEvent) => void>();
  private readonly dirtyListeners = new Set<(dirty: boolean) => void>();
  private dirtyState: boolean | undefined = undefined;
  private tracker: ContainerTracker | null = null;

  constructor(
    private readonly rpc: PortRpcClient,
    public readonly embedId: string,
    public readonly componentKey: string,
    public readonly databaseId: string,
    public readonly docId: string,
    public readonly frame: HTMLIFrameElement | null,
    container: HTMLElement | undefined,
  ) {
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    if (container) {
      this.tracker = new ContainerTracker(container, (rect) => {
        void this.setRect(rect).catch(() => {});
      });
    }
  }

  get placement(): "frame" | "overlay" {
    return this.frame ? "frame" : "overlay";
  }

  get dirty() {
    return this.dirtyState;
  }

  onDirtyChange(listener: (dirty: boolean) => void) {
    this.dirtyListeners.add(listener);
    return () => {
      this.dirtyListeners.delete(listener);
    };
  }

  /** The component reported its unsaved-changes state. */
  setDirtyState(dirty: boolean) {
    if (this.closedEvent || this.dirtyState === dirty) {
      return;
    }
    this.dirtyState = dirty;
    this.dirtyListeners.forEach((listener) => {
      try {
        listener(dirty);
      } catch (error) {
        console.error("MindooDB embed dirty listener failed.", error);
      }
    });
  }

  async save() {
    if (this.closedEvent) {
      return;
    }
    await this.rpc.call("embeds.save", { embedId: this.embedId });
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
    if (this.frame) {
      // Part of this app's page: hiding it is this app's business.
      this.frame.style.visibility = visible ? "" : "hidden";
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
    this.tracker?.dispose();
    this.tracker = null;
    this.frame?.remove();
    this.resolveClosed(event);
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error("MindooDB embed closed listener failed.", error);
      }
    });
    this.listeners.clear();
    this.dirtyListeners.clear();
  }
}

/**
 * `session.components`, `session.embeds` and `session.embedding`.
 *
 * Haven does all the work: it finds the components and runs the embedded app in a
 * sandbox. With a `container` the SDK puts Haven's relay page into it, otherwise
 * Haven positions the component over the rectangle this app reports. This class
 * forwards calls, keeps that rectangle current and turns `embed-event` pushes into
 * closed events.
 */
export class MindooDBAppEmbedsClient {
  public readonly components: MindooDBAppComponentsApi;
  public readonly embeds: MindooDBAppEmbedsApi;
  public readonly embedding: MindooDBAppEmbeddingApi;
  private readonly open = new Map<string, MindooDBAppEmbedImpl>();
  /** Events that arrived before `embeds.open` resolved with their id. */
  private readonly early = new Map<string, MindooDBAppEmbedClosedEvent>();
  private readonly earlyDirty = new Map<string, boolean>();
  private readonly stopListening: () => void;
  /** This app as a component: what to do when its host asks it to save. */
  private saveHandler: (() => void | Promise<void>) | null = null;

  constructor(private readonly rpc: PortRpcClient) {
    this.stopListening = this.rpc.addMessageListener((message) => {
      if (isEmbeddingRequestMessage(message)) {
        void this.answerRequest(message);
        return;
      }
      if (!isEmbedEventMessage(message)) {
        return;
      }
      if (message.event?.type === "dirty") {
        const { embedId, dirty } = message.event;
        const embed = this.open.get(embedId);
        if (embed) {
          embed.setDirtyState(dirty === true);
        } else {
          this.earlyDirty.set(embedId, dirty === true);
        }
        return;
      }
      if (message.event?.type !== "closed") {
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
        const { container, rect, ...rest } = input;
        const initialRect = container ? containerRect(container) : toRect(rect ?? { left: 0, top: 0, width: 0, height: 0 });
        const response = await this.rpc.call<EmbedOpenResponse>("embeds.open", {
          // `frame`: Haven hands back a page for the container instead of laying
          // the component over this app. Havens that do not know it ignore it.
          input: { ...rest, rect: initialRect, ...(container ? { placement: "frame" } : {}) },
        });
        const frame =
          container && response.frame?.url
            ? createComponentFrame(container, response.frame.url, response.frame.allow)
            : null;
        const embed = new MindooDBAppEmbedImpl(
          this.rpc,
          response.embedId,
          input.componentKey,
          input.databaseId,
          input.docId,
          frame,
          container,
        );
        const earlyDirty = this.earlyDirty.get(embed.embedId);
        if (earlyDirty !== undefined) {
          this.earlyDirty.delete(embed.embedId);
          embed.setDirtyState(earlyDirty);
        }
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
      setDirty: async (dirty: boolean) => {
        await this.rpc.call("embedding.setDirty", { dirty: dirty === true });
      },
      onSaveRequest: (handler: () => void | Promise<void>) => {
        this.saveHandler = handler;
        return () => {
          if (this.saveHandler === handler) {
            this.saveHandler = null;
          }
        };
      },
    };
  }

  /** Runs the save handler and tells Haven how it went; Haven answers the host. */
  private async answerRequest(message: MindooDBAppBridgeEmbeddingRequestMessage) {
    let response: { ok: boolean; error?: string };
    if (message.request !== "save" || !this.saveHandler) {
      response = { ok: false, error: "unsupported" };
    } else {
      try {
        await this.saveHandler();
        response = { ok: true };
      } catch (error) {
        response = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    try {
      await this.rpc.call("embedding.respond", { requestId: message.requestId, ...response });
    } catch (error) {
      console.warn("[mindoodb-app-sdk] Could not answer the host's request.", error);
    }
  }

  dispose() {
    this.stopListening();
  }
}
