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

export type MindooDBAppRuntime = "iframe" | "window";

export type MindooDBAppCapability =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "history"
  | "attachments"
  | "views";

export interface MindooDBAppLaunchContext {
  appId: string;
  appInstanceId: string;
  appVersion?: string;
  launchId: string;
  runtime: MindooDBAppRuntime;
  tenantId?: string;
  preferredDatabaseId?: string;
  user: {
    id: string;
    username: string;
  };
  launchParameters: Record<string, string>;
}

export interface MindooDBAppAttachmentInfo {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface MindooDBAppDatabaseInfo {
  id: string;
  title: string;
  role?: string;
  capabilities: MindooDBAppCapability[];
}

export interface MindooDBAppDocumentSummary {
  id: string;
  data?: Record<string, unknown>;
  attachmentCount?: number;
  updatedAt?: string;
}

export interface MindooDBAppDocument {
  id: string;
  data: Record<string, unknown>;
  attachments?: MindooDBAppAttachmentInfo[];
  updatedAt?: string;
}

export interface MindooDBAppDocumentHistoryEntry {
  timestamp: number;
  publicKey: string;
  publicKeyFingerprint?: string;
  identityLabel?: string;
  isDeleted: boolean;
  isCurrent: boolean;
  summary?: string;
}

export interface MindooDBAppHistoricalDocument {
  id: string;
  timestamp: number;
  state: "missing" | "deleted" | "exists";
  data: Record<string, unknown> | null;
}

export interface MindooDBAppDocumentListQuery {
  limit?: number;
  cursor?: string | null;
  fields?: string[];
  filter?: Record<string, unknown>;
}

export interface MindooDBAppDocumentListResult {
  items: MindooDBAppDocumentSummary[];
  nextCursor: string | null;
}

export interface MindooDBAppCreateDocumentInput {
  data: Record<string, unknown>;
}

export interface MindooDBAppUpdateDocumentInput {
  data: Record<string, unknown>;
}

export interface MindooDBAppHistoryQuery {
  timestamp: number;
}

export interface MindooDBAppBridgeConnectOptions {
  launchId?: string;
  targetOrigin?: string;
  connectTimeoutMs?: number;
}

export interface MindooDBAppBridgeConnectMessage {
  protocol: "mindoodb-app-bridge";
  type: "mindoodb-app:connect";
  launchId: string;
}

export interface MindooDBAppBridgeConnectedMessage {
  protocol: "mindoodb-app-bridge";
  type: "mindoodb-app:connected";
}

export interface MindooDBAppBridgeErrorPayload {
  code: string;
  message: string;
}

export interface MindooDBAppBridgeRpcRequest<TParams = unknown> {
  protocol: "mindoodb-app-bridge";
  kind: "request";
  id: string;
  method: string;
  params: TParams;
}

export interface MindooDBAppBridgeRpcSuccess<TResult = unknown> {
  protocol: "mindoodb-app-bridge";
  kind: "success";
  id: string;
  result: TResult;
}

export interface MindooDBAppBridgeRpcError {
  protocol: "mindoodb-app-bridge";
  kind: "error";
  id: string;
  error: MindooDBAppBridgeErrorPayload;
}

export type MindooDBAppBridgeRpcMessage =
  | MindooDBAppBridgeRpcRequest
  | MindooDBAppBridgeRpcSuccess
  | MindooDBAppBridgeRpcError;

export interface MindooDBAppBridgeStreamOpenResult {
  streamId: string;
}

export interface MindooDBAppBridgeStreamReadRequest {
  protocol: "mindoodb-app-bridge";
  kind: "stream-read";
  streamId: string;
}

export interface MindooDBAppBridgeStreamWriteRequest {
  protocol: "mindoodb-app-bridge";
  kind: "stream-write";
  streamId: string;
  chunk: ArrayBuffer;
}

export interface MindooDBAppBridgeStreamCloseRequest {
  protocol: "mindoodb-app-bridge";
  kind: "stream-close";
  streamId: string;
}

export interface MindooDBAppBridgeStreamAbortRequest {
  protocol: "mindoodb-app-bridge";
  kind: "stream-abort";
  streamId: string;
}

export interface MindooDBAppAttachmentChunk {
  protocol: "mindoodb-app-bridge";
  kind: "stream-chunk";
  streamId: string;
  chunk?: ArrayBuffer;
  done: boolean;
}

export interface MindooDBAppBridgeStreamAck {
  protocol: "mindoodb-app-bridge";
  kind: "stream-ack";
  streamId: string;
}

export interface MindooDBAppBridgeStreamError {
  protocol: "mindoodb-app-bridge";
  kind: "stream-error";
  streamId: string;
  error: MindooDBAppBridgeErrorPayload;
}

export type MindooDBAppBridgeStreamMessage =
  | MindooDBAppBridgeStreamReadRequest
  | MindooDBAppBridgeStreamWriteRequest
  | MindooDBAppBridgeStreamCloseRequest
  | MindooDBAppBridgeStreamAbortRequest
  | MindooDBAppAttachmentChunk
  | MindooDBAppBridgeStreamAck
  | MindooDBAppBridgeStreamError;

export type MindooDBAppBridgePortMessage = MindooDBAppBridgeRpcMessage | MindooDBAppBridgeStreamMessage;

export interface MindooDBAppReadableAttachmentStream {
  read(): Promise<Uint8Array | null>;
  close(): Promise<void>;
}

export interface MindooDBAppWritableAttachmentStream {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface MindooDBAppDocumentApi {
  list(query?: MindooDBAppDocumentListQuery): Promise<MindooDBAppDocumentListResult>;
  get(docId: string): Promise<MindooDBAppDocument | null>;
  create(input: MindooDBAppCreateDocumentInput): Promise<MindooDBAppDocument>;
  update(docId: string, patch: MindooDBAppUpdateDocumentInput): Promise<MindooDBAppDocument>;
  delete(docId: string): Promise<{ ok: true }>;
  listHistory(docId: string): Promise<MindooDBAppDocumentHistoryEntry[]>;
  getAtTimestamp(docId: string, timestamp: number): Promise<MindooDBAppHistoricalDocument>;
}

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

export interface MindooDBAppViewApi {
  create(definition: MindooDBAppViewDefinition): Promise<MindooDBAppViewHandle>;
  open(viewId: string): Promise<MindooDBAppViewHandle>;
}

export interface MindooDBAppAttachmentApi {
  list(docId: string): Promise<MindooDBAppAttachmentInfo[]>;
  remove(docId: string, attachmentName: string): Promise<{ ok: true }>;
  openReadStream(docId: string, attachmentName: string): Promise<MindooDBAppReadableAttachmentStream>;
  openWriteStream(docId: string, attachmentName: string, contentType?: string): Promise<MindooDBAppWritableAttachmentStream>;
}

export interface MindooDBAppDatabase {
  info(): Promise<MindooDBAppDatabaseInfo>;
  documents: MindooDBAppDocumentApi;
  views: MindooDBAppViewApi;
  attachments: MindooDBAppAttachmentApi;
}

export interface MindooDBAppSession {
  getLaunchContext(): Promise<MindooDBAppLaunchContext>;
  listDatabases(): Promise<MindooDBAppDatabaseInfo[]>;
  openDatabase(databaseId: string): Promise<MindooDBAppDatabase>;
  disconnect(): Promise<void>;
}

export interface MindooDBAppBridge {
  connect(options?: MindooDBAppBridgeConnectOptions): Promise<MindooDBAppSession>;
}
