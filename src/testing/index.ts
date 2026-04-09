import type {
  MindooDBAppAttachmentApi,
  MindooDBAppBridge,
  MindooDBAppBridgeConnectMessage,
  MindooDBAppBridgeConnectedMessage,
  MindooDBAppBridgeErrorPayload,
  MindooDBAppBridgePortMessage,
  MindooDBAppBridgeRpcRequest,
  MindooDBAppBridgeThemeChangedMessage,
  MindooDBAppBridgeViewportChangedMessage,
  MindooDBAppCreateViewInput,
  MindooDBAppDatabase,
  MindooDBAppDatabaseInfo,
  MindooDBAppDocument,
  MindooDBAppDocumentApi,
  MindooDBAppDocumentHistoryEntry,
  MindooDBAppDocumentListQuery,
  MindooDBAppDocumentListResult,
  MindooDBAppHistoricalDocument,
  MindooDBAppHostTheme,
  MindooDBAppLaunchContext,
  MindooDBAppReadableAttachmentStream,
  MindooDBAppSession,
  MindooDBAppViewCategoryChildrenPageRequest,
  MindooDBAppViewDefinition,
  MindooDBAppViewExpansionState,
  MindooDBAppViewHandle,
  MindooDBAppViewLookupByPath,
  MindooDBAppViewPageRequest,
  MindooDBAppViewPageResult,
  MindooDBAppViewRow,
  MindooDBAppViewport,
  MindooDBAppWritableAttachmentStream,
} from "../types";

const PROTOCOL = "mindoodb-app-bridge";

type MaybePromise<T> = T | Promise<T>;
type MockViewApi = {
  create(definition: MindooDBAppViewDefinition): MaybePromise<MindooDBAppViewHandle>;
  open(viewId: string): MaybePromise<MindooDBAppViewHandle>;
};

function createBridgeErrorPayload(error: unknown, fallbackCode = "bridge-error"): MindooDBAppBridgeErrorPayload {
  if (error && typeof error === "object" && "message" in error) {
    const namedError = error as { name?: unknown; message?: unknown };
    const code = typeof namedError.name === "string" && namedError.name
      ? namedError.name
      : fallbackCode;
    const message = typeof namedError.message === "string"
      ? namedError.message
      : String(error);
    return { code, message };
  }
  return { code: fallbackCode, message: String(error) };
}

function cloneBytes(chunk: Uint8Array) {
  return new Uint8Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
}

function mergeLaunchContext(
  current: MindooDBAppLaunchContext,
  patch?: Partial<MindooDBAppLaunchContext>,
): MindooDBAppLaunchContext {
  if (!patch) {
    return {
      ...current,
      theme: { ...current.theme },
      viewport: current.viewport ? { ...current.viewport } : null,
      user: { ...current.user },
      launchParameters: { ...current.launchParameters },
      databases: current.databases.map((database) => ({
        ...database,
        capabilities: [...database.capabilities],
      })),
      views: current.views.map((view) => ({
        ...view,
        sources: view.sources.map((source) => ({ ...source })),
        columns: view.columns.map((column) => ({
          ...column,
          expression: column.expression.mode === "field"
            ? { ...column.expression }
            : { mode: "formula", expression: structuredClone(column.expression.expression) },
        })),
        filter: view.filter.mode === "rules"
          ? {
              mode: "rules",
              match: view.filter.match,
              rules: view.filter.rules.map((rule) => ({ ...rule })),
            }
          : {
              mode: "formula",
              expression: structuredClone(view.filter.expression),
            },
      })),
    };
  }
  return {
    ...current,
    ...patch,
    theme: patch.theme ? { ...current.theme, ...patch.theme } : { ...current.theme },
    viewport: patch.viewport === undefined
      ? (current.viewport ? { ...current.viewport } : null)
      : (patch.viewport ? { ...patch.viewport } : null),
    user: patch.user ? { ...current.user, ...patch.user } : { ...current.user },
    launchParameters: patch.launchParameters
      ? { ...current.launchParameters, ...patch.launchParameters }
      : { ...current.launchParameters },
    databases: patch.databases
      ? patch.databases.map((database) => ({
          ...database,
          capabilities: [...database.capabilities],
        }))
      : current.databases.map((database) => ({
          ...database,
          capabilities: [...database.capabilities],
        })),
    views: patch.views
      ? patch.views.map((view) => ({
          ...view,
          sources: view.sources.map((source) => ({ ...source })),
          columns: view.columns.map((column) => ({
            ...column,
            expression: column.expression.mode === "field"
              ? { ...column.expression }
              : { mode: "formula", expression: structuredClone(column.expression.expression) },
          })),
          filter: view.filter.mode === "rules"
            ? {
                mode: "rules",
                match: view.filter.match,
                rules: view.filter.rules.map((rule) => ({ ...rule })),
              }
            : {
                mode: "formula",
                expression: structuredClone(view.filter.expression),
              },
        }))
      : current.views.map((view) => ({
          ...view,
          sources: view.sources.map((source) => ({ ...source })),
          columns: view.columns.map((column) => ({
            ...column,
            expression: column.expression.mode === "field"
              ? { ...column.expression }
              : { mode: "formula", expression: structuredClone(column.expression.expression) },
          })),
          filter: view.filter.mode === "rules"
            ? {
                mode: "rules",
                match: view.filter.match,
                rules: view.filter.rules.map((rule) => ({ ...rule })),
              }
            : {
                mode: "formula",
                expression: structuredClone(view.filter.expression),
              },
        })),
  };
}

