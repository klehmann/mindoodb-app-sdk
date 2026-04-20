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

/** Iframe viewport dimensions reported by the Haven host. */
export interface MindooDBAppViewport {
  width: number;
  height: number;
}

/** Host-controlled UI preferences exposed to embedded apps. */
export interface MindooDBAppUiPreferences {
  iosMultitaskingOptimized: boolean;
}

/** Saved categorization mode for Haven-managed view mappings delivered at launch time. */
export type MindooDBAppConfiguredViewCategorizationStyle = "document_then_category" | "category_then_document";

/** Preferred preview layout for a Haven-managed view mapping. */
export type MindooDBAppConfiguredViewPreviewMode = "tree" | "table";

/** Column role used by Haven-managed view mappings. */
export type MindooDBAppConfiguredViewColumnRole = "category" | "sort" | "display" | "total";

/** Filter authoring mode used by Haven-managed view mappings. */
export type MindooDBAppConfiguredViewFilterMode = "rules" | "formula";

/** Rule match mode used by visual-rule filters. */
export type MindooDBAppConfiguredViewRuleMatchMode = "all" | "any";

/** Visual-rule operator supported by Haven-managed view mappings. */
export type MindooDBAppConfiguredViewRuleOperator =
  | "eq"
  | "neq"
  | "contains"
  | "notContains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "exists"
  | "notExists";

/** Field/formula authoring modes for Haven-managed view columns. */
export type MindooDBAppConfiguredViewExpressionMode = "field" | "formula";

/** One visual filter rule inside a Haven-managed view mapping. */
export interface MindooDBAppConfiguredViewFilterRule {
  id: string;
  field: string;
  operator: MindooDBAppConfiguredViewRuleOperator;
  value?: string;
}

/** Field-based value expression used by Haven-managed view mappings. */
export interface MindooDBAppConfiguredViewFieldExpression {
  mode: "field";
  field: string;
}

/** Formula-based value expression used by Haven-managed view mappings. */
export interface MindooDBAppConfiguredViewFormulaExpression {
  mode: "formula";
  expression: MindooDBAppExpression;
}

/** Column expression authoring shape used by Haven-managed view mappings. */
export type MindooDBAppConfiguredViewValueExpression =
  | MindooDBAppConfiguredViewFieldExpression
  | MindooDBAppConfiguredViewFormulaExpression;

/** Rule-based filter stored by Haven for app-owned view mappings. */
export interface MindooDBAppConfiguredViewRuleFilterDefinition {
  mode: "rules";
  match: MindooDBAppConfiguredViewRuleMatchMode;
  rules: MindooDBAppConfiguredViewFilterRule[];
}

/** Formula-based filter stored by Haven for app-owned view mappings. */
export interface MindooDBAppConfiguredViewFormulaFilterDefinition {
  mode: "formula";
  expression: MindooDBAppBooleanExpression;
}

/** Full filter authoring shape stored for Haven-managed app view mappings. */
export type MindooDBAppConfiguredViewFilterDefinition =
  | MindooDBAppConfiguredViewRuleFilterDefinition
  | MindooDBAppConfiguredViewFormulaFilterDefinition;

/** Column definition stored for a Haven-managed app view mapping. */
export interface MindooDBAppConfiguredViewColumn {
  id: string;
  title: string;
  name: string;
  role: MindooDBAppConfiguredViewColumnRole;
  expression: MindooDBAppConfiguredViewValueExpression;
  sorting: MindooDBAppViewSortDirection;
  totalMode: MindooDBAppViewTotalMode;
  hidden: boolean;
}

/** One resolved source binding for an app-owned Haven view mapping. */
export interface MindooDBAppResolvedViewSource {
  origin: string;
  databaseId: string;
  title: string;
  targetMode: "local" | "server";
  connectionId?: string;
  tenantId: string;
  databaseName: string;
}

