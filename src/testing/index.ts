import * as Automerge from "@automerge/automerge";
import type {
  MindooDBAppAttachmentApi,
  MindooDBAppBridge,
  MindooDBAppBridgeConnectMessage,
  MindooDBAppBridgeConnectedMessage,
  MindooDBAppBridgeErrorPayload,
  MindooDBAppBridgePortMessage,
  MindooDBAppBridgeRpcRequest,
  MindooDBAppAccessDecision,
  MindooDBAppBridgeLocaleChangedMessage,
  MindooDBAppBridgeThemeChangedMessage,
  MindooDBAppBridgeUiPreferencesChangedMessage,
  MindooDBAppBridgeViewportChangedMessage,
  MindooDBAppCreateViewNavigatorInput,
  MindooDBAppDatabase,
  MindooDBAppDatabaseInfo,
  MindooDBAppDocument,
  MindooDBAppDocumentApi,
  MindooDBAppDocumentHeadCursorResult,
  MindooDBAppDocumentHistoryEntry,
  MindooDBAppDocumentListQuery,
  MindooDBAppDocumentListResult,
  MindooDBAppDocumentScanPreset,
  MindooDBAppHistoricalDocument,
  MindooDBAppHostTheme,
  MindooDBAppLaunchContext,
  MindooDBAppMenuApi,
  MindooDBAppReadableAttachmentStream,
  MindooDBAppScopedDocId,
  MindooDBAppScopedDocumentSummary,
  MindooDBAppSession,
  MindooDBAppShowMenuInput,
  MindooDBAppShowMenuResult,
  MindooDBAppViewDefinition,
  MindooDBAppViewEntry,
  MindooDBAppViewNavigator,
  MindooDBAppViewNavigatorExpansionState,
  MindooDBAppViewNavigatorOpenOptions,
  MindooDBAppViewNavigatorPageOptions,
  MindooDBAppViewNavigatorPageResult,
  MindooDBAppViewNavigatorRangeQuery,
  MindooDBAppViewNavigatorSelectionState,
  MindooDBAppViewCursorDocumentListResult,
  MindooDBAppViewport,
  MindooDBAppUiPreferences,
  MindooDBAppUpdateDocumentInput,
  MindooDBAppWritableAttachmentStream,
} from "../types";

const PROTOCOL = "mindoodb-app-bridge";

type MaybePromise<T> = T | Promise<T>;
type MockViewApi = {
  create(
    input: MindooDBAppCreateViewNavigatorInput,
  ): MaybePromise<MindooDBAppViewNavigator>;
  open(
    viewId: string,
    options?: MindooDBAppViewNavigatorOpenOptions,
  ): MaybePromise<MindooDBAppViewNavigator>;
};

function createBridgeErrorPayload(
  error: unknown,
  fallbackCode = "bridge-error",
): MindooDBAppBridgeErrorPayload {
  if (error && typeof error === "object" && "message" in error) {
    const namedError = error as { name?: unknown; message?: unknown };
    const code =
      typeof namedError.name === "string" && namedError.name
        ? namedError.name
        : fallbackCode;
    const message =
      typeof namedError.message === "string"
        ? namedError.message
        : String(error);
    return { code, message };
  }
  return { code: fallbackCode, message: String(error) };
}

function cloneBytes(chunk: Uint8Array) {
  return new Uint8Array(
    chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
  );
}

function applyDocumentUpdatePatch(
  current: Record<string, unknown>,
  patch: MindooDBAppUpdateDocumentInput,
) {
  const next = {
    ...structuredClone(current),
    ...(patch.set ? structuredClone(patch.set) : {}),
  };
  for (const key of patch.unset ?? []) {
    Reflect.deleteProperty(next, key);
  }
  applyMockJsonPatch(next, patch.json);
  for (const textPatch of patch.text ?? []) {
    applyMockTextPatch(next, textPatch.path, textPatch.edits);
  }
  for (const richTextPatch of patch.richText ?? []) {
    const spans = richTextPatch.spansSequence?.at(-1) ?? richTextPatch.spans ?? [];
    setValueAtPath(next, richTextPatch.path, structuredClone(spans));
  }
  for (const richTextStepPatch of patch.richTextSteps ?? []) {
    applyMockRichTextSteps(next, richTextStepPatch.path, richTextStepPatch.steps);
  }
  return next;
}

function applyMockJsonPatch(
  target: Record<string, unknown>,
  patch: MindooDBAppUpdateDocumentInput["json"],
) {
  if (!patch) {
    return;
  }
  for (const operation of patch.set ?? []) {
    setValueAtPath(target, operation.path, structuredClone(operation.value));
  }
  for (const operation of patch.unset ?? []) {
    unsetValueAtPath(target, operation.path);
  }
  for (const operation of patch.listDelete ?? []) {
    const list = readListAtPath(target, operation.path);
    list.splice(operation.index, operation.deleteCount);
  }
  for (const operation of patch.listInsert ?? []) {
    const list = readListAtPath(target, operation.path);
    list.splice(operation.index, 0, ...structuredClone(operation.values));
  }
  for (const operation of patch.textSplice ?? []) {
    applyMockTextPatch(target, operation.path, [{
      index: operation.index,
      deleteCount: operation.deleteCount,
      ...(operation.insert !== undefined ? { insert: operation.insert } : {}),
    }]);
  }
  for (const operation of patch.textMark ?? []) {
    applyMockTextMarks(target, operation.path, operation.index, operation.length, operation.marks, false);
  }
  for (const operation of patch.textUnmark ?? []) {
    applyMockTextMarks(target, operation.path, operation.index, operation.length, Object.fromEntries(operation.names.map((name) => [name, null])), true);
  }
}

function setValueAtPath(
  target: Record<string, unknown>,
  path: Array<string | number>,
  value: unknown,
) {
  if (path.length === 0) {
    throw new Error("JSON set path must contain at least one segment");
  }
  const parent = ensureParentAtPath(target, path);
  parent[path[path.length - 1]] = value;
}

function unsetValueAtPath(
  target: Record<string, unknown>,
  path: Array<string | number>,
) {
  if (path.length === 0) {
    throw new Error("JSON unset path must contain at least one segment");
  }
  const parent = readParentAtPath(target, path);
  Reflect.deleteProperty(parent, path[path.length - 1]);
}

function readListAtPath(
  target: Record<string, unknown>,
  path: Array<string | number>,
) {
  let value: any = target;
  for (const segment of path) {
    value = value?.[segment];
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `Cannot apply list operation to non-array value at ${path.map(String).join(".")}`,
    );
  }
  return value;
}

