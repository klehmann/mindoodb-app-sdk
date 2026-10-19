import {
  mindooDBAppExportFile,
  mindooDBAppExportPayload,
  normalizeMindooDBAppEmbedExportRequest,
  normalizeMindooDBAppEmbedVariables,
  type MindooDBAppEmbeddingExport,
  type MindooDBAppEmbedExportPayload,
  type MindooDBAppEmbedExportRequest,
  type MindooDBAppEmbedVariable,
} from "../embedExchange";
import {
  normalizeMindooDBAppInspectAnchor,
  normalizeMindooDBAppInspection,
  normalizeMindooDBAppInspectRequest,
  normalizeMindooDBAppIssues,
  performMindooDBAppEmbeddingSave,
  type MindooDBAppEmbedValidation,
  type MindooDBAppInspectAnchor,
  type MindooDBAppInspectionBase,
  type MindooDBAppInspectRequest,
  type MindooDBAppIssue,
} from "../inspection";
import type {
  MindooDBAppBridgeEmbedEventMessage,
  MindooDBAppBridgeEmbedRequestMessage,
  MindooDBAppBridgeEmbeddingRequestMessage,
  MindooDBAppBridgePortMessage,
  MindooDBAppComponentInfo,
  MindooDBAppComponentQuery,
  MindooDBAppComponentsApi,
  MindooDBAppEmbed,
  MindooDBAppEmbedAccessInput,
  MindooDBAppEmbedAccessResult,
  MindooDBAppEmbedAgentTools,
  MindooDBAppEmbedBeforeSaveInput,
  MindooDBAppEmbedBeforeSaveResult,
  MindooDBAppEmbedClosedEvent,
  MindooDBAppEmbedSavedEvent,
  MindooDBAppEmbeddingApi,
  MindooDBAppEmbeddingLookupOptions,
  MindooDBAppEmbeddingLookupResult,
  MindooDBAppEmbedOpenInput,
  MindooDBAppEmbedRect,
  MindooDBAppEmbedsApi,
} from "../types";
import type { PortRpcClient } from "./portRpcClient";

