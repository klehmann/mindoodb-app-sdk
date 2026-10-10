import { mindooDBAppComponentFieldsMatch } from "../appDefinition.js";
import type {
  MindooDBAppComponentInfo,
  MindooDBAppComponentQuery,
  MindooDBAppComponentsApi,
  MindooDBAppDatabase,
  MindooDBAppEmbed,
  MindooDBAppEmbedAccessInput,
  MindooDBAppEmbedAccessPair,
  MindooDBAppEmbedAccessResult,
  MindooDBAppEmbedAgentTools,
  MindooDBAppEmbedClosedEvent,
  MindooDBAppEmbedCloseReason,
  MindooDBAppEmbeddingApi,
  MindooDBAppEmbeddingLookupOptions,
  MindooDBAppEmbeddingLookupResult,
  MindooDBAppEmbedOpenInput,
  MindooDBAppEmbedRect,
  MindooDBAppEmbedsApi,
} from "../types";

/** An embed the mock host currently shows, as tests and the test host page see it. */
export interface MockEmbedState {
  embedId: string;
  component: MindooDBAppComponentInfo;
  databaseId: string;
  docId: string;
  intent: "edit" | "view";
  rect: MindooDBAppEmbedRect;
  visible: boolean;
  /** What the component last reported (`setEmbedDirty`); `undefined` until then. */
  dirty?: boolean;
  /** Whether it is the active one of its app's embeds (`embed.setActive`, or the newest). */
  active: boolean;
  /** The agent tools it offers (`setEmbedAgentTools`), as the host app sees them. */
  agentTools: MindooDBAppEmbedAgentTools | null;
}

/** How an app running as an embedded component finished (`session.embedding`). */
export interface MockEmbeddingFinish {
  reason: "completed" | "cancelled";
  result?: unknown;
  message?: string;
}

export interface MockEmbedHostOptions {
  /** What `session.components.list` offers. */
  components?: MindooDBAppComponentInfo[];
  /** Called when the app opens an embed, e.g. to draw a stand-in in the test host page. */
  onEmbedChange?: (embeds: readonly MockEmbedState[]) => void;
  /**
   * For an app under test that runs as a component: answers its
   * `session.embedding.lookup`, as Haven would from the host's database. No results
   * without it.
   */
  embeddingLookup?: (
    field: string,
    options: MindooDBAppEmbeddingLookupOptions,
  ) => MindooDBAppEmbeddingLookupResult[] | Promise<MindooDBAppEmbeddingLookupResult[]>;
  /**
   * Plays the user for `session.embeds.requestAccess`: gets the pairs Haven would
   * ask for and returns the ones the user allows. Without it every pair is allowed.
   */
  embedAccess?: (
    pairs: MindooDBAppEmbedAccessPair[],
  ) => MindooDBAppEmbedAccessPair[] | Promise<MindooDBAppEmbedAccessPair[]>;
}