/** Full Haven-managed view mapping delivered to the running application at launch time. */
export interface MindooDBAppResolvedViewDefinition {
  id: string;
  description?: string;
  categorizationStyle: MindooDBAppConfiguredViewCategorizationStyle;
  previewMode: MindooDBAppConfiguredViewPreviewMode;
  sources: MindooDBAppResolvedViewSource[];
  filter: MindooDBAppConfiguredViewFilterDefinition;
  columns: MindooDBAppConfiguredViewColumn[];
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

/** Metadata about the current app launch supplied by the Haven host. */
export interface MindooDBAppLaunchContext {
  appId: string;
  appInstanceId: string;
  appVersion?: string;
  launchId: string;
  runtime: MindooDBAppRuntime;
  theme: MindooDBAppHostTheme;
  viewport: MindooDBAppViewport | null;
  uiPreferences: MindooDBAppUiPreferences;
  tenantId?: string;
  preferredDatabaseId?: string;
  user: {
    id: string;
    username: string;
  };
  launchParameters: Record<string, string>;
  databases: MindooDBAppDatabaseInfo[];
  views: MindooDBAppResolvedViewDefinition[];
}

/** Attachment metadata returned by the attachment APIs. */
export interface MindooDBAppAttachmentInfo {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/** Preview modes supported by the Haven-hosted attachment preview dialog. */
export type MindooDBAppAttachmentPreviewMode =
  | "image"
  | "pdf"
  | "text"
  | "markdown"
  | "docx"
  | "pptx"
  | "spreadsheet"
  | "video"
  | "audio";

/** Optional parameters for opening an attachment preview in Haven. */
export interface MindooDBAppAttachmentPreviewOptions {
  /** Historical snapshot timestamp previously obtained from `documents.history.getAtTimestamp()`. */
  timestamp?: number;
}

/** Resolved Haven preview session prepared for opening in a separate tab or window. */
export interface MindooDBAppAttachmentPreviewSession {
  sessionId: string;
  previewUrl: string;
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
  identityLabel?: string;
  publicKeyFingerprint?: string;
  isDeleted?: boolean;
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

/** Query options for paging through changefeed-backed document listings in a database. */
export interface MindooDBAppDocumentListQuery {
  cursor?: string | null;
  limit?: number;
  skip?: number;
  status?: "all" | "existing" | "deleted";
  metadataOnly?: boolean;
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
  /** Optional named document key. Defaults to `"default"` when omitted. */
  decryptionKeyId?: string;
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

/** Host-pushed event emitted when the Haven iframe viewport changes. */
export interface MindooDBAppBridgeViewportChangedMessage {
  protocol: "mindoodb-app-bridge";
  kind: "viewport-changed";
  viewport: MindooDBAppViewport;
}

/** Host-pushed event emitted when host-controlled UI preferences change. */
export interface MindooDBAppBridgeUiPreferencesChangedMessage {
  protocol: "mindoodb-app-bridge";
  kind: "ui-preferences-changed";
  uiPreferences: MindooDBAppUiPreferences;
}

/** Any message that can travel across the dedicated bridge MessagePort. */
export type MindooDBAppBridgePortMessage =
  | MindooDBAppBridgeRpcMessage
  | MindooDBAppBridgeStreamMessage
  | MindooDBAppBridgeThemeChangedMessage
  | MindooDBAppBridgeViewportChangedMessage
  | MindooDBAppBridgeUiPreferencesChangedMessage;

/** Placement hint for a host-rendered overlay menu. */
export type MindooDBAppMenuPlacement =
  | "auto"
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end"
  | "right-start"
  | "left-start";

/** Semantic hint allowing Haven to tune menu behavior or styling. */
export type MindooDBAppMenuKind = "context" | "dropdown" | "picker";

/** Rectangle expressed in app-viewport coordinates. */
export interface MindooDBAppMenuRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Point anchor used for context menus or other click-triggered overlays. */
export interface MindooDBAppMenuPointAnchor {
  type: "point";
  x: number;
  y: number;
}

/** Rectangle anchor used for toolbar menus or picker buttons. */
export interface MindooDBAppMenuRectAnchor {
  type: "rect";
  rect: MindooDBAppMenuRect;
}

/** Anchor describing where the host should position the rendered menu. */
export type MindooDBAppMenuAnchor =
  | MindooDBAppMenuPointAnchor
  | MindooDBAppMenuRectAnchor;

/** Visual separator between menu groups. */
export interface MindooDBAppMenuSeparatorItem {
  separator: true;
}

/** One actionable entry in a structured host-rendered menu. */
export interface MindooDBAppMenuCommandItem {
  id: string;
  label: string;
  enabled?: boolean;
  destructive?: boolean;
  checked?: boolean;
  items?: MindooDBAppMenuItem[];
}

/** Structured menu item transported over the app bridge. */
export type MindooDBAppMenuItem =
  | MindooDBAppMenuSeparatorItem
  | MindooDBAppMenuCommandItem;

/** Request payload for a host-rendered overlay menu. */
export interface MindooDBAppShowMenuInput {
  anchor: MindooDBAppMenuAnchor;
  placement?: MindooDBAppMenuPlacement;
  kind?: MindooDBAppMenuKind;
  items: MindooDBAppMenuItem[];
  dismissOnOutsideClick?: boolean;
  dismissOnEscape?: boolean;
  dismissOnViewportChange?: boolean;
}

/** Reason why a host-rendered menu was dismissed without a selection. */
export type MindooDBAppMenuDismissReason =
  | "outside_click"
  | "escape"
  | "app_blur"
  | "viewport_change"
  | "hide"
  | "replaced";

/** Successful selection result returned from a host-rendered menu. */
export interface MindooDBAppMenuSelectionResult {
  action: "selected";
  itemId: string;
}

/** Dismissal result returned from a host-rendered menu. */
export interface MindooDBAppMenuDismissedResult {
  action: "dismissed";
  reason: MindooDBAppMenuDismissReason;
}

/** Result returned when Haven closes or resolves a host-rendered menu. */
export type MindooDBAppShowMenuResult =
  | MindooDBAppMenuSelectionResult
  | MindooDBAppMenuDismissedResult;

/** Overlay menu operations exposed by the host session. */
export interface MindooDBAppMenuApi {
  show(input: MindooDBAppShowMenuInput): Promise<MindooDBAppShowMenuResult>;
  hide(): Promise<void>;
}

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

export type MindooDBAppViewEntryKind = "category" | "document";

/** Unique document identity within a multi-source view. */
export interface MindooDBAppScopedDocId {
  origin: string;
  docId: string;
}

/** Serialized view entry returned by the navigator APIs. */
export interface MindooDBAppViewEntry {
  /** Unique occurrence key within the current navigator session. */
  key: string;
  kind: MindooDBAppViewEntryKind;
  origin: string;
  docId: string | null;
  level: number;
  parentKey: string | null;
  categoryPath: unknown[];
  columnValues: Record<string, unknown>;
  descendantDocumentCount: number;
  childCategoryCount: number;
  childDocumentCount: number;
  /** Stable continuation token for the current occurrence. */
  position: string | null;
  expanded: boolean;
  selected: boolean;
  isVisible: boolean;
}

/** Options that shape which subtree and entry kinds a navigator exposes. */
export interface MindooDBAppViewNavigatorOpenOptions {
  includeCategories?: boolean;
  includeDocuments?: boolean;
  hideEmptyCategories?: boolean;
  rootCategoryPath?: unknown[];
  rootEntryKey?: string;
}

/** Input used when creating a dynamic view and immediately opening a navigator. */
export interface MindooDBAppCreateViewNavigatorInput {
  databaseIds: string[];
  definition: MindooDBAppViewDefinition;
  options?: MindooDBAppViewNavigatorOpenOptions;
}

/** @deprecated Use `MindooDBAppCreateViewNavigatorInput`. */
export type MindooDBAppCreateViewInput = MindooDBAppCreateViewNavigatorInput;

/** Range query options for key and key-range lookups within a category. */
export interface MindooDBAppViewNavigatorRangeQuery {
  startKey?: unknown;
  endKey?: unknown;
  descending?: boolean;
  exact?: boolean;
}

/** Options for batched navigator reads. */
export interface MindooDBAppViewNavigatorPageOptions {
  limit?: number;
  selectedOnly?: boolean;
  startPosition?: string | null;
}

/** Paged batch of navigator entries. */
export interface MindooDBAppViewNavigatorPageResult {
  entries: MindooDBAppViewEntry[];
  nextPosition: string | null;
  hasMore: boolean;
}

/** Serializable selection state for restoring a navigator session. */
export interface MindooDBAppViewNavigatorSelectionState {
  selectAllByDefault: boolean;
  entryKeys: string[];
}

/** Serializable expansion state for restoring a navigator session. */
export interface MindooDBAppViewNavigatorExpansionState {
  expandAllByDefault: boolean;
  expandLevel: number;
  entryKeys: string[];
}

/** Stateful view navigator that closely mirrors the core VirtualViewNavigator. */
export interface MindooDBAppViewNavigator {
  getDefinition(): Promise<MindooDBAppViewDefinition>;
  refresh(): Promise<void>;
  getCurrentEntry(): Promise<MindooDBAppViewEntry | null>;
  gotoFirst(): Promise<boolean>;
  gotoLast(): Promise<boolean>;
  gotoNext(): Promise<boolean>;
  gotoPrev(): Promise<boolean>;
  gotoNextSibling(): Promise<boolean>;
  gotoPrevSibling(): Promise<boolean>;
  gotoParent(): Promise<boolean>;
  gotoFirstChild(): Promise<boolean>;
  gotoLastChild(): Promise<boolean>;
  gotoPos(position: string): Promise<boolean>;
  getPos(position: string): Promise<MindooDBAppViewEntry | null>;
  findCategoryEntryByParts(parts: unknown[]): Promise<MindooDBAppViewEntry | null>;
  entriesForward(options?: MindooDBAppViewNavigatorPageOptions): Promise<MindooDBAppViewNavigatorPageResult>;
  entriesBackward(options?: MindooDBAppViewNavigatorPageOptions): Promise<MindooDBAppViewNavigatorPageResult>;
  gotoNextSelected(): Promise<boolean>;
  gotoPrevSelected(): Promise<boolean>;
  select(origin: string, docId: string, selectParentCategories?: boolean): Promise<void>;
  deselect(origin: string, docId: string): Promise<void>;
  selectAllEntries(): Promise<void>;
  deselectAllEntries(): Promise<void>;
  isSelected(origin: string, docId: string): Promise<boolean>;
  getSelectionState(): Promise<MindooDBAppViewNavigatorSelectionState>;
  setSelectionState(state: MindooDBAppViewNavigatorSelectionState): Promise<void>;
  expand(origin: string, docId: string): Promise<void>;
  collapse(origin: string, docId: string): Promise<void>;
  expandAll(): Promise<void>;
  collapseAll(): Promise<void>;
  expandToLevel(level: number): Promise<void>;
  isExpanded(entryKey: string): Promise<boolean>;
  getExpansionState(): Promise<MindooDBAppViewNavigatorExpansionState>;
  setExpansionState(state: MindooDBAppViewNavigatorExpansionState): Promise<void>;
  childEntries(entryKey: string, descending?: boolean): Promise<MindooDBAppViewEntry[]>;
  childCategories(entryKey: string, descending?: boolean): Promise<MindooDBAppViewEntry[]>;
  childDocuments(entryKey: string, descending?: boolean): Promise<MindooDBAppViewEntry[]>;
  childCategoriesByKey(entryKey: string, key: unknown, exact?: boolean, descending?: boolean): Promise<MindooDBAppViewEntry[]>;
  childDocumentsByKey(entryKey: string, key: unknown, exact?: boolean, descending?: boolean): Promise<MindooDBAppViewEntry[]>;
  childCategoriesBetween(entryKey: string, range: MindooDBAppViewNavigatorRangeQuery): Promise<MindooDBAppViewEntry[]>;
  childDocumentsBetween(entryKey: string, range: MindooDBAppViewNavigatorRangeQuery): Promise<MindooDBAppViewEntry[]>;
  getSortedDocIds(descending?: boolean): Promise<MindooDBAppScopedDocId[]>;
  getSortedDocIdsScoped(entryKey: string, descending?: boolean): Promise<MindooDBAppScopedDocId[]>;
  dispose(): Promise<void>;
}

/** Attachment operations exposed by an opened database handle. */
export interface MindooDBAppAttachmentApi {
  list(docId: string): Promise<MindooDBAppAttachmentInfo[]>;
  remove(docId: string, attachmentName: string): Promise<{ ok: true }>;
  openReadStream(docId: string, attachmentName: string): Promise<MindooDBAppReadableAttachmentStream>;
  openWriteStream(docId: string, attachmentName: string, contentType?: string): Promise<MindooDBAppWritableAttachmentStream>;
  preparePreviewSession(
    docId: string,
    attachmentName: string,
    options?: MindooDBAppAttachmentPreviewOptions,
  ): Promise<MindooDBAppAttachmentPreviewSession>;
  openPreview(
    docId: string,
    attachmentName: string,
    options?: MindooDBAppAttachmentPreviewOptions,
  ): Promise<{ ok: true }>;
}

/** Database handle returned from `session.openDatabase()`. */
export interface MindooDBAppDatabase {
  info(): Promise<MindooDBAppDatabaseInfo>;
  documents: MindooDBAppDocumentApi;
  attachments: MindooDBAppAttachmentApi;
}

/** Connected session between the running app and the Administrator host. */
export interface MindooDBAppSession {
  getLaunchContext(): Promise<MindooDBAppLaunchContext>;
  listDatabases(): Promise<MindooDBAppDatabaseInfo[]>;
  openDatabase(databaseId: string): Promise<MindooDBAppDatabase>;
  createViewNavigator(input: MindooDBAppCreateViewNavigatorInput): Promise<MindooDBAppViewNavigator>;
  openViewNavigator(viewId: string, options?: MindooDBAppViewNavigatorOpenOptions): Promise<MindooDBAppViewNavigator>;
  menus: MindooDBAppMenuApi;
  onThemeChange(listener: (theme: MindooDBAppHostTheme) => void): () => void;
  onViewportChange(listener: (viewport: MindooDBAppViewport) => void): () => void;
  onUiPreferencesChange(listener: (uiPreferences: MindooDBAppUiPreferences) => void): () => void;
  disconnect(): Promise<void>;
}

/** Root SDK bridge object used to establish a session. */
export interface MindooDBAppBridge {
  connect(options?: MindooDBAppBridgeConnectOptions): Promise<MindooDBAppSession>;
}