function isEmbedEventMessage(message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeEmbedEventMessage {
  return message.kind === "embed-event";
}

function isEmbedRequestMessage(message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeEmbedRequestMessage {
  return message.kind === "embed-request";
}

function isMethodNotFound(error: unknown) {
  return error instanceof Error && error.name === "method-not-found";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
  supports?: string[];
}

type BeforeSaveHandler = (
  input: MindooDBAppEmbedBeforeSaveInput,
) => MindooDBAppEmbedBeforeSaveResult | Promise<MindooDBAppEmbedBeforeSaveResult>;

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
  private toolsState: MindooDBAppEmbedAgentTools | null = null;
  private readonly toolsListeners = new Set<(tools: MindooDBAppEmbedAgentTools | null) => void>();
  private beforeSaveHandler: BeforeSaveHandler | null = null;
  private readonly savedListeners = new Set<(event: MindooDBAppEmbedSavedEvent) => void>();

  constructor(
    private readonly rpc: PortRpcClient,
    public readonly embedId: string,
    public readonly componentKey: string,
    public readonly databaseId: string,
    public readonly docId: string,
    public readonly frame: HTMLIFrameElement | null,
    container: HTMLElement | undefined,
    public readonly supports: readonly string[] = [],
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

  async setActive() {
    if (this.closedEvent) {
      return;
    }
    await this.rpc.call("embeds.setActive", { embedId: this.embedId });
  }

  get agentTools() {
    return this.toolsState;
  }

  onAgentToolsChange(listener: (tools: MindooDBAppEmbedAgentTools | null) => void) {
    this.toolsListeners.add(listener);
    return () => {
      this.toolsListeners.delete(listener);
    };
  }

  /** Haven reported the component's agent tools. */
  setAgentToolsState(tools: MindooDBAppEmbedAgentTools | null) {
    if (this.closedEvent) {
      return;
    }
    this.toolsState = tools ? { ...tools, names: [...tools.names] } : null;
    this.toolsListeners.forEach((listener) => {
      try {
        listener(this.toolsState);
      } catch (error) {
        console.error("MindooDB embed agent tools listener failed.", error);
      }
    });
  }

  waitForAgentTools(timeoutMs = 10_000): Promise<MindooDBAppEmbedAgentTools | null> {
    if (this.toolsState?.names.length) {
      return Promise.resolve(this.toolsState);
    }
    if (this.closedEvent) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const finish = (tools: MindooDBAppEmbedAgentTools | null) => {
        clearTimeout(timer);
        stopTools();
        stopClosed();
        resolve(tools);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      const stopTools = this.onAgentToolsChange((tools) => {
        if (tools?.names.length) finish(tools);
      });
      const stopClosed = this.onClosed(() => finish(null));
    });
  }

  async inspect<T extends MindooDBAppInspectionBase = MindooDBAppInspectionBase>(request?: MindooDBAppInspectRequest) {
    const result = await this.rpc.call("embeds.inspect", {
      embedId: this.embedId,
      request: normalizeMindooDBAppInspectRequest(request),
    });
    return normalizeMindooDBAppInspection(result) as unknown as T;
  }

  onBeforeSave(handler: BeforeSaveHandler, options?: { inspect?: MindooDBAppInspectRequest }) {
    this.beforeSaveHandler = handler;
    this.announceBeforeSave(true, options?.inspect);
    return () => {
      if (this.beforeSaveHandler === handler) {
        this.beforeSaveHandler = null;
        this.announceBeforeSave(false);
      }
    };
  }

  /** Haven only asks hosts that said they check, and fetches the inspection they want. */
  private announceBeforeSave(enabled: boolean, inspect?: MindooDBAppInspectRequest) {
    if (this.closedEvent) {
      return;
    }
    void this.rpc
      .call("embeds.setBeforeSave", {
        embedId: this.embedId,
        enabled,
        ...(enabled ? { inspect: normalizeMindooDBAppInspectRequest(inspect) } : {}),
      })
      .catch((error: unknown) => {
        if (!isMethodNotFound(error)) {
          console.warn("[mindoodb-app-sdk] Could not register the save check.", error);
        }
      });
  }

  /** Haven asks before the component saves: run the handler, never longer than Haven waits. */
  async answerBeforeSave(params: MindooDBAppBridgeEmbedRequestMessage["params"]) {
    const handler = this.beforeSaveHandler;
    if (!handler || this.closedEvent) {
      return { issues: [] };
    }
    const result = await handler({
      embedId: this.embedId,
      inspection: params?.inspection ?? null,
      root: params?.root ?? null,
    });
    return { issues: normalizeMindooDBAppIssues(result?.issues) };
  }

  onAfterSave(listener: (event: MindooDBAppEmbedSavedEvent) => void) {
    this.savedListeners.add(listener);
    return () => {
      this.savedListeners.delete(listener);
    };
  }

  /** The component reported that it saved. */
  notifySaved() {
    if (this.closedEvent) {
      return;
    }
    const event = { embedId: this.embedId };
    this.savedListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error("MindooDB embed saved listener failed.", error);
      }
    });
  }

  async showIssues(issues: MindooDBAppIssue[]) {
    await this.rpc.call("embeds.showIssues", { embedId: this.embedId, issues: normalizeMindooDBAppIssues(issues) });
  }

  async reveal(anchor: MindooDBAppInspectAnchor) {
    const normalized = normalizeMindooDBAppInspectAnchor(anchor);
    if (!normalized) {
      throw new Error("Invalid anchor.");
    }
    await this.rpc.call("embeds.reveal", { embedId: this.embedId, anchor: normalized });
  }

  async setVariables(variables: MindooDBAppEmbedVariable[]) {
    await this.rpc.call("embeds.setVariables", {
      embedId: this.embedId,
      variables: normalizeMindooDBAppEmbedVariables(variables),
    });
  }

  async export(request: MindooDBAppEmbedExportRequest) {
    const payload = await this.rpc.call<MindooDBAppEmbedExportPayload>("embeds.export", {
      embedId: this.embedId,
      request: normalizeMindooDBAppEmbedExportRequest(request),
    });
    // Checked structurally: buffers sent across a MessagePort may come from another realm.
    if (!payload || Object.prototype.toString.call(payload.data) !== "[object ArrayBuffer]") {
      throw new Error("The component handed over no file.");
    }
    return mindooDBAppExportFile(payload);
  }

  async callTool(name: string, input?: Record<string, unknown>) {
    return await this.rpc.call("embeds.callTool", {
      embedId: this.embedId,
      name: String(name),
      input: input === undefined ? {} : (JSON.parse(JSON.stringify(input)) as Record<string, unknown>),
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
    if (this.frame) {
      // Part of this app's page: hiding it is this app's business. Haven still
      // needs to know, so a hidden component gets no drops and no menus.
      this.frame.style.visibility = visible ? "" : "hidden";
    }
    await this.rpc.call("embeds.setVisible", { embedId: this.embedId, visible: visible === true });
  }

  async close(options?: { discard?: boolean }) {
    if (!this.closedEvent) {
      await this.rpc.call("embeds.close", {
        embedId: this.embedId,
        ...(options?.discard ? { discard: true } : {}),
      });
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
    this.savedListeners.clear();
    this.beforeSaveHandler = null;
    this.toolsState = null;
    this.toolsListeners.forEach((listener) => {
      try {
        listener(null);
      } catch (error) {
        console.error("MindooDB embed agent tools listener failed.", error);
      }
    });
    this.toolsListeners.clear();
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
  private readonly earlyTools = new Map<string, MindooDBAppEmbedAgentTools | null>();
  private readonly stopListening: () => void;
  /** This app as a component: what to do when its host asks it to save. */
  private saveHandler: (() => void | Promise<void>) | null = null;
  private inspectionProvider:
    | ((request: MindooDBAppInspectRequest) => MindooDBAppInspectionBase | Promise<MindooDBAppInspectionBase>)
    | null = null;
  private showIssuesHandler: ((issues: MindooDBAppIssue[]) => void | Promise<void>) | null = null;
  private revealHandler: ((anchor: MindooDBAppInspectAnchor) => void | Promise<void>) | null = null;
  private exportProvider:
    | ((request: MindooDBAppEmbedExportRequest) => MindooDBAppEmbeddingExport | Promise<MindooDBAppEmbeddingExport>)
    | null = null;
  /** The host's variables as last pushed; null until known (then asked for on first use). */
  private variables: MindooDBAppEmbedVariable[] | null = null;
  private readonly variableListeners = new Set<(variables: MindooDBAppEmbedVariable[]) => void>();

  constructor(private readonly rpc: PortRpcClient) {
    this.stopListening = this.rpc.addMessageListener((message) => {
      if (isEmbeddingRequestMessage(message)) {
        void this.answerRequest(message);
        return;
      }
      if (isEmbedRequestMessage(message)) {
        void this.answerEmbedRequest(message);
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
      if (message.event?.type === "agentTools") {
        const { embedId, agentTools } = message.event;
        const embed = this.open.get(embedId);
        if (embed) {
          embed.setAgentToolsState(agentTools ?? null);
        } else {
          this.earlyTools.set(embedId, agentTools ?? null);
        }
        return;
      }
      if (message.event?.type === "saved") {
        this.open.get(message.event.embedId)?.notifySaved();
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
        const { variables, template, ...plain } = rest;
        const response = await this.rpc.call<EmbedOpenResponse>("embeds.open", {
          // `frame`: Haven hands back a page for the container instead of laying
          // the component over this app. Havens that do not know it ignore it.
          input: {
            ...plain,
            rect: initialRect,
            ...(container ? { placement: "frame" } : {}),
            ...(variables ? { variables: normalizeMindooDBAppEmbedVariables(variables) } : {}),
            ...(template ? { template: { docId: String(template.docId), ...(template.databaseId ? { databaseId: String(template.databaseId) } : {}) } } : {}),
          },
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
          Array.isArray(response.supports) ? response.supports.filter((entry) => typeof entry === "string") : [],
        );
        const earlyDirty = this.earlyDirty.get(embed.embedId);
        if (earlyDirty !== undefined) {
          this.earlyDirty.delete(embed.embedId);
          embed.setDirtyState(earlyDirty);
        }
        if (this.earlyTools.has(embed.embedId)) {
          embed.setAgentToolsState(this.earlyTools.get(embed.embedId) ?? null);
          this.earlyTools.delete(embed.embedId);
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
      requestAccess: async (input: MindooDBAppEmbedAccessInput) => {
        const components = (input?.components ?? []).map((entry) => ({
          componentKey: String(entry.componentKey),
          ...(entry.databaseIds ? { databaseIds: entry.databaseIds.map(String) } : {}),
          ...(entry.intent === "view" ? { intent: "view" as const } : {}),
        }));
        try {
          const response = await this.rpc.call<MindooDBAppEmbedAccessResult>("embeds.requestAccess", {
            input: { components },
          });
          return { granted: response?.granted ?? [], pending: response?.pending ?? [] };
        } catch (error) {
          if (!(error instanceof Error && error.name === "method-not-found")) {
            throw error;
          }
          // An older Haven: `open` still asks for each pairing itself.
          return {
            granted: [],
            pending: components.flatMap((entry) =>
              (entry.databaseIds ?? []).map((databaseId) => ({ componentKey: entry.componentKey, databaseId })),
            ),
          };
        }
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
      lookup: async (field: string, options?: MindooDBAppEmbeddingLookupOptions) => {
        const result = await this.rpc.call("embedding.lookup", {
          field: String(field),
          ...(options?.query ? { query: String(options.query) } : {}),
          ...(options?.docIds ? { docIds: options.docIds.map(String) } : {}),
          ...(options?.limit ? { limit: Number(options.limit) } : {}),
        });
        return (Array.isArray(result) ? result : []) as MindooDBAppEmbeddingLookupResult[];
      },
      onSaveRequest: (handler: () => void | Promise<void>) => {
        this.saveHandler = handler;
        return () => {
          if (this.saveHandler === handler) {
            this.saveHandler = null;
          }
        };
      },
      provideInspection: (provider) => {
        this.inspectionProvider = provider;
        return () => {
          if (this.inspectionProvider === provider) {
            this.inspectionProvider = null;
          }
        };
      },
      onShowIssues: (handler) => {
        this.showIssuesHandler = handler;
        return () => {
          if (this.showIssuesHandler === handler) {
            this.showIssuesHandler = null;
          }
        };
      },
      getVariables: async () => {
        if (this.variables) {
          return this.variables.map((variable) => ({ ...variable }));
        }
        try {
          const result = await this.rpc.call("embedding.getVariables", {});
          this.variables ??= normalizeMindooDBAppEmbedVariables((result as { variables?: unknown } | null)?.variables);
        } catch (error) {
          if (!isMethodNotFound(error) && !(error instanceof Error && error.name === "unsupported")) {
            throw error;
          }
          this.variables ??= [];
        }
        return this.variables.map((variable) => ({ ...variable }));
      },
      onVariablesChange: (listener) => {
        this.variableListeners.add(listener);
        return () => {
          this.variableListeners.delete(listener);
        };
      },
      provideExport: (provider) => {
        this.exportProvider = provider;
        return () => {
          if (this.exportProvider === provider) {
            this.exportProvider = null;
          }
        };
      },
      onReveal: (handler) => {
        this.revealHandler = handler;
        return () => {
          if (this.revealHandler === handler) {
            this.revealHandler = null;
          }
        };
      },
      validate: async (options) => await this.validate(options),
      save: async (flush, options) =>
        await performMindooDBAppEmbeddingSave({
          validate: () => this.validate(options),
          provider: this.inspectionProvider,
          showIssues: this.showIssuesHandler,
          flush,
          // Only news for the host: a lost message must not fail a save that happened.
          saved: () => this.rpc.call("embedding.saved", {}).then(
            () => {},
            () => {},
          ),
        }),
    };
  }

  /** `embedding.validate`; ok when Haven cannot check (not embedded, older Haven). */
  private async validate(options?: { interactive?: boolean }): Promise<MindooDBAppEmbedValidation> {
    try {
      const result = (await this.rpc.call("embedding.validate", {
        interactive: options?.interactive !== false,
      })) as Partial<MindooDBAppEmbedValidation> | null;
      return {
        ok: result?.ok !== false,
        issues: normalizeMindooDBAppIssues(result?.issues),
        ...(result?.timedOut ? { timedOut: true } : {}),
      };
    } catch (error) {
      if (isMethodNotFound(error) || (error instanceof Error && error.name === "unsupported")) {
        return { ok: true, issues: [] };
      }
      throw error;
    }
  }

  /** Runs the matching handler and tells Haven how it went; Haven answers the host. */
  private async answerRequest(message: MindooDBAppBridgeEmbeddingRequestMessage) {
    let response: { ok: boolean; error?: string; result?: unknown };
    try {
      const params = message.params ?? {};
      if (message.request === "save" && this.saveHandler) {
        await this.saveHandler();
        response = { ok: true };
      } else if (message.request === "inspect" && this.inspectionProvider) {
        const inspection = await this.inspectionProvider(normalizeMindooDBAppInspectRequest(params.request));
        response = { ok: true, result: normalizeMindooDBAppInspection(inspection) };
      } else if (message.request === "showIssues" && this.showIssuesHandler) {
        await this.showIssuesHandler(normalizeMindooDBAppIssues(params.issues));
        response = { ok: true };
      } else if (message.request === "reveal" && this.revealHandler) {
        const anchor = normalizeMindooDBAppInspectAnchor(params.anchor);
        if (!anchor) {
          throw new Error("Invalid anchor.");
        }
        await this.revealHandler(anchor);
        response = { ok: true };
      } else if (message.request === "variables") {
        this.variables = normalizeMindooDBAppEmbedVariables(params.variables);
        const variables = this.variables;
        this.variableListeners.forEach((listener) => {
          try {
            listener(variables.map((variable) => ({ ...variable })));
          } catch (error) {
            console.error("MindooDB embedding variables listener failed.", error);
          }
        });
        response = { ok: true };
      } else if (message.request === "export" && this.exportProvider) {
        const request = normalizeMindooDBAppEmbedExportRequest(params.request);
        response = { ok: true, result: await mindooDBAppExportPayload(await this.exportProvider(request), request) };
      } else {
        response = { ok: false, error: "unsupported" };
      }
    } catch (error) {
      response = { ok: false, error: errorMessage(error) };
    }
    try {
      await this.rpc.call("embedding.respond", { requestId: message.requestId, ...response });
    } catch (error) {
      console.warn("[mindoodb-app-sdk] Could not answer the host's request.", error);
    }
  }

  /** This app as a host: Haven asks before one of its components saves. */
  private async answerEmbedRequest(message: MindooDBAppBridgeEmbedRequestMessage) {
    let response: { ok: boolean; error?: string; result?: unknown };
    const embed = this.open.get(message.embedId);
    try {
      response =
        message.request === "beforeSave"
          ? { ok: true, result: embed ? await embed.answerBeforeSave(message.params) : { issues: [] } }
          : { ok: false, error: "unsupported" };
    } catch (error) {
      // A failing check must not lose the user's work silently: say so, as a warning.
      response = {
        ok: true,
        result: { issues: [{ severity: "warning", message: `The check failed: ${errorMessage(error)}`, code: "check-failed" }] },
      };
    }
    try {
      await this.rpc.call("embeds.respond", { requestId: message.requestId, ...response });
    } catch (error) {
      console.warn("[mindoodb-app-sdk] Could not answer Haven's request.", error);
    }
  }

  dispose() {
    this.stopListening();
  }
}