export interface MockEmbedHost {
  components: MindooDBAppComponentsApi;
  embeds: MindooDBAppEmbedsApi;
  embedding: MindooDBAppEmbeddingApi;
  /** Same as `embeds.open` but returns the id; the port host uses it. */
  openEmbed(input: MindooDBAppEmbedOpenInput): Promise<string>;
  setRect(embedId: string, rect: MindooDBAppEmbedRect): void;
  setVisible(embedId: string, visible: boolean): void;
  /** Closes an embed as Haven would, e.g. when the component completes. */
  closeEmbed(embedId: string, reason?: MindooDBAppEmbedCloseReason, result?: unknown): void;
  listEmbeds(): MockEmbedState[];
  setComponents(components: MindooDBAppComponentInfo[]): void;
  /** Every `session.embeds.requestAccess` input so far, oldest first. */
  getAccessRequests(): MindooDBAppEmbedAccessInput[];
  /** The pairs allowed so far (`requestAccess`), as `componentKey/databaseId`. */
  getGrantedAccess(): string[];
  /** The last `session.embedding.complete`/`cancel` call of this app. */
  getEmbeddingFinish(): MockEmbeddingFinish | null;
  finishEmbedding(finish: MockEmbeddingFinish): void;
  /** Closed events, for the port host to forward as `embed-event` pushes. */
  onClosed(listener: (event: MindooDBAppEmbedClosedEvent) => void): () => void;
  /** As if the component reported unsaved changes (`session.embedding.setDirty`). */
  setEmbedDirty(embedId: string, dirty: boolean): void;
  /** Dirty reports, for the port host to forward as `embed-event` pushes. */
  onDirty(listener: (event: { embedId: string; dirty: boolean }) => void): () => void;
  /** `embed.setActive()` from the app: the active one of its app's embeds. */
  setActive(embedId: string): void;
  /**
   * As if the component registered these agent tools (names without prefix; `[]` or
   * null for none). The prefix is the component's app id without `mindoodb-app-`.
   */
  setEmbedAgentTools(embedId: string, names: string[] | null, options?: { enabled?: boolean }): void;
  /** Agent tool reports, for the port host to forward as `embed-event` pushes. */
  onAgentTools(listener: (event: { embedId: string; agentTools: MindooDBAppEmbedAgentTools | null }) => void): () => void;
  /**
   * `embed.save()` from the app: the stand-in component saves, i.e. reports clean,
   * unless {@link failNextSave} set an error.
   */
  saveEmbed(embedId: string): Promise<void>;
  /** Makes the next `embed.save()` fail with this message, as a component might. */
  failNextSave(message: string): void;
  /** For an app under test that runs as a component: its last `embedding.setDirty`. */
  getEmbeddingDirty(): boolean | undefined;
  setEmbeddingDirty(dirty: boolean): void;
  /**
   * For an app under test that runs as a component: asks it to save as its host
   * would (`embed.save()`); resolves or rejects with its save handler.
   */
  requestEmbeddingSave(): Promise<void>;
  setSaveRequestHandler(handler: (() => void | Promise<void>) | null): void;
}

/**
 * Stand-in for Haven's component registry and embed frames.
 *
 * There is no second app in a test, so nothing is rendered: the mock checks the
 * same things Haven checks (the component exists, the database is known, the root
 * document exists and matches the component) and records the embed. Tests close
 * it with `closeEmbed`, as the user or the component would.
 */