function createDefaultLaunchContext(patch?: Partial<MindooDBAppLaunchContext>): MindooDBAppLaunchContext {
  const base: MindooDBAppLaunchContext = {
    appId: "sample-app",
    appInstanceId: "sample-app-instance",
    appVersion: "1.0.0",
    launchId: "test-launch",
    runtime: "iframe",
    theme: {
      mode: "dark",
      preset: "mindoo",
    },
    viewport: {
      width: 1024,
      height: 768,
    },
    user: {
      id: "user-1",
      username: "Test User",
    },
    launchParameters: {},
    databases: [],
    views: [],
  };
  return mergeLaunchContext(base, patch);
}

function createDefaultReadableAttachmentStream(chunks: Uint8Array[] = []): MindooDBAppReadableAttachmentStream {
  const queue = chunks.map((chunk) => cloneBytes(chunk));
  let closed = false;
  return {
    async read() {
      if (closed) {
        return null;
      }
      const next = queue.shift();
      if (!next) {
        closed = true;
        return null;
      }
      return next;
    },
    async close() {
      closed = true;
      queue.splice(0);
    },
  };
}

function createDefaultWritableAttachmentStream(): MindooDBAppWritableAttachmentStream {
  let closed = false;
  return {
    async write() {
      if (closed) {
        throw new Error("The attachment write stream is already closed.");
      }
    },
    async close() {
      closed = true;
    },
    async abort() {
      closed = true;
    },
  };
}

type MockStoredDocument = MindooDBAppDocument & {
  isDeleted: boolean;
  updatedAt?: string;
};

