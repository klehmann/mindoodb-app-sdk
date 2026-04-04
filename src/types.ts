import type {
  MindooDBAppBooleanExpression,
  MindooDBAppExpression,
  MindooDBAppFilterDefinition,
  MindooDBAppViewCategoryChildrenPageRequest,
  MindooDBAppViewColumn,
  MindooDBAppViewColumnRole,
  MindooDBAppViewDefinition,
  MindooDBAppViewExpansionState,
  MindooDBAppViewExpressionBase,
  MindooDBAppViewExpressionDatePart,
  MindooDBAppViewExpressionOperation,
  MindooDBAppViewFieldExpression,
  MindooDBAppViewIfExpression,
  MindooDBAppViewLetExpression,
  MindooDBAppViewLiteralExpression,
  MindooDBAppViewLookupByPath,
  MindooDBAppViewOperationExpression,
  MindooDBAppViewOriginExpression,
  MindooDBAppViewPageRequest,
  MindooDBAppViewPageResult,
  MindooDBAppViewRow,
  MindooDBAppViewSortDirection,
  MindooDBAppViewTotalMode,
  MindooDBAppViewValueExpressionRef,
  MindooDBAppViewVariableExpression,
} from "mindoodb-view-language";

export type {
  MindooDBAppBooleanExpression,
  MindooDBAppExpression,
  MindooDBAppFilterDefinition,
  MindooDBAppViewCategoryChildrenPageRequest,
  MindooDBAppViewColumn,
  MindooDBAppViewColumnRole,
  MindooDBAppViewDefinition,
  MindooDBAppViewExpansionState,
  MindooDBAppViewExpressionBase,
  MindooDBAppViewExpressionDatePart,
  MindooDBAppViewExpressionOperation,
  MindooDBAppViewFieldExpression,
  MindooDBAppViewIfExpression,
  MindooDBAppViewLetExpression,
  MindooDBAppViewLiteralExpression,
  MindooDBAppViewLookupByPath,
  MindooDBAppViewOperationExpression,
  MindooDBAppViewOriginExpression,
  MindooDBAppViewPageRequest,
  MindooDBAppViewPageResult,
  MindooDBAppViewRow,
  MindooDBAppViewSortDirection,
  MindooDBAppViewTotalMode,
  MindooDBAppViewValueExpressionRef,
  MindooDBAppViewVariableExpression,
} from "mindoodb-view-language";

/** Launch target used by the Administrator when opening an app. */
export type MindooDBAppRuntime = "iframe" | "window";

/** Theme mode currently active in the Administrator host UI. */
export type MindooDBAppThemeMode = "light" | "dark";

/** Host theme snapshot exposed to running apps. */
export interface MindooDBAppHostTheme {
  mode: MindooDBAppThemeMode;
  preset: string;
}

/** Permission/capability flags exposed for a database binding inside the app session. */
export type MindooDBAppCapability =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "history"
  | "attachments"
  | "views";

/** Metadata about the current app launch supplied by the Administrator host. */
export interface MindooDBAppLaunchContext {
  appId: string;
  appInstanceId: string;
  appVersion?: string;
  launchId: string;
  runtime: MindooDBAppRuntime;
  theme: MindooDBAppHostTheme;
  tenantId?: string;
  preferredDatabaseId?: string;
  user: {
    id: string;
    username: string;
  };
  launchParameters: Record<string, string>;
}