export function createMockEmbedHost(
  options: MockEmbedHostOptions,
  getDatabase: (databaseId: string) => MindooDBAppDatabase,
  listDatabaseIds: () => string[] = () => [],
): MockEmbedHost {
  let components = [...(options.components ?? [])];
  const embeds = new Map<string, MockEmbedState>();
  const handles = new Map<string, MockEmbed>();
  const closedListeners = new Set<(event: MindooDBAppEmbedClosedEvent) => void>();
  const dirtyListeners = new Set<(event: { embedId: string; dirty: boolean }) => void>();
  const toolListeners = new Set<(event: { embedId: string; agentTools: MindooDBAppEmbedAgentTools | null }) => void>();
  const toolNames = new Map<string, { names: string[]; enabled: boolean }>();
  let nextSaveError: string | null = null;
  let embeddingDirty: boolean | undefined;
  let saveRequestHandler: (() => void | Promise<void>) | null = null;
  let embedCounter = 0;
  let embeddingFinish: MockEmbeddingFinish | null = null;
  const accessRequests: MindooDBAppEmbedAccessInput[] = [];
  const grantedAccess = new Set<string>();
  const pendingAccess = new Set<string>();

  /** Like Haven: one prompt for what is neither allowed nor put off yet. */
  async function requestAccess(input: MindooDBAppEmbedAccessInput): Promise<MindooDBAppEmbedAccessResult> {
    accessRequests.push(structuredClone(input));
    const pairs = (input.components ?? []).flatMap((entry) =>
      components.some((component) => component.key === entry.componentKey)
        ? (entry.databaseIds ?? listDatabaseIds())
            .filter((databaseId) => listDatabaseIds().includes(databaseId))
            .map((databaseId) => ({ componentKey: entry.componentKey, databaseId }))
        : [],
    );
    const pairKey = (pair: MindooDBAppEmbedAccessPair) => `${pair.componentKey}/${pair.databaseId}`;
    const ask = pairs.filter((pair) => !grantedAccess.has(pairKey(pair)) && !pendingAccess.has(pairKey(pair)));
    if (ask.length) {
      const allowed = new Set((await (options.embedAccess?.(structuredClone(ask)) ?? ask)).map(pairKey));
      for (const pair of ask) {
        (allowed.has(pairKey(pair)) ? grantedAccess : pendingAccess).add(pairKey(pair));
      }
    }
    return {
      granted: pairs.filter((pair) => grantedAccess.has(pairKey(pair))),
      pending: pairs.filter((pair) => !grantedAccess.has(pairKey(pair))),
    };
  }

  function notifyChange() {
    options.onEmbedChange?.([...embeds.values()].map((entry) => ({ ...entry, rect: { ...entry.rect } })));
  }

  /** The mock has no relay page, so it behaves like an overlay Haven. */
  function mockRect(input: MindooDBAppEmbedOpenInput): MindooDBAppEmbedRect {
    if (input.rect) {
      return { ...input.rect };
    }
    const bounds = input.container?.getBoundingClientRect();
    return { left: bounds?.left ?? 0, top: bounds?.top ?? 0, width: bounds?.width ?? 0, height: bounds?.height ?? 0 };
  }

  async function openEmbed(input: MindooDBAppEmbedOpenInput) {
    const component = components.find((entry) => entry.key === input.componentKey);
    if (!component) {
      throw new Error(`Unknown component "${input.componentKey}".`);
    }
    const intent = input.intent ?? "edit";
    if (!component.intents.includes(intent) && !(intent === "edit" && component.intents.includes("create"))) {
      throw new Error(`Component "${component.label}" does not support "${intent}".`);
    }
    const document = await getDatabase(input.databaseId).documents.get(input.docId);
    if (!document) {
      throw new Error(`Document ${input.docId} does not exist.`);
    }
    if (!mindooDBAppComponentFieldsMatch(component.match, document.data)) {
      throw new Error(`Document ${input.docId} is not a "${component.label}" document.`);
    }
    embedCounter += 1;
    const embedId = `mock-embed-${embedCounter}`;
    embeds.set(embedId, {
      embedId,
      component,
      databaseId: input.databaseId,
      docId: input.docId,
      intent,
      rect: mockRect(input),
      visible: input.visible !== false,
      active: false,
      agentTools: null,
    });
    // Like Haven: the newest embed of an app is its active one until the host says otherwise.
    setActive(embedId);
    return embedId;
  }

  function toolPrefix(component: MindooDBAppComponentInfo) {
    return component.appId.replace(/^mindoodb-app-/, "").replace(/[^a-z0-9_]/g, "_") || "app";
  }

  function publishTools(entry: MockEmbedState) {
    const declared = toolNames.get(entry.embedId);
    const prefix = toolPrefix(entry.component);
    const next: MindooDBAppEmbedAgentTools | null = declared?.names.length
      ? { prefix, names: declared.names.map((name) => `${prefix}_${name}`), active: entry.active, enabled: declared.enabled }
      : null;
    if (JSON.stringify(next) === JSON.stringify(entry.agentTools)) {
      return;
    }
    entry.agentTools = next;
    handles.get(entry.embedId)?.setAgentToolsState(next);
    toolListeners.forEach((listener) => listener({ embedId: entry.embedId, agentTools: next }));
  }

  function setActive(embedId: string) {
    const target = embeds.get(embedId);
    if (!target) {
      return;
    }
    for (const entry of embeds.values()) {
      if (entry.component.appId === target.component.appId) {
        entry.active = entry.embedId === embedId;
        publishTools(entry);
      }
    }
    notifyChange();
  }

  function setEmbedAgentTools(embedId: string, names: string[] | null, toolOptions: { enabled?: boolean } = {}) {
    const entry = embeds.get(embedId);
    if (!entry) {
      return;
    }
    toolNames.set(embedId, { names: [...(names ?? [])], enabled: toolOptions.enabled !== false });
    publishTools(entry);
    notifyChange();
  }

  function closeEmbed(embedId: string, reason: MindooDBAppEmbedCloseReason = "closed", result?: unknown) {
    if (!embeds.delete(embedId)) {
      return;
    }
    const event: MindooDBAppEmbedClosedEvent = {
      embedId,
      reason,
      ...(result === undefined ? {} : { result: JSON.parse(JSON.stringify(result)) as unknown }),
    };
    handles.get(embedId)?.settle(event);
    handles.delete(embedId);
    toolNames.delete(embedId);
    closedListeners.forEach((listener) => listener(event));
    notifyChange();
  }

  class MockEmbed implements MindooDBAppEmbed {
    readonly placement = "overlay" as const;
    readonly frame = null;
    readonly closed: Promise<MindooDBAppEmbedClosedEvent>;
    dirty: boolean | undefined = undefined;
    private dirtyListeners = new Set<(dirty: boolean) => void>();

    onDirtyChange(listener: (dirty: boolean) => void) {
      this.dirtyListeners.add(listener);
      return () => {
        this.dirtyListeners.delete(listener);
      };
    }

    setDirtyState(dirty: boolean) {
      if (this.settled || this.dirty === dirty) {
        return;
      }
      this.dirty = dirty;
      this.dirtyListeners.forEach((listener) => listener(dirty));
    }

    async save() {
      await saveEmbed(this.embedId);
    }

    agentTools: MindooDBAppEmbedAgentTools | null = null;
    private toolsListeners = new Set<(tools: MindooDBAppEmbedAgentTools | null) => void>();

    async setActive() {
      setActive(this.embedId);
    }

    onAgentToolsChange(listener: (tools: MindooDBAppEmbedAgentTools | null) => void) {
      this.toolsListeners.add(listener);
      return () => {
        this.toolsListeners.delete(listener);
      };
    }

    setAgentToolsState(tools: MindooDBAppEmbedAgentTools | null) {
      this.agentTools = tools;
      this.toolsListeners.forEach((listener) => listener(tools));
    }

    waitForAgentTools(timeoutMs = 10_000): Promise<MindooDBAppEmbedAgentTools | null> {
      if (this.agentTools?.names.length) {
        return Promise.resolve(this.agentTools);
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          stop();
          resolve(null);
        }, timeoutMs);
        const stop = this.onAgentToolsChange((tools) => {
          if (tools?.names.length) {
            clearTimeout(timer);
            stop();
            resolve(tools);
          }
        });
      });
    }
    private resolve!: (event: MindooDBAppEmbedClosedEvent) => void;
    private listeners = new Set<(event: MindooDBAppEmbedClosedEvent) => void>();
    private settled: MindooDBAppEmbedClosedEvent | null = null;

    constructor(
      readonly embedId: string,
      readonly componentKey: string,
      readonly databaseId: string,
      readonly docId: string,
    ) {
      this.closed = new Promise((resolve) => {
        this.resolve = resolve;
      });
    }

    async setRect(rect: MindooDBAppEmbedRect) {
      setRect(this.embedId, rect);
    }

    async setVisible(visible: boolean) {
      setVisible(this.embedId, visible);
    }

    async close(_options?: { discard?: boolean }) {
      closeEmbed(this.embedId, "closed");
      return await this.closed;
    }

    onClosed(listener: (event: MindooDBAppEmbedClosedEvent) => void) {
      if (this.settled) {
        const event = this.settled;
        queueMicrotask(() => listener(event));
        return () => {};
      }
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    }

    settle(event: MindooDBAppEmbedClosedEvent) {
      this.settled = event;
      this.resolve(event);
      this.listeners.forEach((listener) => listener(event));
      this.listeners.clear();
    }
  }

  function setRect(embedId: string, rect: MindooDBAppEmbedRect) {
    const entry = embeds.get(embedId);
    if (entry) {
      entry.rect = { ...rect };
      notifyChange();
    }
  }

  function setEmbedDirty(embedId: string, dirty: boolean) {
    const entry = embeds.get(embedId);
    if (!entry || entry.dirty === dirty) {
      return;
    }
    entry.dirty = dirty;
    handles.get(embedId)?.setDirtyState(dirty);
    dirtyListeners.forEach((listener) => listener({ embedId, dirty }));
    notifyChange();
  }

  async function saveEmbed(embedId: string) {
    if (!embeds.has(embedId)) {
      throw new Error("Unknown embed.");
    }
    const error = nextSaveError;
    nextSaveError = null;
    if (error) {
      throw new Error(error);
    }
    setEmbedDirty(embedId, false);
  }

  function setVisible(embedId: string, visible: boolean) {
    const entry = embeds.get(embedId);
    if (entry) {
      entry.visible = visible;
      notifyChange();
    }
  }

  return {
    components: {
      async list(query?: MindooDBAppComponentQuery) {
        return components
          .filter((entry) => !query?.intent || entry.intents.includes(query.intent))
          .filter((entry) => !query?.document || mindooDBAppComponentFieldsMatch(entry.match, query.document))
          .map((entry) => structuredClone(entry));
      },
    },
    embeds: {
      async open(input) {
        const embedId = await openEmbed(input);
        const handle = new MockEmbed(embedId, input.componentKey, input.databaseId, input.docId);
        handles.set(embedId, handle);
        return handle;
      },
      requestAccess,
    },
    embedding: {
      async complete(result?: unknown) {
        embeddingFinish = {
          reason: "completed",
          ...(result === undefined ? {} : { result: JSON.parse(JSON.stringify(result)) as unknown }),
        };
      },
      async cancel(message?: string) {
        embeddingFinish = { reason: "cancelled", ...(message ? { message } : {}) };
      },
      async setDirty(dirty: boolean) {
        embeddingDirty = dirty === true;
      },
      async lookup(field: string, lookupOptions?: MindooDBAppEmbeddingLookupOptions) {
        return structuredClone(await (options.embeddingLookup?.(field, { ...lookupOptions }) ?? []));
      },
      onSaveRequest(handler) {
        saveRequestHandler = handler;
        return () => {
          if (saveRequestHandler === handler) {
            saveRequestHandler = null;
          }
        };
      },
    },
    openEmbed,
    setRect,
    setVisible,
    closeEmbed,
    listEmbeds() {
      return [...embeds.values()].map((entry) => ({ ...entry, rect: { ...entry.rect } }));
    },
    setComponents(next) {
      components = [...next];
    },
    getAccessRequests() {
      return structuredClone(accessRequests);
    },
    getGrantedAccess() {
      return [...grantedAccess];
    },
    getEmbeddingFinish() {
      return embeddingFinish;
    },
    finishEmbedding(finish) {
      embeddingFinish = finish;
    },
    onClosed(listener) {
      closedListeners.add(listener);
      return () => {
        closedListeners.delete(listener);
      };
    },
    setEmbedDirty,
    setActive,
    setEmbedAgentTools,
    onAgentTools(listener) {
      toolListeners.add(listener);
      return () => {
        toolListeners.delete(listener);
      };
    },
    onDirty(listener) {
      dirtyListeners.add(listener);
      return () => {
        dirtyListeners.delete(listener);
      };
    },
    saveEmbed,
    failNextSave(message) {
      nextSaveError = message;
    },
    getEmbeddingDirty() {
      return embeddingDirty;
    },
    setEmbeddingDirty(dirty) {
      embeddingDirty = dirty;
    },
    async requestEmbeddingSave() {
      if (!saveRequestHandler) {
        throw new Error("unsupported");
      }
      await saveRequestHandler();
    },
    setSaveRequestHandler(handler) {
      saveRequestHandler = handler;
    },
  };
}