function ensureParentAtPath(
  target: Record<string, unknown>,
  path: Array<string | number>,
) {
  let parent: any = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const nextSegment = path[index + 1];
    if (parent[segment] == null) {
      parent[segment] = typeof nextSegment === "number" ? [] : {};
    }
    parent = parent[segment];
  }
  return parent;
}

function readParentAtPath(
  target: Record<string, unknown>,
  path: Array<string | number>,
) {
  let parent: any = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    parent = parent?.[path[index]];
  }
  if (parent == null || typeof parent !== "object") {
    throw new Error(
      `Cannot resolve JSON parent at ${path.map(String).join(".")}`,
    );
  }
  return parent;
}

function applyMockTextPatch(
  target: Record<string, unknown>,
  path: Array<string | number>,
  edits: NonNullable<MindooDBAppUpdateDocumentInput["text"]>[number]["edits"],
) {
  if (path.length === 0) {
    throw new Error("Text patch path must contain at least one segment");
  }
  let parent: any = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const nextSegment = path[index + 1];
    if (parent[segment] == null) {
      parent[segment] = typeof nextSegment === "number" ? [] : {};
    }
    parent = parent[segment];
  }
  const leaf = path[path.length - 1];
  let value = parent[leaf];
  if (value == null) {
    value = "";
  }
  if (typeof value !== "string") {
    throw new Error(
      `Cannot apply text patch to non-string value at ${path.map(String).join(".")}`,
    );
  }
  for (const edit of edits) {
    value =
      value.slice(0, edit.index) +
      (edit.insert ?? "") +
      value.slice(edit.index + edit.deleteCount);
  }
  parent[leaf] = value;
}

function applyMockTextMarks(
  target: Record<string, unknown>,
  path: Array<string | number>,
  index: number,
  length: number,
  marks: Record<string, unknown>,
  remove: boolean,
) {
  const parent = ensureParentAtPath(target, path);
  const leaf = path[path.length - 1];
  const marksKey = `${String(leaf)}__marks`;
  const existing = Array.isArray(parent[marksKey])
    ? parent[marksKey] as unknown[]
    : [];
  parent[marksKey] = [
    ...existing,
    {
      index,
      length,
      marks: structuredClone(marks),
      remove,
    },
  ];
}

function readRichTextSpansAtPath(
  target: Record<string, unknown>,
  path: Array<string | number>,
) {
  let value: unknown = target;
  for (const segment of path) {
    if (value == null || typeof value !== "object") {
      return [];
    }
    value = (value as Record<string | number, unknown>)[segment];
  }
  if (typeof value === "string") {
    return value.length > 0
      ? [{ type: "text" as const, value }]
      : [];
  }
  return Array.isArray(value) ? value : [];
}

function applyMockRichTextSteps(
  target: Record<string, unknown>,
  path: Array<string | number>,
  steps: NonNullable<MindooDBAppUpdateDocumentInput["richTextSteps"]>[number]["steps"],
) {
  if (path.length === 0) {
    throw new Error("Rich-text steps path must contain at least one segment");
  }
  const parent = ensureParentAtPath(target, path);
  const leaf = path[path.length - 1];
  let text = materializeMockRichTextValue(parent[leaf]);
  for (const step of steps) {
    text =
      text.slice(0, step.index) +
      (step.insert ?? "") +
      text.slice(step.index + step.deleteCount);
  }
  parent[leaf] = text;
}

function materializeMockRichTextValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((span) => {
      if (!span || typeof span !== "object") {
        return "";
      }
      const record = span as { type?: unknown; value?: unknown };
      return record.type === "text" && typeof record.value === "string"
        ? record.value
        : "";
    })
    .join("");
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
      uiPreferences: { ...current.uiPreferences },
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
          expression:
            column.expression.mode === "field"
              ? { ...column.expression }
              : {
                  mode: "formula",
                  expression: structuredClone(column.expression.expression),
                },
        })),
        filter:
          view.filter.mode === "rules"
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
    theme: patch.theme
      ? { ...current.theme, ...patch.theme }
      : { ...current.theme },
    viewport:
      patch.viewport === undefined
        ? current.viewport
          ? { ...current.viewport }
          : null
        : patch.viewport
          ? { ...patch.viewport }
          : null,
    uiPreferences: patch.uiPreferences
      ? { ...current.uiPreferences, ...patch.uiPreferences }
      : { ...current.uiPreferences },
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
            expression:
              column.expression.mode === "field"
                ? { ...column.expression }
                : {
                    mode: "formula",
                    expression: structuredClone(column.expression.expression),
                  },
          })),
          filter:
            view.filter.mode === "rules"
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
            expression:
              column.expression.mode === "field"
                ? { ...column.expression }
                : {
                    mode: "formula",
                    expression: structuredClone(column.expression.expression),
                  },
          })),
          filter:
            view.filter.mode === "rules"
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

function createDefaultLaunchContext(
  patch?: Partial<MindooDBAppLaunchContext>,
): MindooDBAppLaunchContext {
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
    uiPreferences: {
      iosMultitaskingOptimized: false,
    },
    locale: "en",
    user: {
      id: "user-1",
      username: "Test User",
    },
    licensedProducts: [],
    launchParameters: {},
    databases: [],
    views: [],
  };
  return mergeLaunchContext(base, patch);
}

function createDefaultReadableAttachmentStream(
  chunks: Uint8Array[] = [],
): MindooDBAppReadableAttachmentStream {
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
  automergeBinary?: Uint8Array;
};

function loadMockAutomergeDocument(document: MockStoredDocument): Automerge.Doc<Record<string, unknown>> {
  if (document.automergeBinary) {
    return Automerge.load<Record<string, unknown>>(document.automergeBinary);
  }
  const initialDoc = Automerge.from<Record<string, unknown>>({
    ...structuredClone(document.data),
    body: typeof document.data.body === "string" ? document.data.body : "",
  });
  document.automergeBinary = Automerge.save(initialDoc);
  return initialDoc;
}

function persistMockAutomergeDocument(
  document: MockStoredDocument,
  automergeDoc: Automerge.Doc<Record<string, unknown>>,
) {
  document.automergeBinary = Automerge.save(automergeDoc);
  document.data = structuredClone(automergeDoc as unknown as Record<string, unknown>);
  document.heads = Automerge.getHeads(automergeDoc);
}