/** Attachment metadata returned by the attachment APIs. */
export interface MindooDBAppAttachmentInfo {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/** Database entry visible to the app during launch and database listing. */
export interface MindooDBAppDatabaseInfo {
  id: string;
  title: string;
  role?: string;
  capabilities: MindooDBAppCapability[];
}

/** Lightweight document row returned by list operations. */
export interface MindooDBAppDocumentSummary {
  id: string;
  data?: Record<string, unknown>;
  attachmentCount?: number;
  updatedAt?: string;
}

/** Fully loaded document returned by `get()`, `create()`, or `update()`. */
export interface MindooDBAppDocument {
  id: string;
  data: Record<string, unknown>;
  attachments?: MindooDBAppAttachmentInfo[];
  updatedAt?: string;
}

/** One entry in the document history timeline. */
export interface MindooDBAppDocumentHistoryEntry {
  timestamp: number;
  publicKey: string;
  publicKeyFingerprint?: string;
  identityLabel?: string;
  isDeleted: boolean;
  isCurrent: boolean;
  summary?: string;
}

/** Historical snapshot returned for a document at a specific timestamp. */
export interface MindooDBAppHistoricalDocument {
  id: string;
  timestamp: number;
  state: "missing" | "deleted" | "exists";
  data: Record<string, unknown> | null;
}

/** Query options for paging through documents in a database. */
export interface MindooDBAppDocumentListQuery {
  limit?: number;
  cursor?: string | null;
  fields?: string[];
  filter?: Record<string, unknown>;
}

/** Paged result returned by `documents.list()`. */
export interface MindooDBAppDocumentListResult {
  items: MindooDBAppDocumentSummary[];
  nextCursor: string | null;
}

/** Payload used when creating a new document. */
export interface MindooDBAppCreateDocumentInput {
  data: Record<string, unknown>;
}

/** Patch payload used when updating an existing document. */
export interface MindooDBAppUpdateDocumentInput {
  data: Record<string, unknown>;
}

/** Query used for history lookups at a specific timestamp. */
export interface MindooDBAppHistoryQuery {
  timestamp: number;
}

/** Optional parameters for establishing the app bridge connection. */
export interface MindooDBAppBridgeConnectOptions {
  launchId?: string;
  targetOrigin?: string;
  connectTimeoutMs?: number;
}

/** Initial postMessage handshake sent from the app to the Administrator. */
export interface MindooDBAppBridgeConnectMessage {
  protocol: "mindoodb-app-bridge";
  type: "mindoodb-app:connect";
  launchId: string;
}

/** Handshake acknowledgement returned by the Administrator host. */
export interface MindooDBAppBridgeConnectedMessage {
  protocol: "mindoodb-app-bridge";
  type: "mindoodb-app:connected";
}

/** Structured error payload transported over bridge RPC or stream messages. */
export interface MindooDBAppBridgeErrorPayload {
  code: string;
  message: string;
}

/** Request envelope used by the port-based RPC transport. */
export interface MindooDBAppBridgeRpcRequest<TParams = unknown> {
  protocol: "mindoodb-app-bridge";
  kind: "request";
  id: string;
  method: string;
  params: TParams;
}

/** Successful RPC response envelope. */
export interface MindooDBAppBridgeRpcSuccess<TResult = unknown> {
  protocol: "mindoodb-app-bridge";
  kind: "success";
  id: string;
  result: TResult;
}

/** Failed RPC response envelope. */
export interface MindooDBAppBridgeRpcError {
  protocol: "mindoodb-app-bridge";
  kind: "error";
  id: string;
  error: MindooDBAppBridgeErrorPayload;
}

/** Union of all RPC-level bridge messages. */
export type MindooDBAppBridgeRpcMessage =
  | MindooDBAppBridgeRpcRequest
  | MindooDBAppBridgeRpcSuccess
  | MindooDBAppBridgeRpcError;

/** Result returned when the host opens a streamed attachment channel. */
export interface MindooDBAppBridgeStreamOpenResult {
  streamId: string;
}

/** Request asking the host for the next chunk on a read stream. */
export interface MindooDBAppBridgeStreamReadRequest {
  protocol: "mindoodb-app-bridge";
  kind: "stream-read";
  streamId: string;
}

/** Request sending one chunk over a write stream. */
export interface MindooDBAppBridgeStreamWriteRequest {
  protocol: "mindoodb-app-bridge";
  kind: "stream-write";
  streamId: string;
  chunk: ArrayBuffer;
}

/** Request closing a stream gracefully. */
export interface MindooDBAppBridgeStreamCloseRequest {
  protocol: "mindoodb-app-bridge";
  kind: "stream-close";
  streamId: string;
}

/** Request aborting a stream due to cancellation or failure. */
export interface MindooDBAppBridgeStreamAbortRequest {
  protocol: "mindoodb-app-bridge";
  kind: "stream-abort";
  streamId: string;
}

/** Streamed attachment payload delivered over the message port. */
export interface MindooDBAppAttachmentChunk {
  protocol: "mindoodb-app-bridge";
  kind: "stream-chunk";
  streamId: string;
  chunk?: ArrayBuffer;
  done: boolean;
}

/** Host acknowledgement for a write/close/abort stream request. */
export interface MindooDBAppBridgeStreamAck {
  protocol: "mindoodb-app-bridge";
  kind: "stream-ack";
  streamId: string;
}

/** Stream-level error message. */
export interface MindooDBAppBridgeStreamError {
  protocol: "mindoodb-app-bridge";
  kind: "stream-error";
  streamId: string;
  error: MindooDBAppBridgeErrorPayload;
}

/** Union of all non-RPC stream transport messages. */
export type MindooDBAppBridgeStreamMessage =
  | MindooDBAppBridgeStreamReadRequest
  | MindooDBAppBridgeStreamWriteRequest
  | MindooDBAppBridgeStreamCloseRequest
  | MindooDBAppBridgeStreamAbortRequest
  | MindooDBAppAttachmentChunk
  | MindooDBAppBridgeStreamAck
  | MindooDBAppBridgeStreamError;

/** Host-pushed event emitted when the Administrator theme changes. */
export interface MindooDBAppBridgeThemeChangedMessage {
  protocol: "mindoodb-app-bridge";
  kind: "theme-changed";
  theme: MindooDBAppHostTheme;
}

/** Any message that can travel across the dedicated bridge MessagePort. */
export type MindooDBAppBridgePortMessage =
  | MindooDBAppBridgeRpcMessage
  | MindooDBAppBridgeStreamMessage
  | MindooDBAppBridgeThemeChangedMessage;

/** Pull-based read stream for document attachments. */
export interface MindooDBAppReadableAttachmentStream {
  read(): Promise<Uint8Array | null>;
  close(): Promise<void>;
}

/** Push-based write stream for document attachments. */
export interface MindooDBAppWritableAttachmentStream {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

/** Document operations exposed by an opened database handle. */
export interface MindooDBAppDocumentApi {
  list(query?: MindooDBAppDocumentListQuery): Promise<MindooDBAppDocumentListResult>;
  get(docId: string): Promise<MindooDBAppDocument | null>;
  create(input: MindooDBAppCreateDocumentInput): Promise<MindooDBAppDocument>;
  update(docId: string, patch: MindooDBAppUpdateDocumentInput): Promise<MindooDBAppDocument>;
  delete(docId: string): Promise<{ ok: true }>;
  listHistory(docId: string): Promise<MindooDBAppDocumentHistoryEntry[]>;
  getAtTimestamp(docId: string, timestamp: number): Promise<MindooDBAppHistoricalDocument>;
}

/** Handle for one created or opened virtual view. */
export interface MindooDBAppViewHandle {
  getDefinition(): Promise<MindooDBAppViewDefinition>;
  refresh(): Promise<void>;
  page(input?: MindooDBAppViewPageRequest): Promise<MindooDBAppViewPageResult>;
  getExpansionState(): Promise<MindooDBAppViewExpansionState>;
  setExpansionState(state: MindooDBAppViewExpansionState): Promise<MindooDBAppViewExpansionState>;
  expand(rowKey: string): Promise<MindooDBAppViewExpansionState>;
  collapse(rowKey: string): Promise<MindooDBAppViewExpansionState>;
  expandAll(): Promise<MindooDBAppViewExpansionState>;
  collapseAll(): Promise<MindooDBAppViewExpansionState>;
  getRow(rowKey: string): Promise<MindooDBAppViewRow | null>;
  getCategory(input: MindooDBAppViewLookupByPath): Promise<MindooDBAppViewRow | null>;
  pageCategory(categoryKey: string, input?: MindooDBAppViewCategoryChildrenPageRequest): Promise<MindooDBAppViewPageResult>;
  listCategoryDocumentIds(categoryKey: string): Promise<string[]>;
  dispose(): Promise<void>;
}

/** Entry point for creating or opening views in a database. */
export interface MindooDBAppViewApi {
  create(definition: MindooDBAppViewDefinition): Promise<MindooDBAppViewHandle>;
  open(viewId: string): Promise<MindooDBAppViewHandle>;
}

/** Attachment operations exposed by an opened database handle. */
export interface MindooDBAppAttachmentApi {
  list(docId: string): Promise<MindooDBAppAttachmentInfo[]>;
  remove(docId: string, attachmentName: string): Promise<{ ok: true }>;
  openReadStream(docId: string, attachmentName: string): Promise<MindooDBAppReadableAttachmentStream>;
  openWriteStream(docId: string, attachmentName: string, contentType?: string): Promise<MindooDBAppWritableAttachmentStream>;
}

/** Database handle returned from `session.openDatabase()`. */
export interface MindooDBAppDatabase {
  info(): Promise<MindooDBAppDatabaseInfo>;
  documents: MindooDBAppDocumentApi;
  views: MindooDBAppViewApi;
  attachments: MindooDBAppAttachmentApi;
}

/** Connected session between the running app and the Administrator host. */
export interface MindooDBAppSession {
  getLaunchContext(): Promise<MindooDBAppLaunchContext>;
  listDatabases(): Promise<MindooDBAppDatabaseInfo[]>;
  openDatabase(databaseId: string): Promise<MindooDBAppDatabase>;
  onThemeChange(listener: (theme: MindooDBAppHostTheme) => void): () => void;
  disconnect(): Promise<void>;
}

/** Root SDK bridge object used to establish a session. */
export interface MindooDBAppBridge {
  connect(options?: MindooDBAppBridgeConnectOptions): Promise<MindooDBAppSession>;
}
