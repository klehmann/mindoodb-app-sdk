import { mindooDBAppComponentFieldsMatch } from "../appDefinition.js";
import type {
  MindooDBAppComponentInfo,
  MindooDBAppComponentQuery,
  MindooDBAppComponentsApi,
  MindooDBAppDatabase,
  MindooDBAppEmbed,
  MindooDBAppEmbedClosedEvent,
  MindooDBAppEmbedCloseReason,
  MindooDBAppEmbeddingApi,
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
  /** The last `session.embedding.complete`/`cancel` call of this app. */
  getEmbeddingFinish(): MockEmbeddingFinish | null;
  finishEmbedding(finish: MockEmbeddingFinish): void;
  /** Closed events, for the port host to forward as `embed-event` pushes. */
  onClosed(listener: (event: MindooDBAppEmbedClosedEvent) => void): () => void;
  /** As if the component reported unsaved changes (`session.embedding.setDirty`). */
  setEmbedDirty(embedId: string, dirty: boolean): void;
  /** Dirty reports, for the port host to forward as `embed-event` pushes. */
  onDirty(listener: (event: { embedId: string; dirty: boolean }) => void): () => void;
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
): MockEmbedHost {
  let components = [...(options.components ?? [])];
  const embeds = new Map<string, MockEmbedState>();
  const handles = new Map<string, MockEmbed>();
  const closedListeners = new Set<(event: MindooDBAppEmbedClosedEvent) => void>();
  const dirtyListeners = new Set<(event: { embedId: string; dirty: boolean }) => void>();
  let nextSaveError: string | null = null;
  let embeddingDirty: boolean | undefined;
  let saveRequestHandler: (() => void | Promise<void>) | null = null;
  let embedCounter = 0;
  let embeddingFinish: MockEmbeddingFinish | null = null;

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
    });
    notifyChange();
    return embedId;
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