function getFieldValue(source: Record<string, unknown>, field: string) {
  return field.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

function matchesDocumentFilter(
  document: MockStoredDocument,
  filter?: Record<string, unknown>,
) {
  if (!filter) {
    return true;
  }
  return Object.entries(filter).every(
    ([field, expected]) => getFieldValue(document.data, field) === expected,
  );
}

function decodeMockListCursor(cursor?: string | null) {
  if (!cursor) {
    return 0;
  }
  const offset = Number.parseInt(cursor, 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

function createDefaultViewNavigator(): MindooDBAppViewNavigator {
  const definition: MindooDBAppViewDefinition = {
    title: "Mock View",
    columns: [],
  };
  let expansion: MindooDBAppViewNavigatorExpansionState = {
    expandAllByDefault: false,
    expandLevel: 0,
    entryKeys: [],
  };
  let selection: MindooDBAppViewNavigatorSelectionState = {
    selectAllByDefault: false,
    entryKeys: [],
  };
  const emptyPage: MindooDBAppViewNavigatorPageResult = {
    entries: [],
    nextPosition: null,
    hasMore: false,
  };
  let viewCursor: string | null = null;
  return {
    async getDefinition() {
      return definition;
    },
    async getViewCursor() {
      return viewCursor;
    },
    async refresh() {
      return viewCursor;
    },
    async getCurrentEntry() {
      return null;
    },
    async gotoFirst() {
      return false;
    },
    async gotoLast() {
      return false;
    },
    async gotoNext() {
      return false;
    },
    async gotoPrev() {
      return false;
    },
    async gotoNextSibling() {
      return false;
    },
    async gotoPrevSibling() {
      return false;
    },
    async gotoParent() {
      return false;
    },
    async gotoFirstChild() {
      return false;
    },
    async gotoLastChild() {
      return false;
    },
    async gotoPos(_position: string) {
      return false;
    },
    async getPos(_position: string) {
      return null;
    },
    async findCategoryEntryByParts(_parts: unknown[]) {
      return null;
    },
    async entriesForward(_options?: MindooDBAppViewNavigatorPageOptions) {
      return emptyPage;
    },
    async entriesBackward(_options?: MindooDBAppViewNavigatorPageOptions) {
      return emptyPage;
    },
    async gotoNextSelected() {
      return false;
    },
    async gotoPrevSelected() {
      return false;
    },
    async select(
      origin: string,
      docId: string,
      selectParentCategories = false,
    ) {
      const key = `${origin}:${docId}`;
      selection = {
        ...selection,
        entryKeys: Array.from(new Set([...selection.entryKeys, key])),
      };
      if (selectParentCategories) {
        selection = {
          ...selection,
          entryKeys: [...selection.entryKeys],
        };
      }
    },
    async deselect(origin: string, docId: string) {
      const key = `${origin}:${docId}`;
      selection = {
        ...selection,
        entryKeys: selection.entryKeys.filter((entry) => entry !== key),
      };
    },
    async selectAllEntries() {
      selection = {
        selectAllByDefault: true,
        entryKeys: [],
      };
    },
    async deselectAllEntries() {
      selection = {
        selectAllByDefault: false,
        entryKeys: [],
      };
    },
    async isSelected(origin: string, docId: string) {
      const key = `${origin}:${docId}`;
      return selection.selectAllByDefault
        ? !selection.entryKeys.includes(key)
        : selection.entryKeys.includes(key);
    },
    async getSelectionState() {
      return selection;
    },
    async setSelectionState(state: MindooDBAppViewNavigatorSelectionState) {
      selection = {
        selectAllByDefault: state.selectAllByDefault,
        entryKeys: [...state.entryKeys],
      };
    },
    async expand(origin: string, docId: string) {
      const key = `${origin}:${docId}`;
      expansion = {
        ...expansion,
        entryKeys: Array.from(new Set([...expansion.entryKeys, key])),
      };
    },
    async collapse(origin: string, docId: string) {
      const key = `${origin}:${docId}`;
      expansion = {
        ...expansion,
        entryKeys: expansion.entryKeys.filter((entry) => entry !== key),
      };
    },
    async expandAll() {
      expansion = {
        expandAllByDefault: true,
        expandLevel: expansion.expandLevel,
        entryKeys: [],
      };
    },
    async collapseAll() {
      expansion = {
        expandAllByDefault: false,
        expandLevel: 0,
        entryKeys: [],
      };
    },
    async expandToLevel(level: number) {
      expansion = {
        ...expansion,
        expandLevel: level,
      };
    },
    async isExpanded(_entryKey: string) {
      return expansion.expandAllByDefault;
    },
    async getExpansionState() {
      return expansion;
    },
    async setExpansionState(state: MindooDBAppViewNavigatorExpansionState) {
      expansion = {
        expandAllByDefault: state.expandAllByDefault,
        expandLevel: state.expandLevel,
        entryKeys: [...state.entryKeys],
      };
    },
    async childEntries(_entryKey: string, _descending?: boolean) {
      return [];
    },
    async childCategories(_entryKey: string, _descending?: boolean) {
      return [];
    },
    async childDocuments(_entryKey: string, _descending?: boolean) {
      return [];
    },
    async childCategoriesByKey(
      _entryKey: string,
      _key: unknown,
      _exact?: boolean,
      _descending?: boolean,
    ) {
      return [];
    },
    async childDocumentsByKey(
      _entryKey: string,
      _key: unknown,
      _exact?: boolean,
      _descending?: boolean,
    ) {
      return [];
    },
    async childCategoriesBetween(
      _entryKey: string,
      _range: MindooDBAppViewNavigatorRangeQuery,
    ) {
      return [];
    },
    async childDocumentsBetween(
      _entryKey: string,
      _range: MindooDBAppViewNavigatorRangeQuery,
    ) {
      return [];
    },
    async getSortedDocIds(
      _descending?: boolean,
    ): Promise<MindooDBAppScopedDocId[]> {
      return [];
    },
    async getSortedDocIdsScoped(
      _entryKey: string,
      _descending?: boolean,
    ): Promise<MindooDBAppScopedDocId[]> {
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

function createDatabaseHandle(
  definition: MockMindooDBAppDatabaseDefinition,
): MindooDBAppDatabase {
  let createCounter = 0;
  let changeCounter = 0;
  const defaultViewFactory = async () => createDefaultViewNavigator();
  const storedDocuments = new Map<string, MockStoredDocument>();

  const defaultDocuments: MindooDBAppDocumentApi = {
    async list(
      query?: MindooDBAppDocumentListQuery,
    ): Promise<MindooDBAppDocumentListResult> {
      const status = query?.status ?? "existing";
      const skip = Math.max(0, query?.skip ?? 0);
      const limit = Math.max(1, query?.limit ?? 50);
      const offset = decodeMockListCursor(query?.cursor) + skip;
      const metadataOnly = query?.metadataOnly ?? false;

      const items = Array.from(storedDocuments.values())
        .filter((document) =>
          status === "all"
            ? true
            : status === "deleted"
              ? document.isDeleted
              : !document.isDeleted,
        )
        .filter((document) =>
          metadataOnly ? true : matchesDocumentFilter(document, query?.filter),
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      const page = items.slice(offset, offset + limit).map((document) => {
        if (metadataOnly) {
          return {
            id: document.id,
            isDeleted: document.isDeleted,
          };
        }
        const projectedData = query?.fields
          ? Object.fromEntries(
              query.fields.map((field) => [
                field,
                getFieldValue(document.data, field),
              ]),
            )
          : document.data;
        return {
          id: document.id,
          data: projectedData,
          attachmentCount: document.attachments?.length ?? 0,
          updatedAt: document.updatedAt,
          isDeleted: status !== "existing" ? document.isDeleted : undefined,
        };
      });
      const nextCursor =
        offset + page.length < items.length
          ? String(offset + page.length)
          : null;
      return {
        items: page,
        nextCursor,
      };
    },
    async getHeadCursor(): Promise<MindooDBAppDocumentHeadCursorResult> {
      return {
        cursor: String(storedDocuments.size),
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
        heads: document.heads ? [...document.heads] : undefined,
        attachments: document.attachments
          ? structuredClone(document.attachments)
          : [],
        updatedAt: document.updatedAt,
      };
    },
    async getRichText(docId, path, _options) {
      const document = storedDocuments.get(docId);
      if (!document || document.isDeleted) {
        throw new Error(`Document ${docId} was not found.`);
      }
      return {
        path: [...path],
        heads: document.heads ? [...document.heads] : undefined,
        spans: structuredClone(readRichTextSpansAtPath(document.data, path)),
      };
    },
    async getAutomergeSnapshot(docId, _options) {
      const document = storedDocuments.get(docId);
      if (!document || document.isDeleted) {
        throw new Error(`Document ${docId} was not found.`);
      }
      const automergeDoc = loadMockAutomergeDocument(document);
      return {
        binary: Automerge.save(automergeDoc),
        heads: Automerge.getHeads(automergeDoc),
      };
    },
    async applyAutomergeChanges(docId, patch) {
      const document = storedDocuments.get(docId);
      if (!document || document.isDeleted) {
        throw new Error(`Document ${docId} was not found.`);
      }
      const currentDoc = loadMockAutomergeDocument(document);
      const [mergedDoc] = Automerge.applyChanges(
        currentDoc,
        patch.changes.map((change) => new Uint8Array(change)),
      );
      persistMockAutomergeDocument(document, mergedDoc);
      document.updatedAt = new Date().toISOString();
      const mergedHeads = document.heads ? [...document.heads] : [];
      let changesSince:
        | {
            sinceHeads: string[];
            changes: Uint8Array[];
          }
        | undefined;
      if (patch.replicaHeads?.length) {
        const missingChanges = Automerge.getChangesSince(
          mergedDoc,
          patch.replicaHeads as Automerge.Heads,
        );
        changesSince = {
          sinceHeads: [...patch.replicaHeads],
          changes: missingChanges.map((change) => cloneBytes(new Uint8Array(change))),
        };
      }
      return {
        document: {
          id: document.id,
          data: structuredClone(document.data),
          heads: mergedHeads,
          attachments: document.attachments
            ? structuredClone(document.attachments)
            : [],
          updatedAt: document.updatedAt,
        },
        heads: mergedHeads,
        changesSince,
      };
    },
    async create(input) {
      // Honor caller-provided ids: when `input.id` is present and a document
      // already exists, return the existing document (mirrors MindooDB's
      // idempotent create). Otherwise create a new document with the supplied
      // id, falling back to a generated `doc-<counter>` id when none is given.
      const callerId =
        typeof input.id === "string" && input.id.length > 0 ? input.id : null;
      if (callerId) {
        const existing = storedDocuments.get(callerId);
        if (existing) {
          if (existing.isDeleted) {
            existing.isDeleted = false;
            existing.updatedAt = new Date().toISOString();
            existing.heads = [`mock-head-${++changeCounter}`];
          }
          return {
            id: existing.id,
            data: structuredClone(existing.data),
            heads: existing.heads ? [...existing.heads] : undefined,
            attachments: existing.attachments
              ? structuredClone(existing.attachments)
              : [],
            updatedAt: existing.updatedAt,
          };
        }
      }
      let id: string;
      if (callerId) {
        id = callerId;
      } else {
        createCounter += 1;
        id = `doc-${createCounter}`;
      }
      const createdAt = new Date().toISOString();
      const created = {
        id,
        data: { ...input.set },
        heads: [`mock-head-${++changeCounter}`],
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
    async createMany(inputs) {
      // Mirrors the host's bulk semantics: sequential creates over the same
      // idempotent logic, returning only the ids in input order.
      const ids: string[] = [];
      for (const input of inputs) {
        const created = await defaultDocuments.create(input);
        ids.push(created.id);
      }
      return { ids };
    },
    async update(docId, patch) {
      const updatedAt = new Date().toISOString();
      const existing = storedDocuments.get(docId);
      const updated = {
        id: docId,
        data: applyDocumentUpdatePatch(existing?.data ?? {}, patch),
        heads: [`mock-head-${++changeCounter}`],
        attachments: existing?.attachments
          ? structuredClone(existing.attachments)
          : [],
        updatedAt,
      };
      storedDocuments.set(docId, {
        ...updated,
        data: structuredClone(updated.data),
        attachments: updated.attachments
          ? structuredClone(updated.attachments)
          : [],
        isDeleted: false,
        automergeBinary: undefined,
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
    async deleteMany(docIds: string[]) {
      // Mirrors the host's idempotent bulk semantics: missing or
      // already-deleted documents are skipped.
      for (const docId of docIds) {
        await defaultDocuments.delete(docId);
      }
      return { ok: true as const };
    },
    async undelete(_docId: string) {
      const existing = storedDocuments.get(_docId);
      if (existing) {
        storedDocuments.set(_docId, {
          ...existing,
          isDeleted: false,
          heads: [`mock-head-${++changeCounter}`],
          updatedAt: new Date().toISOString(),
        });
      }
      return { ok: true as const };
    },
    async canCreate(): Promise<MindooDBAppAccessDecision> {
      return { allowed: true, reason: "allowed (test host)", tier: "tier1" };
    },
    async canChange(_docId: string): Promise<MindooDBAppAccessDecision> {
      return { allowed: true, reason: "allowed (test host)", tier: "tier1" };
    },
    async canDelete(_docId: string): Promise<MindooDBAppAccessDecision> {
      return { allowed: true, reason: "allowed (test host)", tier: "tier1" };
    },
    async canUndelete(_docId: string): Promise<MindooDBAppAccessDecision> {
      return { allowed: true, reason: "allowed (test host)", tier: "tier1" };
    },
    async getDefaultCreateKeyId(): Promise<string> {
      return "default";
    },
    async listHistory(
      _docId: string,
    ): Promise<MindooDBAppDocumentHistoryEntry[]> {
      return [];
    },
    async getAtTimestamp(
      docId: string,
      timestamp: number,
    ): Promise<MindooDBAppHistoricalDocument> {
      return {
        id: docId,
        timestamp,
        state: "missing",
        data: null,
        attachments: [],
      };
    },
    async getAtRevision(
      docId: string,
      revisionId: string,
    ): Promise<MindooDBAppHistoricalDocument> {
      return {
        id: docId,
        revisionId,
        timestamp: Date.now(),
        heads: [],
        state: "missing",
        data: null,
        attachments: [],
      };
    },
  };

  const defaultViews: MockViewApi = {
    async create(_input: MindooDBAppCreateViewNavigatorInput) {
      return await defaultViewFactory();
    },
    async open(_viewId: string) {
      return await defaultViewFactory();
    },
  };

  const defaultAttachments: MindooDBAppAttachmentApi = {
    async list(
      _docId: string,
      _options?: { timestamp?: number; revisionId?: string },
    ) {
      return [];
    },
    async remove(_docId: string, _attachmentName: string) {
      return { ok: true as const };
    },
    async openReadStream(
      _docId: string,
      _attachmentName: string,
      _options?: { timestamp?: number; revisionId?: string },
    ) {
      return createDefaultReadableAttachmentStream();
    },
    async openWriteStream(
      _docId: string,
      _attachmentName: string,
      _contentType?: string,
    ) {
      return createDefaultWritableAttachmentStream();
    },
    async scan(_docId: string, options) {
      return {
        ok: true,
        attachment: {
          attachmentId: "scan-attachment-1",
          fileName: options?.defaultFileName ?? "scan.jpg",
          mimeType: options?.mimeType ?? "image/jpeg",
          size: 0,
        },
      };
    },
    async preparePreviewSession(
      _docId: string,
      _attachmentName: string,
      _options?: { timestamp?: number; revisionId?: string },
    ) {
      return {
        sessionId: "preview-session-1",
        previewUrl: "about:blank",
      };
    },
    async openPreview(
      _docId: string,
      _attachmentName: string,
      _options?: { timestamp?: number; revisionId?: string },
    ) {
      return { ok: true as const };
    },
  };

  const methods: MockDatabaseMethods = definition.methods ?? {};

  return {
    async info() {
      return {
        ...definition.info,
        capabilities: [...definition.info.capabilities],
      };
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
  setLaunchContext: (
    patch?: Partial<MindooDBAppLaunchContext>,
  ) => MindooDBAppLaunchContext;
  listDatabaseInfos: () => MindooDBAppDatabaseInfo[];
  setDatabases: (definitions: MockMindooDBAppDatabaseDefinition[]) => void;
  getDatabase: (databaseId: string) => MindooDBAppDatabase;
  getLicensedProducts: () => string[];
  createViewNavigator: (
    input: MindooDBAppCreateViewNavigatorInput,
  ) => Promise<MindooDBAppViewNavigator>;
  openViewNavigator: (
    viewId: string,
    options?: MindooDBAppViewNavigatorOpenOptions,
  ) => Promise<MindooDBAppViewNavigator>;
  bridge: MindooDBAppBridge;
  session: MindooDBAppSession;
  emitThemeChange: (theme: MindooDBAppHostTheme) => void;
  emitViewportChange: (viewport: MindooDBAppViewport) => void;
  emitUiPreferencesChange: (uiPreferences: MindooDBAppUiPreferences) => void;
  emitLocaleChange: (locale: string) => void;
};

function createMockSessionState(
  options: CreateMockMindooDBAppSessionOptions = {},
): MockSessionState {
  let launchContext = createDefaultLaunchContext(options.launchContext);
  const themeListeners = new Set<(theme: MindooDBAppHostTheme) => void>();
  const viewportListeners = new Set<(viewport: MindooDBAppViewport) => void>();
  const uiPreferencesListeners = new Set<
    (uiPreferences: MindooDBAppUiPreferences) => void
  >();
  const localeListeners = new Set<(locale: string) => void>();
  const databaseHandles = new Map<string, MindooDBAppDatabase>();
  const databaseViewApis = new Map<string, MockViewApi>();
  const sessionViews = new Map<string, MindooDBAppViewNavigator>();
  let activeMenuResolve: ((result: MindooDBAppShowMenuResult) => void) | null =
    null;
  let databaseInfos: MindooDBAppDatabaseInfo[] = [];

  const menus: MindooDBAppMenuApi = {
    async show(_input: MindooDBAppShowMenuInput) {
      if (activeMenuResolve) {
        activeMenuResolve({
          action: "dismissed",
          reason: "replaced",
        });
      }
      return await new Promise<MindooDBAppShowMenuResult>((resolve) => {
        activeMenuResolve = resolve;
      });
    },
    async hide() {
      activeMenuResolve?.({
        action: "dismissed",
        reason: "hide",
      });
      activeMenuResolve = null;
    },
  };

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
        async create(_input: MindooDBAppCreateViewNavigatorInput) {
          return await createDefaultViewNavigator();
        },
        async open(_viewId: string) {
          return await createDefaultViewNavigator();
        },
        ...(definition.methods?.views ?? {}),
      });
    }
    launchContext = mergeLaunchContext(launchContext, {
      databases: databaseInfos,
    });
  };

  setDatabases(options.databases ?? []);

  const session: MindooDBAppSession = {
    async getLaunchContext() {
      return mergeLaunchContext(launchContext);
    },
    async getLicensedProducts() {
      return [...(launchContext.licensedProducts ?? [])];
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
    async listDocumentsSinceViewCursor() {
      return {
        items: [] as MindooDBAppScopedDocumentSummary[],
        nextCursor: null,
      } satisfies MindooDBAppViewCursorDocumentListResult;
    },
    async createViewNavigator(input) {
      const firstDatabaseId = input.databaseIds[0];
      if (!firstDatabaseId) {
        throw new Error(
          "At least one test database is required for view creation.",
        );
      }
      const api = databaseViewApis.get(firstDatabaseId);
      if (!api) {
        throw new Error(
          `Unknown test database for view creation: ${firstDatabaseId}`,
        );
      }
      const view = await api.create(input);
      const viewId = input.definition.id || crypto.randomUUID();
      sessionViews.set(viewId, view);
      return view;
    },
    async openViewNavigator(viewId, options) {
      const existing = sessionViews.get(viewId);
      if (existing) {
        return existing;
      }
      const sourceDatabaseId = launchContext.views.find(
        (view) => view.id === viewId,
      )?.sources[0]?.databaseId;
      if (!sourceDatabaseId) {
        throw new Error(`Unknown test view: ${viewId}`);
      }
      const api = databaseViewApis.get(sourceDatabaseId);
      if (!api) {
        throw new Error(
          `Unknown test database for view ${viewId}: ${sourceDatabaseId}`,
        );
      }
      const view = await api.open(viewId, options);
      sessionViews.set(viewId, view);
      return view;
    },
    menus,
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
    onUiPreferencesChange(listener) {
      uiPreferencesListeners.add(listener);
      return () => {
        uiPreferencesListeners.delete(listener);
      };
    },
    onLocaleChange(listener) {
      localeListeners.add(listener);
      return () => {
        localeListeners.delete(listener);
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
    getLicensedProducts() {
      return [...(launchContext.licensedProducts ?? [])];
    },
    createViewNavigator: session.createViewNavigator,
    openViewNavigator: session.openViewNavigator,
    bridge,
    session,
    emitThemeChange(theme) {
      launchContext = mergeLaunchContext(launchContext, { theme });
      themeListeners.forEach((listener) =>
        listener({ ...launchContext.theme }),
      );
    },
    emitViewportChange(viewport) {
      launchContext = mergeLaunchContext(launchContext, { viewport });
      viewportListeners.forEach((listener) => listener({ ...viewport }));
    },
    emitUiPreferencesChange(uiPreferences) {
      launchContext = mergeLaunchContext(launchContext, { uiPreferences });
      uiPreferencesListeners.forEach((listener) =>
        listener({ ...launchContext.uiPreferences }),
      );
    },
    emitLocaleChange(locale) {
      launchContext = mergeLaunchContext(launchContext, { locale });
      localeListeners.forEach((listener) => listener(launchContext.locale));
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
  setLaunchContext(
    patch?: Partial<MindooDBAppLaunchContext>,
  ): MindooDBAppLaunchContext;
  getLicensedProducts(): string[];
  listDatabases(): MindooDBAppDatabaseInfo[];
  setDatabases(definitions: MockMindooDBAppDatabaseDefinition[]): void;
  emitThemeChange(theme: MindooDBAppHostTheme): void;
  emitViewportChange(viewport: MindooDBAppViewport): void;
  emitUiPreferencesChange(uiPreferences: MindooDBAppUiPreferences): void;
  emitLocaleChange(locale: string): void;
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
    getLicensedProducts: state.getLicensedProducts,
    listDatabases: state.listDatabaseInfos,
    setDatabases: state.setDatabases,
    emitThemeChange: state.emitThemeChange,
    emitViewportChange: state.emitViewportChange,
    emitUiPreferencesChange: state.emitUiPreferencesChange,
    emitLocaleChange: state.emitLocaleChange,
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
  emitUiPreferencesChange(uiPreferences: MindooDBAppUiPreferences): void;
  emitLocaleChange(locale: string): void;
  postPortMessage(
    message: MindooDBAppBridgePortMessage,
    transfer?: Transferable[],
  ): void;
  setRequestHandler(method: string, handler: FakeBridgeRequestHandler): void;
  clearRequestHandler(method: string): void;
}

export function createFakeBridgeHost(
  options: CreateFakeBridgeHostOptions = {},
): FakeBridgeHostController {
  const state = createMockSessionState(options);
  const customRequestHandlers = new Map(
    Object.entries(options.requestHandlers ?? {}),
  );
  const requests: MindooDBAppBridgeRpcRequest[] = [];
  const connectedPorts = new Set<MessagePort>();
  const viewSessions = new Map<string, MindooDBAppViewNavigator>();
  const readStreams = new Map<string, MindooDBAppReadableAttachmentStream>();
  const writeStreams = new Map<string, MindooDBAppWritableAttachmentStream>();
  let viewCounter = 0;
  let streamCounter = 0;
  let previousWindowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );
  let previousWindowValue: unknown =
    typeof window === "undefined" ? undefined : window;
  let installed = false;

  const hostWindow = {
    postMessage(
      message: unknown,
      _targetOrigin?: string,
      transfer?: Transferable[],
    ) {
      const payload = message as MindooDBAppBridgeConnectMessage | undefined;
      if (
        !payload ||
        payload.protocol !== PROTOCOL ||
        payload.type !== "mindoodb-app:connect"
      ) {
        return;
      }
      if (payload.launchId !== state.getLaunchContext().launchId) {
        return;
      }
      const port = transfer?.[0] as MessagePort | undefined;
      if (!port) {
        throw new Error(
          "Expected the bridge connection to transfer a MessagePort.",
        );
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
    previousWindowDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
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
        value:
          typeof window !== "undefined" &&
          typeof window.setTimeout === "function"
            ? window.setTimeout.bind(window)
            : setTimeout,
        configurable: true,
      },
      clearTimeout: {
        value:
          typeof window !== "undefined" &&
          typeof window.clearTimeout === "function"
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

  async function resolveViewNavigator(viewId: string) {
    const existing = viewSessions.get(viewId);
    if (existing) {
      return existing;
    }
    const navigator = await state.openViewNavigator(viewId);
    viewSessions.set(viewId, navigator);
    return navigator;
  }

  function postRpcSuccess(
    port: MessagePort,
    requestId: string,
    result: unknown,
  ) {
    port.postMessage({
      protocol: PROTOCOL,
      kind: "success",
      id: requestId,
      result,
    });
  }

  function postRpcError(
    port: MessagePort,
    requestId: string,
    error: MindooDBAppBridgeErrorPayload,
  ) {
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

  function postStreamError(
    port: MessagePort,
    streamId: string,
    error: MindooDBAppBridgeErrorPayload,
  ) {
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
      case "session.getLicensedProducts":
        return state.getLicensedProducts();
      case "session.listDatabases":
        return state.listDatabaseInfos();
      case "session.openDatabase":
        state.getDatabase(String(params.databaseId));
        return { ok: true };
      case "session.createViewNavigator": {
        const navigatorId = `navigator-${(viewCounter += 1)}`;
        const navigator = await state.createViewNavigator({
          databaseIds: Array.isArray(params.databaseIds)
            ? params.databaseIds.map((entry) => String(entry))
            : [],
          definition: params.definition as MindooDBAppViewDefinition,
          categorizationStyle:
            params.categorizationStyle === "category_then_document"
              ? "category_then_document"
              : "document_then_category",
          options: params.options as
            | MindooDBAppViewNavigatorOpenOptions
            | undefined,
        });
        viewSessions.set(navigatorId, navigator);
        return { navigatorId };
      }
      case "session.openViewNavigator": {
        const navigatorId = `navigator-${(viewCounter += 1)}`;
        const navigator = await state.openViewNavigator(
          String(params.viewId),
          params.options as MindooDBAppViewNavigatorOpenOptions | undefined,
        );
        viewSessions.set(navigatorId, navigator);
        return { navigatorId };
      }
      case "menus.show":
        return await state.session.menus.show(
          request.params as unknown as MindooDBAppShowMenuInput,
        );
      case "menus.hide":
        await state.session.menus.hide();
        return { ok: true };
      case "session.disconnect":
        await state.session.disconnect();
        return { ok: true };
      case "documents.list":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.list(
            params.query as MindooDBAppDocumentListQuery | undefined,
          );
      case "documents.getHeadCursor":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.getHeadCursor();
      case "documents.get":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.get(String(params.docId));
      case "documents.richText.get":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.getRichText(
            String(params.docId),
            params.path as Array<string | number>,
          );
      case "documents.automerge.getSnapshot":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.getAutomergeSnapshot(
            String(params.docId),
            { revisionId: params.revisionId as string | undefined },
          );
      case "documents.automerge.applyChanges":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.applyAutomergeChanges(
            String(params.docId),
            params.patch as {
              baseHeads?: string[];
              changes: Uint8Array[];
            },
          );
      case "documents.create":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.create(
            params.input as {
              set: Record<string, unknown>;
              decryptionKeyId?: string;
              id?: string;
            },
          );
      case "documents.update":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.update(
            String(params.docId),
            params.patch as MindooDBAppUpdateDocumentInput,
          );
      case "documents.delete":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.delete(String(params.docId));
      case "documents.undelete":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.undelete(String(params.docId));
      case "documents.canCreate":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.canCreate(
            params.input as { decryptionKeyId?: string } | undefined,
          );
      case "documents.canChange":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.canChange(String(params.docId));
      case "documents.canDelete":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.canDelete(String(params.docId));
      case "documents.canUndelete":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.canUndelete(String(params.docId));
      case "documents.getDefaultCreateKeyId":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.getDefaultCreateKeyId();
      case "documents.history.list":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.listHistory(String(params.docId));
      case "documents.history.getAtTimestamp":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.getAtTimestamp(
            String(params.docId),
            Number(params.timestamp),
          );
      case "documents.history.getAtRevision":
        return await state
          .getDatabase(String(params.databaseId))
          .documents.getAtRevision(
            String(params.docId),
            String(params.revisionId),
          );
      case "attachments.list":
        return await state
          .getDatabase(String(params.databaseId))
          .attachments.list(
            String(params.docId),
            typeof params.revisionId === "string"
              ? { revisionId: params.revisionId }
              : typeof params.timestamp === "number"
                ? { timestamp: params.timestamp }
                : undefined,
          );
      case "attachments.remove":
        return await state
          .getDatabase(String(params.databaseId))
          .attachments.remove(
            String(params.docId),
            String(params.attachmentName),
          );
      case "attachments.openReadStream": {
        const stream = await state
          .getDatabase(String(params.databaseId))
          .attachments.openReadStream(
            String(params.docId),
            String(params.attachmentName),
            typeof params.revisionId === "string"
              ? { revisionId: params.revisionId }
              : typeof params.timestamp === "number"
                ? { timestamp: params.timestamp }
                : undefined,
          );
        const streamId = `read-${(streamCounter += 1)}`;
        readStreams.set(streamId, stream);
        return { streamId };
      }
      case "attachments.openWriteStream": {
        const stream = await state
          .getDatabase(String(params.databaseId))
          .attachments.openWriteStream(
            String(params.docId),
            String(params.attachmentName),
            typeof params.contentType === "string"
              ? params.contentType
              : undefined,
          );
        const streamId = `write-${(streamCounter += 1)}`;
        writeStreams.set(streamId, stream);
        return { streamId };
      }
      case "attachments.scanAndWrite":
        return await state
          .getDatabase(String(params.databaseId))
          .attachments.scan(String(params.docId), {
            defaultFileName:
              typeof params.defaultFileName === "string"
                ? params.defaultFileName
                : undefined,
            preset:
              typeof params.preset === "string"
                ? (params.preset as MindooDBAppDocumentScanPreset)
                : undefined,
            mimeType:
              params.mimeType === "image/png" ||
              params.mimeType === "image/jpeg" ||
              params.mimeType === "application/pdf"
                ? params.mimeType
                : undefined,
          });
      case "attachments.openPreview":
        return await state
          .getDatabase(String(params.databaseId))
          .attachments.openPreview(
            String(params.docId),
            String(params.attachmentName),
            typeof params.revisionId === "string"
              ? { revisionId: params.revisionId }
              : typeof params.timestamp === "number"
                ? { timestamp: params.timestamp }
                : undefined,
          );
      case "attachments.preparePreviewSession":
        return await state
          .getDatabase(String(params.databaseId))
          .attachments.preparePreviewSession(
            String(params.docId),
            String(params.attachmentName),
            typeof params.revisionId === "string"
              ? { revisionId: params.revisionId }
              : typeof params.timestamp === "number"
                ? { timestamp: params.timestamp }
                : undefined,
          );
      case "viewNavigators.getDefinition":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).getDefinition();
      case "viewNavigators.refresh":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).refresh();
      case "viewNavigators.current.get":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).getCurrentEntry();
      case "viewNavigators.goto.first":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).gotoFirst();
      case "viewNavigators.goto.last":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).gotoLast();
      case "viewNavigators.goto.next":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).gotoNext();
      case "viewNavigators.goto.prev":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).gotoPrev();
      case "viewNavigators.goto.nextSibling":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).gotoNextSibling();
      case "viewNavigators.goto.prevSibling":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).gotoPrevSibling();
      case "viewNavigators.goto.parent":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).gotoParent();
      case "viewNavigators.goto.firstChild":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).gotoFirstChild();
      case "viewNavigators.goto.lastChild":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).gotoLastChild();
      case "viewNavigators.goto.pos":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).gotoPos(String(params.position));
      case "viewNavigators.pos.get":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).getPos(String(params.position));
      case "viewNavigators.category.findByParts":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).findCategoryEntryByParts(
          Array.isArray(params.parts) ? params.parts : [],
        );
      case "viewNavigators.entries.forward":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).entriesForward(
          params.options as MindooDBAppViewNavigatorPageOptions | undefined,
        );
      case "viewNavigators.entries.backward":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).entriesBackward(
          params.options as MindooDBAppViewNavigatorPageOptions | undefined,
        );
      case "viewNavigators.goto.nextSelected":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).gotoNextSelected();
      case "viewNavigators.goto.prevSelected":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).gotoPrevSelected();
      case "viewNavigators.selection.select":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).select(
          String(params.origin),
          String(params.docId),
          Boolean(params.selectParentCategories),
        );
      case "viewNavigators.selection.deselect":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).deselect(String(params.origin), String(params.docId));
      case "viewNavigators.selection.selectAll":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).selectAllEntries();
      case "viewNavigators.selection.deselectAll":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).deselectAllEntries();
      case "viewNavigators.selection.isSelected":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).isSelected(String(params.origin), String(params.docId));
      case "viewNavigators.selection.get":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).getSelectionState();
      case "viewNavigators.selection.set":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).setSelectionState(
          params.state as MindooDBAppViewNavigatorSelectionState,
        );
      case "viewNavigators.expansion.expand":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).expand(String(params.origin), String(params.docId));
      case "viewNavigators.expansion.collapse":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).collapse(String(params.origin), String(params.docId));
      case "viewNavigators.expansion.expandAll":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).expandAll();
      case "viewNavigators.expansion.collapseAll":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).collapseAll();
      case "viewNavigators.expansion.expandToLevel":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).expandToLevel(Number(params.level));
      case "viewNavigators.expansion.isExpanded":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).isExpanded(String(params.entryKey));
      case "viewNavigators.expansion.get":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).getExpansionState();
      case "viewNavigators.expansion.set":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).setExpansionState(
          params.state as MindooDBAppViewNavigatorExpansionState,
        );
      case "viewNavigators.children.entries":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).childEntries(String(params.entryKey), Boolean(params.descending));
      case "viewNavigators.children.categories":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).childCategories(String(params.entryKey), Boolean(params.descending));
      case "viewNavigators.children.documents":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).childDocuments(String(params.entryKey), Boolean(params.descending));
      case "viewNavigators.children.categoriesByKey":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).childCategoriesByKey(
          String(params.entryKey),
          params.key,
          typeof params.exact === "boolean" ? params.exact : undefined,
          typeof params.descending === "boolean"
            ? params.descending
            : undefined,
        );
      case "viewNavigators.children.documentsByKey":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).childDocumentsByKey(
          String(params.entryKey),
          params.key,
          typeof params.exact === "boolean" ? params.exact : undefined,
          typeof params.descending === "boolean"
            ? params.descending
            : undefined,
        );
      case "viewNavigators.children.categoriesBetween":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).childCategoriesBetween(
          String(params.entryKey),
          params.range as MindooDBAppViewNavigatorRangeQuery,
        );
      case "viewNavigators.children.documentsBetween":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).childDocumentsBetween(
          String(params.entryKey),
          params.range as MindooDBAppViewNavigatorRangeQuery,
        );
      case "viewNavigators.sortedDocIds.get":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).getSortedDocIds(
          typeof params.descending === "boolean"
            ? params.descending
            : undefined,
        );
      case "viewNavigators.sortedDocIds.scoped":
        return await (
          await resolveViewNavigator(String(params.navigatorId))
        ).getSortedDocIdsScoped(
          String(params.entryKey),
          typeof params.descending === "boolean"
            ? params.descending
            : undefined,
        );
      case "viewNavigators.dispose": {
        const key = String(params.navigatorId);
        const navigator = await resolveViewNavigator(key);
        await navigator.dispose();
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
        throw Object.assign(
          new Error(`Unknown read stream: ${message.streamId}`),
          { name: "stream-not-found" },
        );
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
        throw Object.assign(
          new Error(`Unknown write stream: ${message.streamId}`),
          { name: "stream-not-found" },
        );
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
      throw Object.assign(new Error(`Unknown stream: ${message.streamId}`), {
        name: "stream-not-found",
      });
    }
    if (message.kind === "stream-abort") {
      const stream = writeStreams.get(message.streamId);
      if (!stream) {
        throw Object.assign(
          new Error(`Unknown write stream: ${message.streamId}`),
          { name: "stream-not-found" },
        );
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
          const result = await customHandler(message.params, {
            host: controller,
            request: message,
            port,
          });
          postRpcSuccess(port, message.id, result);
          return;
        }
        const builtinResult = await handleBuiltinRequest(message);
        if (
          builtinResult === undefined &&
          message.method !== "viewNavigators.dispose"
        ) {
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
      const handledByCustom = await options.onPortMessage?.(message, {
        host: controller,
        port,
      });
      if (handledByCustom) {
        return;
      }
      const handled = await handleStreamMessage(port, message);
      if (!handled) {
        throw Object.assign(
          new Error(
            `No fake bridge port handler is configured for ${message.kind}.`,
          ),
          {
            name: "unsupported-message",
          },
        );
      }
    } catch (error) {
      const streamId =
        "streamId" in message ? String(message.streamId) : "unknown";
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
    emitUiPreferencesChange(uiPreferences) {
      state.emitUiPreferencesChange(uiPreferences);
      const payload: MindooDBAppBridgeUiPreferencesChangedMessage = {
        protocol: PROTOCOL,
        kind: "ui-preferences-changed",
        uiPreferences,
      };
      connectedPorts.forEach((port) => port.postMessage(payload));
    },
    emitLocaleChange(locale) {
      state.emitLocaleChange(locale);
      const payload: MindooDBAppBridgeLocaleChangedMessage = {
        protocol: PROTOCOL,
        kind: "locale-changed",
        locale,
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