function getFieldValue(source: Record<string, unknown>, field: string) {
  return field.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

function matchesDocumentFilter(document: MockStoredDocument, filter?: Record<string, unknown>) {
  if (!filter) {
    return true;
  }
  return Object.entries(filter).every(([field, expected]) => getFieldValue(document.data, field) === expected);
}

function decodeMockListCursor(cursor?: string | null) {
  if (!cursor) {
    return 0;
  }
  const offset = Number.parseInt(cursor, 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

function createDefaultViewHandle(): MindooDBAppViewHandle {
  const definition: MindooDBAppViewDefinition = {
    title: "Mock View",
    columns: [],
  };
  const expansion: MindooDBAppViewExpansionState = {
    mode: "collapsed",
    ids: [],
  };
  const emptyPage: MindooDBAppViewPageResult = {
    rows: [],
    nextPosition: null,
    hasMore: false,
  };
  return {
    async getDefinition() {
      return definition;
    },
    async refresh() {},
    async page(_input?: MindooDBAppViewPageRequest) {
      return emptyPage;
    },
    async getExpansionState() {
      return expansion;
    },
    async setExpansionState(state: MindooDBAppViewExpansionState) {
      return state;
    },
    async expand(rowKey: string) {
      return {
        mode: "collapsed",
        ids: [rowKey],
      };
    },
    async collapse(_rowKey: string) {
      return expansion;
    },
    async expandAll() {
      return {
        mode: "expanded",
        ids: [],
      };
    },
    async collapseAll() {
      return expansion;
    },
    async getRow(_rowKey: string) {
      return null;
    },
    async getCategory(_input: MindooDBAppViewLookupByPath) {
      return null;
    },
    async pageCategory(_categoryKey: string, _input?: MindooDBAppViewCategoryChildrenPageRequest) {
      return emptyPage;
    },
    async listCategoryDocumentIds(_categoryKey: string) {
      return [];
    },
    async dispose() {},
  };
}

type MockDatabaseMethods = {
  documents?: Partial<MindooDBAppDocumentApi>;
  views?: Partial<MockViewApi>;
  attachments?: Partial<MindooDBAppAttachmentApi>;
};

function createDatabaseHandle(definition: MockMindooDBAppDatabaseDefinition): MindooDBAppDatabase {
  let createCounter = 0;
  const defaultViewFactory = async () => createDefaultViewHandle();
  const storedDocuments = new Map<string, MockStoredDocument>();

  const defaultDocuments: MindooDBAppDocumentApi = {
    async list(query?: MindooDBAppDocumentListQuery): Promise<MindooDBAppDocumentListResult> {
      const status = query?.status ?? "existing";
      const skip = Math.max(0, query?.skip ?? 0);
      const limit = Math.max(1, query?.limit ?? 50);
      const offset = decodeMockListCursor(query?.cursor) + skip;
      const metadataOnly = query?.metadataOnly ?? false;

      const items = Array.from(storedDocuments.values())
        .filter((document) => status === "all" ? true : status === "deleted" ? document.isDeleted : !document.isDeleted)
        .filter((document) => metadataOnly ? true : matchesDocumentFilter(document, query?.filter))
        .sort((left, right) => left.id.localeCompare(right.id));
      const page = items.slice(offset, offset + limit).map((document) => {
        if (metadataOnly) {
          return {
            id: document.id,
            isDeleted: document.isDeleted,
          };
        }
        const projectedData = query?.fields
          ? Object.fromEntries(query.fields.map((field) => [field, getFieldValue(document.data, field)]))
          : document.data;
        return {
          id: document.id,
          data: projectedData,
          attachmentCount: document.attachments?.length ?? 0,
          updatedAt: document.updatedAt,
          isDeleted: status !== "existing" ? document.isDeleted : undefined,
        };
      });
      const nextCursor = offset + page.length < items.length ? String(offset + page.length) : null;
      return {
        items: page,
        nextCursor,
      };
    },
    async get(_docId: string): Promise<MindooDBAppDocument | null> {
      const document = storedDocuments.get(_docId);
      if (!document || document.isDeleted) {
        return null;
      }
      return {
        id: document.id,
        data: structuredClone(document.data),
        attachments: document.attachments ? structuredClone(document.attachments) : [],
        updatedAt: document.updatedAt,
      };
    },
    async create(input) {
      createCounter += 1;
      const createdAt = new Date().toISOString();
      const created = {
        id: `doc-${createCounter}`,
        data: { ...input.data },
        attachments: [],
        updatedAt: createdAt,
      };
      storedDocuments.set(created.id, {
        ...created,
        data: structuredClone(created.data),
        attachments: [],
        isDeleted: false,
      });
      return {
        ...created,
      };
    },
    async update(docId, patch) {
      const updatedAt = new Date().toISOString();
      const existing = storedDocuments.get(docId);
      const updated = {
        id: docId,
        data: { ...patch.data },
        attachments: existing?.attachments ? structuredClone(existing.attachments) : [],
        updatedAt,
      };
      storedDocuments.set(docId, {
        ...updated,
        data: structuredClone(updated.data),
        attachments: updated.attachments ? structuredClone(updated.attachments) : [],
        isDeleted: false,
      });
      return updated;
    },
    async delete(_docId: string) {
      const existing = storedDocuments.get(_docId);
      if (existing) {
        storedDocuments.set(_docId, {
          ...existing,
          isDeleted: true,
          updatedAt: new Date().toISOString(),
        });
      }
      return { ok: true as const };
    },
    async listHistory(_docId: string): Promise<MindooDBAppDocumentHistoryEntry[]> {
      return [];
    },
    async getAtTimestamp(docId: string, timestamp: number): Promise<MindooDBAppHistoricalDocument> {
      return {
        id: docId,
        timestamp,
        state: "missing",
        data: null,
      };
    },
  };

  const defaultViews: MockViewApi = {
    async create(_definition: MindooDBAppViewDefinition) {
      return await defaultViewFactory();
    },
    async open(_viewId: string) {
      return await defaultViewFactory();
    },
  };

  const defaultAttachments: MindooDBAppAttachmentApi = {
    async list(_docId: string) {
      return [];
    },
    async remove(_docId: string, _attachmentName: string) {
      return { ok: true as const };
    },
    async openReadStream(_docId: string, _attachmentName: string) {
      return createDefaultReadableAttachmentStream();
    },
    async openWriteStream(_docId: string, _attachmentName: string, _contentType?: string) {
      return createDefaultWritableAttachmentStream();
    },
    async openPreview(_docId: string, _attachmentName: string, _options?: { timestamp?: number }) {
      return { ok: true as const };
    },
  };

  const methods: MockDatabaseMethods = definition.methods ?? {};

  return {
    async info() {
      return { ...definition.info, capabilities: [...definition.info.capabilities] };
    },
    documents: {
      ...defaultDocuments,
      ...methods.documents,
    },
    attachments: {
      ...defaultAttachments,
      ...methods.attachments,
    },
  };
}

type MockSessionState = {
  getLaunchContext: () => MindooDBAppLaunchContext;
  setLaunchContext: (patch?: Partial<MindooDBAppLaunchContext>) => MindooDBAppLaunchContext;
  listDatabaseInfos: () => MindooDBAppDatabaseInfo[];
  setDatabases: (definitions: MockMindooDBAppDatabaseDefinition[]) => void;
  getDatabase: (databaseId: string) => MindooDBAppDatabase;
  createView: (input: MindooDBAppCreateViewInput) => Promise<MindooDBAppViewHandle>;
  openView: (viewId: string) => Promise<MindooDBAppViewHandle>;
  bridge: MindooDBAppBridge;
  session: MindooDBAppSession;
  emitThemeChange: (theme: MindooDBAppHostTheme) => void;
  emitViewportChange: (viewport: MindooDBAppViewport) => void;
};

function createMockSessionState(options: CreateMockMindooDBAppSessionOptions = {}): MockSessionState {
  let launchContext = createDefaultLaunchContext(options.launchContext);
  const themeListeners = new Set<(theme: MindooDBAppHostTheme) => void>();
  const viewportListeners = new Set<(viewport: MindooDBAppViewport) => void>();
  const databaseHandles = new Map<string, MindooDBAppDatabase>();
  const databaseViewApis = new Map<string, MockViewApi>();
  const sessionViews = new Map<string, MindooDBAppViewHandle>();
  let databaseInfos: MindooDBAppDatabaseInfo[] = [];

  const setDatabases = (definitions: MockMindooDBAppDatabaseDefinition[]) => {
    databaseHandles.clear();
    databaseViewApis.clear();
    databaseInfos = definitions.map((definition) => ({
      ...definition.info,
      capabilities: [...definition.info.capabilities],
    }));
    for (const definition of definitions) {
      databaseHandles.set(definition.info.id, createDatabaseHandle(definition));
      databaseViewApis.set(definition.info.id, {
        async create(_definition: MindooDBAppViewDefinition) {
          return await createDefaultViewHandle();
        },
        async open(_viewId: string) {
          return await createDefaultViewHandle();
        },
        ...(definition.methods?.views ?? {}),
      });
    }
    launchContext = mergeLaunchContext(launchContext, { databases: databaseInfos });
  };

  setDatabases(options.databases ?? []);

  const session: MindooDBAppSession = {
    async getLaunchContext() {
      return mergeLaunchContext(launchContext);
    },
    async listDatabases() {
      return databaseInfos.map((entry) => ({
        ...entry,
        capabilities: [...entry.capabilities],
      }));
    },
    async openDatabase(databaseId: string) {
      const database = databaseHandles.get(databaseId);
      if (!database) {
        throw new Error(`Unknown test database: ${databaseId}`);
      }
      return database;
    },
    async createView(input) {
      const api = databaseViewApis.get(input.databaseId);
      if (!api) {
        throw new Error(`Unknown test database for view creation: ${input.databaseId}`);
      }
      const view = await api.create(input.definition);
      const viewId = input.definition.id || crypto.randomUUID();
      sessionViews.set(viewId, view);
      return view;
    },
    async openView(viewId) {
      const existing = sessionViews.get(viewId);
      if (existing) {
        return existing;
      }
      const sourceDatabaseId = launchContext.views.find((view) => view.id === viewId)?.sources[0]?.databaseId;
      if (!sourceDatabaseId) {
        throw new Error(`Unknown test view: ${viewId}`);
      }
      const api = databaseViewApis.get(sourceDatabaseId);
      if (!api) {
        throw new Error(`Unknown test database for view ${viewId}: ${sourceDatabaseId}`);
      }
      const view = await api.open(viewId);
      sessionViews.set(viewId, view);
      return view;
    },
    onThemeChange(listener) {
      themeListeners.add(listener);
      return () => {
        themeListeners.delete(listener);
      };
    },
    onViewportChange(listener) {
      viewportListeners.add(listener);
      return () => {
        viewportListeners.delete(listener);
      };
    },
    async disconnect() {
      await options.onDisconnect?.();
    },
  };

  const bridge: MindooDBAppBridge = {
    async connect() {
      return session;
    },
  };

  return {
    getLaunchContext() {
      return mergeLaunchContext(launchContext);
    },
    setLaunchContext(patch) {
      launchContext = mergeLaunchContext(launchContext, patch);
      return mergeLaunchContext(launchContext);
    },
    listDatabaseInfos() {
      return databaseInfos.map((entry) => ({
        ...entry,
        capabilities: [...entry.capabilities],
      }));
    },
    setDatabases,
    getDatabase(databaseId) {
      const database = databaseHandles.get(databaseId);
      if (!database) {
        throw new Error(`Unknown test database: ${databaseId}`);
      }
      return database;
    },
    createView: session.createView,
    openView: session.openView,
    bridge,
    session,
    emitThemeChange(theme) {
      launchContext = mergeLaunchContext(launchContext, { theme });
      themeListeners.forEach((listener) => listener({ ...launchContext.theme }));
    },
    emitViewportChange(viewport) {
      launchContext = mergeLaunchContext(launchContext, { viewport });
      viewportListeners.forEach((listener) => listener({ ...viewport }));
    },
  };
}

export interface MockMindooDBAppDatabaseDefinition {
  info: MindooDBAppDatabaseInfo;
  methods?: MockDatabaseMethods;
}

export interface CreateMockMindooDBAppSessionOptions {
  launchContext?: Partial<MindooDBAppLaunchContext>;
  databases?: MockMindooDBAppDatabaseDefinition[];
  onDisconnect?: () => MaybePromise<void>;
}

export interface MockMindooDBAppSessionController {
  bridge: MindooDBAppBridge;
  session: MindooDBAppSession;
  getLaunchContext(): MindooDBAppLaunchContext;
  setLaunchContext(patch?: Partial<MindooDBAppLaunchContext>): MindooDBAppLaunchContext;
  listDatabases(): MindooDBAppDatabaseInfo[];
  setDatabases(definitions: MockMindooDBAppDatabaseDefinition[]): void;
  emitThemeChange(theme: MindooDBAppHostTheme): void;
  emitViewportChange(viewport: MindooDBAppViewport): void;
}

export function createMockMindooDBAppSession(
  options: CreateMockMindooDBAppSessionOptions = {},
): MockMindooDBAppSessionController {
  const state = createMockSessionState(options);
  return {
    bridge: state.bridge,
    session: state.session,
    getLaunchContext: state.getLaunchContext,
    setLaunchContext: state.setLaunchContext,
    listDatabases: state.listDatabaseInfos,
    setDatabases: state.setDatabases,
    emitThemeChange: state.emitThemeChange,
    emitViewportChange: state.emitViewportChange,
  };
}

export function createMockMindooDBAppBridge(
  options: CreateMockMindooDBAppSessionOptions = {},
): MockMindooDBAppSessionController {
  return createMockMindooDBAppSession(options);
}

export type FakeBridgeRequestHandler = (
  params: unknown,
  context: {
    host: FakeBridgeHostController;
    request: MindooDBAppBridgeRpcRequest;
    port: MessagePort;
  },
) => MaybePromise<unknown>;

export type FakeBridgePortMessageHandler = (
  message: Exclude<MindooDBAppBridgePortMessage, MindooDBAppBridgeRpcRequest>,
  context: {
    host: FakeBridgeHostController;
    port: MessagePort;
  },
) => MaybePromise<boolean | void>;

export interface CreateFakeBridgeHostOptions extends CreateMockMindooDBAppSessionOptions {
  windowMode?: "parent" | "opener";
  requestHandlers?: Record<string, FakeBridgeRequestHandler>;
  onPortMessage?: FakeBridgePortMessageHandler;
}

export interface FakeBridgeHostController {
  bridge: MindooDBAppBridge;
  session: MindooDBAppSession;
  readonly launchId: string;
  readonly requests: ReadonlyArray<MindooDBAppBridgeRpcRequest>;
  install(): void;
  dispose(): void;
  emitThemeChange(theme: MindooDBAppHostTheme): void;
  emitViewportChange(viewport: MindooDBAppViewport): void;
  postPortMessage(message: MindooDBAppBridgePortMessage, transfer?: Transferable[]): void;
  setRequestHandler(method: string, handler: FakeBridgeRequestHandler): void;
  clearRequestHandler(method: string): void;
}

export function createFakeBridgeHost(options: CreateFakeBridgeHostOptions = {}): FakeBridgeHostController {
  const state = createMockSessionState(options);
  const customRequestHandlers = new Map(Object.entries(options.requestHandlers ?? {}));
  const requests: MindooDBAppBridgeRpcRequest[] = [];
  const connectedPorts = new Set<MessagePort>();
  const viewSessions = new Map<string, MindooDBAppViewHandle>();
  const readStreams = new Map<string, MindooDBAppReadableAttachmentStream>();
  const writeStreams = new Map<string, MindooDBAppWritableAttachmentStream>();
  let viewCounter = 0;
  let streamCounter = 0;
  let previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  let previousWindowValue: unknown = typeof window === "undefined" ? undefined : window;
  let installed = false;

  const hostWindow = {
    postMessage(message: unknown, _targetOrigin?: string, transfer?: Transferable[]) {
      const payload = message as MindooDBAppBridgeConnectMessage | undefined;
      if (!payload || payload.protocol !== PROTOCOL || payload.type !== "mindoodb-app:connect") {
        return;
      }
      if (payload.launchId !== state.getLaunchContext().launchId) {
        return;
      }
      const port = transfer?.[0] as MessagePort | undefined;
      if (!port) {
        throw new Error("Expected the bridge connection to transfer a MessagePort.");
      }
      connectedPorts.add(port);
      port.addEventListener("message", (event: MessageEvent<unknown>) => {
        void handlePortMessage(port, event.data);
      });
      port.start();
      const connected: MindooDBAppBridgeConnectedMessage = {
        protocol: PROTOCOL,
        type: "mindoodb-app:connected",
      };
      port.postMessage(connected);
    },
  };

  function getWindowSearch() {
    return `?mindoodbAppLaunchId=${encodeURIComponent(state.getLaunchContext().launchId)}`;
  }

  function restoreWindow() {
    if (!installed) {
      return;
    }
    connectedPorts.forEach((port) => {
      port.close();
    });
    connectedPorts.clear();
    if (previousWindowDescriptor) {
      Object.defineProperty(globalThis, "window", previousWindowDescriptor);
    } else if (previousWindowValue !== undefined) {
      Object.defineProperty(globalThis, "window", {
        value: previousWindowValue,
        configurable: true,
        writable: true,
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    installed = false;
  }

  function install() {
    if (installed) {
      return;
    }
    previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    previousWindowValue = typeof window === "undefined" ? undefined : window;
    const baseWindow = typeof window === "undefined" ? {} : window;
    const nextWindow = Object.create(baseWindow as object);
    Object.defineProperties(nextWindow, {
      parent: {
        value: options.windowMode === "opener" ? baseWindow : hostWindow,
        configurable: true,
      },
      opener: {
        value: options.windowMode === "opener" ? hostWindow : null,
        configurable: true,
      },
      location: {
        value: {
          search: getWindowSearch(),
        },
        configurable: true,
      },
      setTimeout: {
        value: typeof window !== "undefined" && typeof window.setTimeout === "function"
          ? window.setTimeout.bind(window)
          : setTimeout,
        configurable: true,
      },
      clearTimeout: {
        value: typeof window !== "undefined" && typeof window.clearTimeout === "function"
          ? window.clearTimeout.bind(window)
          : clearTimeout,
        configurable: true,
      },
    });
    Object.defineProperty(globalThis, "window", {
      value: nextWindow,
      configurable: true,
      writable: true,
    });
    installed = true;
  }

  async function resolveViewHandle(viewId: string) {
    const existing = viewSessions.get(viewId);
    if (existing) {
      return existing;
    }
    const handle = await state.openView(viewId);
    viewSessions.set(viewId, handle);
    return handle;
  }

  function postRpcSuccess(port: MessagePort, requestId: string, result: unknown) {
    port.postMessage({
      protocol: PROTOCOL,
      kind: "success",
      id: requestId,
      result,
    });
  }

  function postRpcError(port: MessagePort, requestId: string, error: MindooDBAppBridgeErrorPayload) {
    port.postMessage({
      protocol: PROTOCOL,
      kind: "error",
      id: requestId,
      error,
    });
  }

  function postStreamAck(port: MessagePort, streamId: string) {
    port.postMessage({
      protocol: PROTOCOL,
      kind: "stream-ack",
      streamId,
    });
  }

  function postStreamError(port: MessagePort, streamId: string, error: MindooDBAppBridgeErrorPayload) {
    port.postMessage({
      protocol: PROTOCOL,
      kind: "stream-error",
      streamId,
      error,
    });
  }

  async function handleBuiltinRequest(request: MindooDBAppBridgeRpcRequest) {
    const params = request.params as Record<string, unknown>;
    switch (request.method) {
      case "session.getLaunchContext":
        return state.getLaunchContext();
      case "session.listDatabases":
        return state.listDatabaseInfos();
      case "session.openDatabase":
        state.getDatabase(String(params.databaseId));
        return { ok: true };
      case "session.createView": {
        const viewId = `view-${viewCounter += 1}`;
        const handle = await state.createView({
          databaseId: String(params.databaseId),
          definition: params.definition as MindooDBAppViewDefinition,
        });
        viewSessions.set(viewId, handle);
        return { viewId };
      }
      case "session.openView":
        await state.openView(String(params.viewId));
        return { ok: true };
      case "session.disconnect":
        await state.session.disconnect();
        return { ok: true };
      case "documents.list":
        return await state.getDatabase(String(params.databaseId)).documents.list(params.query as MindooDBAppDocumentListQuery | undefined);
      case "documents.get":
        return await state.getDatabase(String(params.databaseId)).documents.get(String(params.docId));
      case "documents.create":
        return await state.getDatabase(String(params.databaseId)).documents.create(params.input as {
          data: Record<string, unknown>;
          decryptionKeyId?: string;
        });
      case "documents.update":
        return await state.getDatabase(String(params.databaseId)).documents.update(
          String(params.docId),
          params.patch as { data: Record<string, unknown> },
        );
      case "documents.delete":
        return await state.getDatabase(String(params.databaseId)).documents.delete(String(params.docId));
      case "documents.history.list":
        return await state.getDatabase(String(params.databaseId)).documents.listHistory(String(params.docId));
      case "documents.history.getAtTimestamp":
        return await state.getDatabase(String(params.databaseId)).documents.getAtTimestamp(
          String(params.docId),
          Number(params.timestamp),
        );
      case "attachments.list":
        return await state.getDatabase(String(params.databaseId)).attachments.list(String(params.docId));
      case "attachments.remove":
        return await state.getDatabase(String(params.databaseId)).attachments.remove(
          String(params.docId),
          String(params.attachmentName),
        );
      case "attachments.openReadStream": {
        const stream = await state.getDatabase(String(params.databaseId)).attachments.openReadStream(
          String(params.docId),
          String(params.attachmentName),
        );
        const streamId = `read-${streamCounter += 1}`;
        readStreams.set(streamId, stream);
        return { streamId };
      }
      case "attachments.openWriteStream": {
        const stream = await state.getDatabase(String(params.databaseId)).attachments.openWriteStream(
          String(params.docId),
          String(params.attachmentName),
          typeof params.contentType === "string" ? params.contentType : undefined,
        );
        const streamId = `write-${streamCounter += 1}`;
        writeStreams.set(streamId, stream);
        return { streamId };
      }
      case "attachments.openPreview":
        return await state.getDatabase(String(params.databaseId)).attachments.openPreview(
          String(params.docId),
          String(params.attachmentName),
          typeof params.timestamp === "number" ? { timestamp: params.timestamp } : undefined,
        );
      case "views.getDefinition":
        return await (await resolveViewHandle(String(params.viewId))).getDefinition();
      case "views.refresh":
        return await (await resolveViewHandle(String(params.viewId))).refresh();
      case "views.page":
        return await (await resolveViewHandle(String(params.viewId))).page(
          params.request as MindooDBAppViewPageRequest | undefined,
        );
      case "views.expansion.get":
        return await (await resolveViewHandle(String(params.viewId))).getExpansionState();
      case "views.expansion.set":
        return await (await resolveViewHandle(String(params.viewId))).setExpansionState(
          params.expansion as MindooDBAppViewExpansionState,
        );
      case "views.expansion.expand":
        return await (await resolveViewHandle(String(params.viewId))).expand(String(params.rowKey));
      case "views.expansion.collapse":
        return await (await resolveViewHandle(String(params.viewId))).collapse(String(params.rowKey));
      case "views.expansion.expandAll":
        return await (await resolveViewHandle(String(params.viewId))).expandAll();
      case "views.expansion.collapseAll":
        return await (await resolveViewHandle(String(params.viewId))).collapseAll();
      case "views.row.get":
        return await (await resolveViewHandle(String(params.viewId))).getRow(String(params.rowKey));
      case "views.category.get":
        return await (await resolveViewHandle(String(params.viewId))).getCategory(
          params.lookup as MindooDBAppViewLookupByPath,
        );
      case "views.category.page":
        return await (await resolveViewHandle(String(params.viewId))).pageCategory(
          String(params.categoryKey),
          params.request as MindooDBAppViewCategoryChildrenPageRequest | undefined,
        );
      case "views.category.documentIds":
        return await (await resolveViewHandle(String(params.viewId))).listCategoryDocumentIds(
          String(params.categoryKey),
        );
      case "views.dispose": {
        const key = String(params.viewId);
        const handle = await resolveViewHandle(String(params.viewId));
        await handle.dispose();
        viewSessions.delete(key);
        return undefined;
      }
      default:
        return undefined;
    }
  }

  async function handleStreamMessage(
    port: MessagePort,
    message: Exclude<MindooDBAppBridgePortMessage, MindooDBAppBridgeRpcRequest>,
  ) {
    if (message.kind === "stream-read") {
      const stream = readStreams.get(message.streamId);
      if (!stream) {
        throw Object.assign(new Error(`Unknown read stream: ${message.streamId}`), { name: "stream-not-found" });
      }
      const chunk = await stream.read();
      port.postMessage({
        protocol: PROTOCOL,
        kind: "stream-chunk",
        streamId: message.streamId,
        chunk: chunk ? cloneBytes(chunk).buffer : undefined,
        done: !chunk,
      });
      if (!chunk) {
        readStreams.delete(message.streamId);
      }
      return true;
    }
    if (message.kind === "stream-write") {
      const stream = writeStreams.get(message.streamId);
      if (!stream) {
        throw Object.assign(new Error(`Unknown write stream: ${message.streamId}`), { name: "stream-not-found" });
      }
      await stream.write(new Uint8Array(message.chunk));
      postStreamAck(port, message.streamId);
      return true;
    }
    if (message.kind === "stream-close") {
      const readStream = readStreams.get(message.streamId);
      if (readStream) {
        await readStream.close();
        readStreams.delete(message.streamId);
        postStreamAck(port, message.streamId);
        return true;
      }
      const writeStream = writeStreams.get(message.streamId);
      if (writeStream) {
        await writeStream.close();
        writeStreams.delete(message.streamId);
        postStreamAck(port, message.streamId);
        return true;
      }
      throw Object.assign(new Error(`Unknown stream: ${message.streamId}`), { name: "stream-not-found" });
    }
    if (message.kind === "stream-abort") {
      const stream = writeStreams.get(message.streamId);
      if (!stream) {
        throw Object.assign(new Error(`Unknown write stream: ${message.streamId}`), { name: "stream-not-found" });
      }
      await stream.abort();
      writeStreams.delete(message.streamId);
      postStreamAck(port, message.streamId);
      return true;
    }
    return false;
  }

  async function handlePortMessage(port: MessagePort, rawMessage: unknown) {
    const message = rawMessage as MindooDBAppBridgePortMessage | undefined;
    if (!message || message.protocol !== PROTOCOL) {
      return;
    }
    if (message.kind === "request") {
      requests.push(message);
      try {
        const customHandler = customRequestHandlers.get(message.method);
        if (customHandler) {
          const result = await customHandler(message.params, { host: controller, request: message, port });
          postRpcSuccess(port, message.id, result);
          return;
        }
        const builtinResult = await handleBuiltinRequest(message);
        if (builtinResult === undefined && message.method !== "views.dispose") {
          postRpcError(port, message.id, {
            code: "unsupported-method",
            message: `No fake bridge handler is configured for ${message.method}.`,
          });
          return;
        }
        postRpcSuccess(port, message.id, builtinResult);
      } catch (error) {
        postRpcError(port, message.id, createBridgeErrorPayload(error));
      }
      return;
    }

    try {
      const handledByCustom = await options.onPortMessage?.(message, { host: controller, port });
      if (handledByCustom) {
        return;
      }
      const handled = await handleStreamMessage(port, message);
      if (!handled) {
        throw Object.assign(new Error(`No fake bridge port handler is configured for ${message.kind}.`), {
          name: "unsupported-message",
        });
      }
    } catch (error) {
      const streamId = "streamId" in message ? String(message.streamId) : "unknown";
      postStreamError(port, streamId, createBridgeErrorPayload(error));
    }
  }

  const controller: FakeBridgeHostController = {
    bridge: state.bridge,
    session: state.session,
    get launchId() {
      return state.getLaunchContext().launchId;
    },
    get requests() {
      return requests;
    },
    install,
    dispose() {
      restoreWindow();
      viewSessions.clear();
      readStreams.clear();
      writeStreams.clear();
    },
    emitThemeChange(theme) {
      state.emitThemeChange(theme);
      const payload: MindooDBAppBridgeThemeChangedMessage = {
        protocol: PROTOCOL,
        kind: "theme-changed",
        theme,
      };
      connectedPorts.forEach((port) => port.postMessage(payload));
    },
    emitViewportChange(viewport) {
      state.emitViewportChange(viewport);
      const payload: MindooDBAppBridgeViewportChangedMessage = {
        protocol: PROTOCOL,
        kind: "viewport-changed",
        viewport,
      };
      connectedPorts.forEach((port) => port.postMessage(payload));
    },
    postPortMessage(message, transfer = []) {
      connectedPorts.forEach((port) => port.postMessage(message, transfer));
    },
    setRequestHandler(method, handler) {
      customRequestHandlers.set(method, handler);
    },
    clearRequestHandler(method) {
      customRequestHandlers.delete(method);
    },
  };

  return controller;
}
