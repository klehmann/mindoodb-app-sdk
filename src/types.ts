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

/** Launch target used by the Haven when opening an app. */
export type MindooDBAppRuntime = "iframe" | "window";

/** Theme mode currently active in the Haven host UI. */
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
export type MindooDBAppConfiguredViewCategorizationStyle =
  | "document_then_category"
  | "category_then_document";

/** Preferred preview layout for a Haven-managed view mapping. */
export type MindooDBAppConfiguredViewPreviewMode = "tree" | "table";

/** Column role used by Haven-managed view mappings. */
export type MindooDBAppConfiguredViewColumnRole =
  | "category"
  | "sort"
  | "display"
  | "total";

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
  /**
   * The host's currently selected UI language as a BCP-47 language tag (e.g.
   * `"en"`, `"de"`). Apps should map this to their own set of supported
   * locales and fall back to their default when the tag is unknown. Subscribe
   * to {@link MindooDBAppSession.onLocaleChange} to react to live changes.
   */
  locale: string;
  tenantId?: string;
  preferredDatabaseId?: string;
  /**
   * Epoch-millisecond cutoff when the host opened app databases in time travel
   * read-only mode. Absent/null means the app is looking at live data.
   */
  timeTravelDate?: number | null;
  user: {
    id: string;
    username: string;
  };
  licensedProducts?: string[];
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
  /** Stable revision id previously obtained from `documents.listHistory()`. */
  revisionId?: MindooDBAppDocumentRevisionId;
}

export type MindooDBAppDocumentScanPreset =
  | "auto"
  | "a4-portrait"
  | "a4-landscape"
  | "letter-portrait"
  | "letter-landscape";

export interface MindooDBAppScanAttachmentOptions {
  defaultFileName?: string;
  preset?: MindooDBAppDocumentScanPreset;
  mimeType?: "image/jpeg" | "image/png" | "application/pdf";
}

export interface MindooDBAppScanAttachmentResult {
  ok: boolean;
  attachment?: MindooDBAppAttachmentInfo | null;
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
  createdAt?: string;
  updatedAt?: string;
  identityLabel?: string;
  publicKeyFingerprint?: string;
  isDeleted?: boolean;
}

/** Fully loaded document returned by `get()`, `create()`, or `update()`. */
export interface MindooDBAppDocument {
  id: string;
  data: Record<string, unknown>;
  /** Current Automerge heads for causal text edit reconciliation. */
  heads?: string[];
  attachments?: MindooDBAppAttachmentInfo[];
  createdAt?: string;
  updatedAt?: string;
}

/** Opaque persisted id for a document revision in the MindooDB DAG. */
export type MindooDBAppDocumentRevisionId = string;

/** One entry in the document history timeline. */
export interface MindooDBAppDocumentHistoryEntry {
  revisionId: MindooDBAppDocumentRevisionId;
  timestamp: number;
  heads?: string[];
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
  revisionId?: MindooDBAppDocumentRevisionId;
  timestamp: number;
  heads?: string[];
  state: "missing" | "deleted" | "exists";
  data: Record<string, unknown> | null;
  attachments?: MindooDBAppAttachmentInfo[];
  attachmentSnapshotRevisionId?: MindooDBAppDocumentRevisionId | null;
}

/** Query options for paging through changefeed-backed document listings in a database. */
export interface MindooDBAppDocumentListQuery {
  /**
   * Opaque changefeed checkpoint previously returned as `nextCursor`.
   * Omit or pass `null` to start from the beginning of the changefeed.
   */
  cursor?: string | null;
  /** Maximum number of matches to return (host default: 50). */
  limit?: number;
  /** Skip this many matching entries after the cursor without loading their bodies. */
  skip?: number;
  /**
   * Deletion-state filter (default `"existing"`). Use `"all"` for derived
   * indexes so deletions become visible and can be removed downstream.
   */
  status?: "all" | "existing" | "deleted";
  /** Return only `{ id, isDeleted }` per row — the fastest listing mode. */
  metadataOnly?: boolean;
  /** Project specific top-level JSON fields into `data` instead of the full document. */
  fields?: string[];
  /** Simple equality filter on top-level document data fields. */
  filter?: Record<string, unknown>;
}

/** Paged result returned by `documents.list()`. */
export interface MindooDBAppDocumentListResult {
  items: MindooDBAppDocumentSummary[];
  /**
   * Checkpoint reached by this page — persist it and pass it back as
   * `cursor` to resume. `null` when there were no changes after the
   * supplied cursor.
   */
  nextCursor: string | null;
}

/** Latest known changefeed cursor for a database. */
export interface MindooDBAppDocumentHeadCursorResult {
  cursor: string | null;
}

/** Opaque cursor representing the DB state reflected in a bridge-built view snapshot. */
export interface MindooDBAppViewCursorResult {
  viewCursor: string | null;
}

/** Lightweight document row returned by multi-source view-cursor delta queries. */
export interface MindooDBAppScopedDocumentSummary extends MindooDBAppDocumentSummary {
  origin: string;
  databaseId: string;
}

/** Result returned when querying document changes since a view snapshot cursor. */
export interface MindooDBAppViewCursorDocumentListResult {
  items: MindooDBAppScopedDocumentSummary[];
  nextCursor: string | null;
}

/**
 * Tier of an access-control decision. `tier1` decisions are fully determined by
 * the signer/policy; `tier2` decisions depend on document content rules.
 */
export type MindooDBAppAccessTier = "tier1" | "tier2";

/**
 * Result of a non-throwing write-access prediction (`documents.canCreate`,
 * `canChange`, `canDelete`, `canUndelete`). `allowed === true` means the host
 * predicts the operation would succeed for the current app and identity,
 * accounting for the app's granted capabilities, time-travel read-only mode,
 * and the database's MindooDB write access policy. `reason` is a human-readable
 * explanation suitable for tooltips/audit logs.
 */
export interface MindooDBAppAccessDecision {
  allowed: boolean;
  reason: string;
  tier: MindooDBAppAccessTier;
  matchedRuleId?: string;
}

/**
 * Payload used when creating a new document.
 *
 * `set` becomes the initial top-level document state, mirroring the update
 * API's field-assignment language while still creating a brand-new document.
 */
export interface MindooDBAppCreateDocumentInput {
  set: Record<string, unknown>;
  /** Optional named document key. Defaults to `"default"` when omitted. */
  decryptionKeyId?: string;
  /**
   * Optional caller-provided document id. When omitted, MindooDB generates a
   * UUID7. When provided, the id must match `^[A-Za-z][A-Za-z0-9_]*$`: the
   * first character is an ASCII letter and subsequent characters may be ASCII
   * letters, ASCII digits, or `_`.
   *
   * If a document with this id already exists locally, MindooDB returns the
   * existing document instead of creating a new one (idempotent create), and
   * the values in `set` are NOT applied. Caller-provided ids are useful for
   * loading a known well-known document directly without first building a
   * view, and for migrations that want to preserve external ids.
   *
   * Documents created with the same caller-provided id on independent replicas
   * share Automerge ancestry, so subsequent edits on either replica still
   * merge correctly when the replicas sync.
   */
  id?: string;
}

export interface MindooDBAppTextEdit {
  index: number;
  deleteCount: number;
  insert?: string;
}

export interface MindooDBAppTextPatch {
  path: Array<string | number>;
  baseHeads?: string[];
  edits: MindooDBAppTextEdit[];
}

export type MindooDBAppRichTextScalar =
  | string
  | number
  | boolean
  | null;

export interface MindooDBAppRichTextImmutableString {
  type: "immutableString";
  value: string;
}

export type MindooDBAppRichTextMaterializeValue =
  | MindooDBAppRichTextScalar
  | MindooDBAppRichTextImmutableString
  | MindooDBAppRichTextMaterializeValue[]
  | { [key: string]: MindooDBAppRichTextMaterializeValue };

export interface MindooDBAppRichTextTextSpan {
  type: "text";
  value: string;
  marks?: Record<string, MindooDBAppRichTextMaterializeValue>;
}

export interface MindooDBAppRichTextBlockSpan {
  type: "block";
  value: Record<string, MindooDBAppRichTextMaterializeValue>;
}

export type MindooDBAppRichTextSpan =
  | MindooDBAppRichTextTextSpan
  | MindooDBAppRichTextBlockSpan;

export interface MindooDBAppRichTextMarkRange {
  index: number;
  length: number;
  marks: Record<string, MindooDBAppRichTextMaterializeValue>;
}

export interface MindooDBAppRichTextSpliceStep {
  type: "splice";
  index: number;
  deleteCount: number;
  insert?: string;
  marks?: MindooDBAppRichTextMarkRange[];
}

export type MindooDBAppRichTextStep = MindooDBAppRichTextSpliceStep;

export interface MindooDBAppRichTextStepPatch {
  /** Path to the Automerge rich-text field inside the document payload. */
  path: Array<string | number>;
  /** Automerge heads of the document state these positional steps were based on. */
  baseHeads?: string[];
  /** Ordered rich-text positional operations to apply with Automerge splice/mark. */
  steps: MindooDBAppRichTextStep[];
}

export interface MindooDBAppRichTextPatch {
  /** Path to the Automerge rich-text field inside the document payload. */
  path: Array<string | number>;
  /** Automerge heads of the document state this rich-text snapshot was based on. */
  baseHeads?: string[];
  /** Full JSON-safe span snapshot to apply with Automerge `updateSpans`. */
  spans?: MindooDBAppRichTextSpan[];
  /** Ordered snapshots to apply one-by-one so each `updateSpans` diff stays transaction-sized. */
  spansSequence?: MindooDBAppRichTextSpan[][];
  /** Optional Automerge `updateSpans` configuration, kept JSON-safe over the bridge. */
  updateSpansConfig?: Record<string, unknown>;
}

export interface MindooDBAppRichTextSnapshot {
  path: Array<string | number>;
  heads?: string[];
  spans: MindooDBAppRichTextSpan[];
}

export interface MindooDBAppRichTextGetOptions {
  /** Stable revision id previously obtained from `documents.listHistory()`. */
  revisionId?: MindooDBAppDocumentRevisionId;
}

/** Binary Automerge snapshot of the full internal document. */
export interface MindooDBAppAutomergeSnapshot {
  binary: Uint8Array;
  heads: string[];
}

export interface MindooDBAppAutomergeGetOptions {
  /** Stable revision id previously obtained from `documents.listHistory()`. */
  revisionId?: MindooDBAppDocumentRevisionId;
}

/** Raw Automerge change bytes produced by a local replica. */
export interface MindooDBAppAutomergeChangesPatch {
  /** Heads the client had when authoring `changes`; optional, for correlation only. */
  baseHeads?: string[];
  /**
   * Heads of the local replica after authoring `changes`. When provided, the
   * apply response includes `changesSince` for incremental reconciliation.
   */
  replicaHeads?: string[];
  /** Change bytes from `Automerge.getChangesSince`; merged into Haven's current doc. */
  changes: Uint8Array[];
}

/** Incremental catch-up bytes for a local replica after an apply merge. */
export interface MindooDBAppAutomergeChangesSince {
  /** Echo of `replicaHeads` from the request. */
  sinceHeads: string[];
  /** Changes on the merged canonical doc that the replica is missing. */
  changes: Uint8Array[];
}

export interface MindooDBAppAutomergePatchResult {
  document: MindooDBAppDocument;
  heads: string[];
  /**
   * Present when the request included `replicaHeads`. Apply locally with
   * `Automerge.applyChanges` instead of reloading a full snapshot.
   */
  changesSince?: MindooDBAppAutomergeChangesSince;
}

/**
 * Sets the value at `path` inside the document payload.
 *
 * Creates the field if it does not exist, or replaces the existing value.
 * `path` addresses a property using object keys and list indices, for example
 * `["workbook", "worksheetsById", "ws-1", "title"]`.
 */
export interface MindooDBAppJsonSetPatch {
  path: Array<string | number>;
  value: unknown;
}

/**
 * Removes the value at `path` from the document payload.
 *
 * For object properties this deletes the key; for list entries the host
 * decides whether unset is supported and may reject the patch.
 */
export interface MindooDBAppJsonUnsetPatch {
  path: Array<string | number>;
}

/**
 * Inserts one or more values into the list located at `path`.
 *
 * `index` is the insertion point within the current list, where `0` prepends
 * and `list.length` appends. Existing entries at or after `index` shift right.
 */
export interface MindooDBAppJsonListInsertPatch {
  path: Array<string | number>;
  index: number;
  values: unknown[];
}

/**
 * Deletes a contiguous run of entries from the list located at `path`.
 *
 * Removes `deleteCount` entries starting at `index`. Subsequent entries shift
 * left to fill the gap.
 */
export interface MindooDBAppJsonListDeletePatch {
  path: Array<string | number>;
  index: number;
  deleteCount: number;
}

/**
 * Splices text at `path` using Automerge text semantics.
 */
export interface MindooDBAppJsonTextSplicePatch {
  path: Array<string | number>;
  index: number;
  deleteCount: number;
  insert?: string;
}

/**
 * Applies one or more marks to a text range at `path`.
 */
export interface MindooDBAppJsonTextMarkPatch {
  path: Array<string | number>;
  index: number;
  length: number;
  marks: Record<string, MindooDBAppRichTextMaterializeValue>;
}

/**
 * Removes marks from a text range at `path`.
 */
export interface MindooDBAppJsonTextUnmarkPatch {
  path: Array<string | number>;
  index: number;
  length: number;
  names: string[];
}

export interface MindooDBAppJsonPatch {
  /**
   * Automerge heads of the document snapshot this JSON patch was authored
   * against. Hosts can use this to apply order-sensitive edits at the original
   * causal version and merge them with concurrent changes.
   */
  baseHeads?: string[];
  set?: MindooDBAppJsonSetPatch[];
  unset?: MindooDBAppJsonUnsetPatch[];
  listInsert?: MindooDBAppJsonListInsertPatch[];
  listDelete?: MindooDBAppJsonListDeletePatch[];
  textSplice?: MindooDBAppJsonTextSplicePatch[];
  textMark?: MindooDBAppJsonTextMarkPatch[];
  textUnmark?: MindooDBAppJsonTextUnmarkPatch[];
}

/**
 * Sparse patch payload used when updating an existing document.
 *
 * Prefer targeted `set` / `unset` operations over whole-document rewrites so
 * MindooDB can preserve more meaningful change history and Automerge can merge
 * smaller, more intentional updates.
 */
export interface MindooDBAppUpdateDocumentInput {
  /** Top-level fields to assign on the document. */
  set?: Record<string, unknown>;
  /** Top-level fields to remove from the document entirely. */
  unset?: string[];
  /** Granular JSON operations to apply at document paths. */
  json?: MindooDBAppJsonPatch;
  /** Granular text edits to apply at document paths. */
  text?: MindooDBAppTextPatch[];
  /** Rich-text span snapshots to apply at document paths. */
  richText?: MindooDBAppRichTextPatch[];
  /** Rich-text positional steps to apply at document paths. */
  richTextSteps?: MindooDBAppRichTextStepPatch[];
}

/** Query used for history lookups at a specific timestamp. */
export interface MindooDBAppHistoryQuery {
  timestamp: number;
}

/** Optional parameters for establishing the app bridge connection. */
export interface MindooDBAppBridgeConnectOptions {
  /**
   * Launch id issued by Haven. Defaults to the `mindoodbAppLaunchId` query
   * parameter that Haven appends to the app URL.
   */
  launchId?: string;
  /**
   * Origin the handshake `postMessage` is sent to (default `"*"`). Pin this
   * to the Haven origin when it is known.
   */
  targetOrigin?: string;
  /** How long to wait for the host to answer the handshake before rejecting (default 10000 ms). */
  connectTimeoutMs?: number;
}

/** Initial postMessage handshake sent from the app to the Haven. */
export interface MindooDBAppBridgeConnectMessage {
  protocol: "mindoodb-app-bridge";
  type: "mindoodb-app:connect";
  launchId: string;
}

/** Handshake acknowledgement returned by the Haven host. */
export interface MindooDBAppBridgeConnectedMessage {
  protocol: "mindoodb-app-bridge";
  type: "mindoodb-app:connected";
}

/** Handshake error returned when the Haven host rejects a launch. */
export interface MindooDBAppBridgeHandshakeErrorMessage {
  protocol: "mindoodb-app-bridge";
  type: "mindoodb-app:error";
  error: string;
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

/** Host-pushed event emitted when the Haven theme changes. */
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

/** Host-pushed event emitted when the Haven UI language changes. */
export interface MindooDBAppBridgeLocaleChangedMessage {
  protocol: "mindoodb-app-bridge";
  kind: "locale-changed";
  /** BCP-47 language tag of the newly selected host locale (e.g. `"de"`). */
  locale: string;
}

/**
 * Host-pushed event carrying a changed live-query result.
 *
 * The host only sends this when the result fingerprint actually changed
 * (or after an explicit `refresh()`), so bursts of writes produce at most
 * one coalesced push per re-evaluation.
 */
export interface MindooDBAppBridgeQueryResultMessage {
  protocol: "mindoodb-app-bridge";
  kind: "query-result";
  subscriptionId: string;
  result: MindooDBAppQueryResult;
}

/**
 * Host-pushed event fired after the view behind a navigator applied a
 * change batch. The navigator surface (entries, counts, positions) may
 * have changed; apps typically re-read the visible page.
 */
export interface MindooDBAppBridgeViewChangedMessage {
  protocol: "mindoodb-app-bridge";
  kind: "view-changed";
  navigatorId: string;
  stats: MindooDBAppViewUpdateStats;
}

/** Any message that can travel across the dedicated bridge MessagePort. */
export type MindooDBAppBridgePortMessage =
  | MindooDBAppBridgeRpcMessage
  | MindooDBAppBridgeStreamMessage
  | MindooDBAppBridgeThemeChangedMessage
  | MindooDBAppBridgeViewportChangedMessage
  | MindooDBAppBridgeUiPreferencesChangedMessage
  | MindooDBAppBridgeLocaleChangedMessage
  | MindooDBAppBridgeQueryResultMessage
  | MindooDBAppBridgeViewChangedMessage;

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
  /** Where to position the menu, in app-viewport (iframe-relative) coordinates. */
  anchor: MindooDBAppMenuAnchor;
  placement?: MindooDBAppMenuPlacement;
  kind?: MindooDBAppMenuKind;
  items: MindooDBAppMenuItem[];
  /** Dismiss when the user clicks outside the menu (default `true`). */
  dismissOnOutsideClick?: boolean;
  /** Dismiss when the user presses Escape (default `true`). */
  dismissOnEscape?: boolean;
  /** Dismiss when the app viewport is resized (default `true`). */
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

/**
 * Overlay menu operations exposed by the host session. Haven renders the
 * menu above the app iframe so it can escape the iframe clip rect —
 * data-only (no HTML/CSS/script crosses the bridge). Intended for
 * `runtime === "iframe"`; window-mode apps can usually render local menus.
 */
export interface MindooDBAppMenuApi {
  /**
   * Show a host-rendered menu at the given anchor (iframe-relative
   * coordinates) and resolve once the user selects an item
   * (`{ action: "selected", itemId }`) or the menu is dismissed
   * (`{ action: "dismissed", reason }`). Showing a new menu replaces a
   * pending one.
   */
  show(input: MindooDBAppShowMenuInput): Promise<MindooDBAppShowMenuResult>;
  /** Dismiss a pending host-rendered menu (its `show()` resolves with reason `"hide"`). */
  hide(): Promise<void>;
}

/** Pull-based read stream for document attachments. */
export interface MindooDBAppReadableAttachmentStream {
  /** Next chunk, or `null` when the attachment is fully consumed. */
  read(): Promise<Uint8Array | null>;
  /** Release the host-side stream; safe to call after `read()` returned `null`. */
  close(): Promise<void>;
}

/** Push-based write stream for document attachments. */
export interface MindooDBAppWritableAttachmentStream {
  /** Send one chunk; resolves once the host acknowledged it (backpressure). */
  write(chunk: Uint8Array): Promise<void>;
  /** Finalize the upload and attach the file to the document. */
  close(): Promise<void>;
  /** Cancel the upload and discard all chunks written so far. */
  abort(): Promise<void>;
}

/**
 * One sort key of a {@link MindooDBAppDocumentQuery}: a plain summary
 * field path, a computed expression (evaluated per row before comparison),
 * or the special `textScore` pseudo-key (relevance of the query's `text`
 * clause). Mirrors mindoodb's `MindooQuerySortKey`.
 */
export interface MindooDBAppQuerySortKey {
  field?: string;
  expression?: MindooDBAppExpression;
  /**
   * `"textScore"`: sort by the relevance score of the query's `text`
   * clause (only meaningful together with one). For "best match first"
   * use `direction: "descending"` — which is also the implicit default
   * ordering when a `text` clause is present and no `sortBy` was given.
   */
  special?: "textScore";
  direction?: "ascending" | "descending";
}

/**
 * Full-text clause of a {@link MindooDBAppDocumentQuery}: matches
 * documents through the database's full-text index and adds a relevance
 * score per row. Requires full-text indexing to be enabled for the
 * database (`fulltextSetup` in its `dbsetup` document) — otherwise the
 * query is rejected with a `fulltext-not-enabled` error.
 *
 * Search results are device-specific under end-to-end encryption: the
 * index is built from content the current device can decrypt.
 */
export interface MindooDBAppQueryTextClause {
  /** The search string (tokenized like indexed content). */
  query: string;
  /**
   * Restrict matching to these index fields (document field paths, plus
   * the synthetic `_attachments` field for extracted attachment text).
   * Default: all indexed fields.
   */
  fields?: string[];
  /** Match term prefixes (`"drag"` matches `"dragon"`). Default: `true`. */
  prefix?: boolean;
  /**
   * Fuzzy matching tolerance: `true`, an edit-distance fraction (0..1) of
   * the term length, or an absolute edit distance (> 1). Default: `false`.
   */
  fuzzy?: boolean | number;
  /** How multiple terms combine: `"AND"` (default) or `"OR"`. */
  combineWith?: "AND" | "OR";
}

/**
 * Full-text index configuration of a database, stored in the synced
 * `dbsetup` document (`fulltextSetup` field) — the app-SDK mirror of
 * MindooDB's `FulltextConfig`. Read/write it via
 * {@link MindooDBAppDatabase.getFulltextSetup} /
 * {@link MindooDBAppDatabase.setFulltextSetup}.
 */
export interface MindooDBAppFulltextSetup {
  /** Master switch — full-text indexing is opt-in (default `false`). */
  enabled?: boolean;
  /**
   * Dot-separated document field paths to index. Empty/omitted = auto
   * mode: every non-underscore top-level field with non-empty extracted
   * plain text.
   */
  include?: string[];
  /**
   * Extract and index attachment text through the host's registered
   * extractors (Haven ships PDF/Office/plain-text extractors), indexed
   * under the synthetic `_attachments` field. Default: `false`.
   */
  attachments?: boolean;
  /**
   * BCP-47 language tag steering tokenization (`Intl.Segmenter` locale).
   * Changing it rebuilds the index. Default: `"und"`.
   */
  language?: string;
  /** Per-field cap (approximate bytes) for extracted text. */
  maxFieldBytes?: number;
}

/**
 * Attachment text extraction configuration of a database, stored in the
 * synced `dbsetup` document (`extractionSetup` field) — the app-SDK
 * mirror of MindooDB's `ExtractionConfig`. Enables host-side extraction
 * services (e.g. Haven's OCR) that extract text from attachment content
 * once and persist it at the attachment entry, where the full-text index
 * picks it up on every replica. Read/write it via
 * {@link MindooDBAppDatabase.getExtractionSetup} /
 * {@link MindooDBAppDatabase.setExtractionSetup}.
 */
export interface MindooDBAppExtractionSetup {
  /** Master switch — extraction services stay idle without it (default `false`). */
  enabled?: boolean;
  /**
   * Tesseract-style OCR language codes (e.g. `["deu", "eng"]`). Default is
   * host-defined.
   */
  languages?: string[];
  /**
   * Restrict extraction to these MIME types (prefix match allowed, e.g.
   * `"image/"`). Default is host-defined (typically images + PDFs).
   */
  mimeTypes?: string[];
  /** Cap on persisted text per attachment in characters. */
  maxCharsPerAttachment?: number;
}

/**
 * An ad-hoc query answered from the database's document summary buffer —
 * no documents are materialized on the host, which makes this the fastest
 * way to filter and sort documents from an app.
 *
 * The `filter` accepts either a prebuilt boolean expression (from
 * `createViewLanguage()`) or formula source text (e.g.
 * `'v.and(v.eq(v.field("type"), "invoice"), v.gt(v.field("total"), 100))'`),
 * which the SDK parses locally; only JSON travels across the bridge.
 */
export interface MindooDBAppDocumentQuery {
  filter?: MindooDBAppBooleanExpression | string;
  /**
   * Full-text clause: additionally require documents to match this
   * full-text search (combined with `filter` as a logical AND). Adds a
   * relevance score per row ({@link MindooDBAppQueryRow.textScore});
   * without an explicit `sortBy`, results are ordered best score first.
   * Requires full-text indexing to be enabled for the database.
   */
  text?: MindooDBAppQueryTextClause;
  sortBy?: MindooDBAppQuerySortKey[];
  /**
   * Maximum number of rows returned. The host enforces a cap; omitting the
   * limit yields the host default page size.
   */
  limit?: number;
  offset?: number;
  /**
   * Projection: restrict the fields returned per row. Defaults to all
   * summary fields of the matching document.
   */
  fields?: string[];
}

/** One result row of a summary-backed document query. */
export interface MindooDBAppQueryRow {
  docId: string;
  fields: Record<string, unknown>;
  lastModified: number;
  /**
   * Relevance score of the query's `text` clause (higher = better match).
   * Only present when the query had a `text` clause.
   */
  textScore?: number;
}

/**
 * Which data answered the query: `"full"` when the summary buffer is
 * complete, `"rebuilding"` while a backfill is still running (results may
 * be incomplete), `"full-scan"` when documents were materialized.
 */
export type MindooDBAppQueryCoverage = "full" | "rebuilding" | "full-scan";

/** Result of a summary-backed document query. */
export interface MindooDBAppQueryResult {
  rows: MindooDBAppQueryRow[];
  /** Number of matching documents before `offset`/`limit` were applied. */
  total: number;
  coverage: MindooDBAppQueryCoverage;
}

/**
 * Handle returned by `documents.liveQuery()`. Dispose it when the UI that
 * consumes the results goes away — live subscriptions otherwise stay
 * active until the app disconnects.
 */
export interface MindooDBAppLiveQuerySubscription {
  /**
   * Force a re-evaluation now. The new result is delivered through the
   * subscription's `onResult` callback even when nothing changed.
   */
  refresh(): Promise<void>;
  /** Stop the subscription; no further `onResult` calls occur afterwards. */
  dispose(): Promise<void>;
}

/** Document operations exposed by an opened database handle. */
export interface MindooDBAppDocumentApi {
  /**
   * Run an ad-hoc query against the database's document summary buffer:
   * declarative filter, full-text `text` clause, dynamic sorting, paging,
   * and field projection — without materializing documents on the host.
   *
   * Requires the summary buffer to cover all referenced fields; queries
   * that need encrypted or uncovered fields are rejected with a
   * `query-not-supported` error. A `text` clause requires full-text
   * indexing to be enabled for the database, otherwise the query is
   * rejected with `fulltext-not-enabled`.
   */
  query(query?: MindooDBAppDocumentQuery): Promise<MindooDBAppQueryResult>;
  /**
   * Live variant of {@link query}: delivers the initial result, then keeps
   * watching the database and calls `onResult` again whenever the result
   * actually changed (membership, order, or row content). Updates are
   * coalesced on the host, so bursts of writes produce a single push.
   */
  liveQuery(
    query: MindooDBAppDocumentQuery,
    onResult: (result: MindooDBAppQueryResult) => void,
  ): Promise<MindooDBAppLiveQuerySubscription>;
  /**
   * Page through the database's changefeed. Pass the returned `nextCursor`
   * back in to resume — this is the primitive for incremental sync and
   * app-side derived indexes (use `status: "all"` there so deletions are
   * visible). For plain "find matching documents" use cases prefer
   * {@link query}. Requires the `read` capability.
   */
  list(
    query?: MindooDBAppDocumentListQuery,
  ): Promise<MindooDBAppDocumentListResult>;
  /**
   * The database's latest changefeed cursor without loading any documents.
   * Useful as a baseline checkpoint before starting an incremental
   * {@link list} loop. Requires the `read` capability.
   */
  getHeadCursor(): Promise<MindooDBAppDocumentHeadCursorResult>;
  /**
   * Load a single document by id, including its current Automerge `heads`
   * (needed as `baseHeads` for granular text/rich-text/JSON patches) and
   * attachment metadata. Resolves to `null` when the document does not
   * exist or is deleted. Requires the `read` capability.
   */
  get(docId: string): Promise<MindooDBAppDocument | null>;
  /**
   * Read the rich-text spans of an Automerge rich-text field at `path`,
   * plus the heads they were read at. Pass `options.revisionId` (from
   * {@link listHistory}) for a read-only historical snapshot. Feed the
   * result into `createMindooDBRichTextHandle` or diff against it before
   * writing back via `update({ richText: [...] })`.
   */
  getRichText(
    docId: string,
    path: Array<string | number>,
    options?: MindooDBAppRichTextGetOptions,
  ): Promise<MindooDBAppRichTextSnapshot>;
  /**
   * Export the full internal Automerge document as binary.
   *
   * **Discouraged** — prefer `getRichText`, `get`, and `documents.update` (`set`,
   * `unset`, `text`, `richText`, `json`) unless those APIs cannot express your
   * edits. Added for TeamEdit Word/.docx (local Automerge replica + binary flush).
   */
  getAutomergeSnapshot(
    docId: string,
    options?: MindooDBAppAutomergeGetOptions,
  ): Promise<MindooDBAppAutomergeSnapshot>;
  /**
   * Merge raw Automerge change bytes into the canonical document on Haven.
   *
   * **Discouraged** — prefer `documents.update` patch operations. Escape hatch
   * for apps that host a local Automerge replica when JSON patches are insufficient.
   * Include `replicaHeads` to receive incremental `changesSince` in the response.
   */
  applyAutomergeChanges(
    docId: string,
    patch: MindooDBAppAutomergeChangesPatch,
  ): Promise<MindooDBAppAutomergePatchResult>;
  /**
   * Create a new document from `input.set` (or return the existing one
   * when a caller-provided `input.id` already exists — idempotent create,
   * see {@link MindooDBAppCreateDocumentInput}). Requires the `create`
   * capability; the database's write access policy is enforced on the host
   * and violations reject with an access error. Use {@link canCreate} to
   * predict the outcome without writing.
   */
  create(input: MindooDBAppCreateDocumentInput): Promise<MindooDBAppDocument>;
  /**
   * Bulk-create documents in one host round trip.
   *
   * The host persists the whole batch in a single append-only store write and
   * runs one sync pass, which is dramatically faster than per-document
   * `create()` calls for large imports. The response is deliberately lean —
   * only the created document ids, in input order — so no per-document
   * projection work is performed. Use `get()` afterwards when full documents
   * are needed.
   *
   * On hosts that do not support the bulk RPC yet, the client transparently
   * falls back to sequential `create()` calls.
   */
  createMany(
    inputs: MindooDBAppCreateDocumentInput[],
  ): Promise<{ ids: string[] }>;
  /**
   * Apply a sparse patch to an existing document and return the updated
   * state. `set`/`unset` address top-level fields; `json`, `text`,
   * `richText`, and `richTextSteps` apply granular collaborative edits at
   * any path and are merged on the host using the patch's `baseHeads`, so
   * concurrent edits from other replicas converge instead of overwriting
   * each other. Requires the `update` capability.
   */
  update(
    docId: string,
    patch: MindooDBAppUpdateDocumentInput,
  ): Promise<MindooDBAppDocument>;
  /**
   * Mark a document as deleted by writing a lifecycle tombstone. The
   * append-only history keeps the document body, so {@link undelete} can
   * restore it and {@link listHistory} still shows past revisions. To
   * record a deletion reason, `update` a reason field first, then delete.
   * Requires the `delete` capability.
   */
  delete(docId: string): Promise<{ ok: true }>;
  /**
   * Bulk-delete documents in one host round trip.
   *
   * The host persists all delete markers in a single append-only store write
   * and runs one sync pass. Missing or already-deleted documents are skipped
   * (idempotent bulk semantics for destructive re-imports).
   *
   * On hosts that do not support the bulk RPC yet, the client transparently
   * falls back to sequential `delete()` calls.
   */
  deleteMany(docIds: string[]): Promise<{ ok: true }>;
  /**
   * Make the latest state of a deleted document live again (the inverse of
   * {@link delete}). Requires the `delete` capability.
   */
  undelete(docId: string): Promise<{ ok: true }>;
  /**
   * Predict whether `create` would be allowed, without writing anything. Useful
   * for disabling a "New" action and surfacing `decision.reason` up front.
   */
  canCreate(input?: {
    decryptionKeyId?: string;
  }): Promise<MindooDBAppAccessDecision>;
  /**
   * Predict whether `update` would be allowed for the given document, without
   * writing. The current document state is used as the candidate edit, so this
   * gates baseline (Tier 1) policy; content-dependent (Tier 2) rules are still
   * enforced on the actual `update`.
   */
  canChange(docId: string): Promise<MindooDBAppAccessDecision>;
  /** Predict whether `delete` would be allowed for the given document. */
  canDelete(docId: string): Promise<MindooDBAppAccessDecision>;
  /** Predict whether `undelete` would be allowed for the given document. */
  canUndelete(docId: string): Promise<MindooDBAppAccessDecision>;
  /**
   * The effective default document key id used when `create` is called without
   * an explicit `decryptionKeyId`. Resolves the database/tenant policy default
   * and falls back to `"default"`.
   */
  getDefaultCreateKeyId(): Promise<string>;
  /**
   * List the document's revision timeline (newest first), including author
   * identity metadata and the stable `revisionId` per entry. Requires the
   * `history` capability.
   */
  listHistory(docId: string): Promise<MindooDBAppDocumentHistoryEntry[]>;
  /**
   * Read-only snapshot of the document as it existed at an epoch-millisecond
   * timestamp. Prefer {@link getAtRevision} with a `revisionId` from
   * {@link listHistory} when you need an exact revision — timestamps can be
   * ambiguous around concurrent edits. Requires the `history` capability.
   */
  getAtTimestamp(
    docId: string,
    timestamp: number,
  ): Promise<MindooDBAppHistoricalDocument>;
  /**
   * Read-only snapshot of the document at an exact revision. `revisionId`
   * values come from {@link listHistory} and are stable, DAG-backed
   * identifiers — the preferred way to load historical states and the value
   * to pass to historical attachment APIs. Requires the `history`
   * capability.
   */
  getAtRevision(
    docId: string,
    revisionId: MindooDBAppDocumentRevisionId,
  ): Promise<MindooDBAppHistoricalDocument>;
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
  categoryValue: unknown | null;
  columnValues: Record<string, unknown>;
  childCount?: number;
  descendantDocumentCount?: number;
  descendantCount?: number;
  descendantCategoryCount?: number;
  childCategoryCount?: number;
  childDocumentCount?: number;
  siblingCount?: number;
  /** Stable continuation token for the current occurrence. */
  position: string | null;
  expanded: boolean;
  selected: boolean;
  isVisible: boolean;
}

/** Options that shape which subtree and entry kinds a navigator exposes. */
export interface MindooDBAppViewNavigatorOpenOptions {
  /** Emit category entries (default `true`). */
  includeCategories?: boolean;
  /** Emit document entries (default `true`). */
  includeDocuments?: boolean;
  /** Skip categories whose subtree contains no visible documents. */
  hideEmptyCategories?: boolean;
  /** Restrict the navigator to the subtree below this category-value path. */
  rootCategoryPath?: unknown[];
  /** Restrict the navigator to the subtree below this entry key (alternative to `rootCategoryPath`). */
  rootEntryKey?: string;
}

/** Input used when creating a dynamic view and immediately opening a navigator. */
export interface MindooDBAppCreateViewNavigatorInput {
  databaseIds: string[];
  definition: MindooDBAppViewDefinition;
  categorizationStyle?: MindooDBAppConfiguredViewCategorizationStyle;
  options?: MindooDBAppViewNavigatorOpenOptions;
  /**
   * Force the host to index from fully materialized documents instead of
   * the document summary buffer. Expensive by design — without it the host
   * picks the summary buffer whenever the view definition allows it and
   * only falls back to documents when it must (e.g. decrypt expressions or
   * fields not covered by the summary configuration).
   */
  useFullDocuments?: boolean;
}

/** @deprecated Use `MindooDBAppCreateViewNavigatorInput`. */
export type MindooDBAppCreateViewInput = MindooDBAppCreateViewNavigatorInput;

/** Range query options for key and key-range lookups within a category. */
export interface MindooDBAppViewNavigatorRangeQuery {
  /** Inclusive lower bound on the sort key; omit for an open start. */
  startKey?: unknown;
  /** Inclusive upper bound on the sort key; omit for an open end. */
  endKey?: unknown;
  /** Return matches in reverse view order. */
  descending?: boolean;
  /** Require exact key matches at the bounds instead of prefix matching for strings. */
  exact?: boolean;
}

/** Options for batched navigator reads. */
export interface MindooDBAppViewNavigatorPageOptions {
  /** Maximum entries per page. */
  limit?: number;
  /** Only return entries that are currently selected. */
  selectedOnly?: boolean;
  /**
   * Continuation token from a previous page's `nextPosition` (or an entry's
   * `position`). Omit to start at the navigator's current cursor.
   */
  startPosition?: string | null;
}

/** Paged batch of navigator entries. */
export interface MindooDBAppViewNavigatorPageResult {
  entries: MindooDBAppViewEntry[];
  /** Pass back as `startPosition` to fetch the next page; `null` at the end. */
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

/** Change statistics delivered with a `view-changed` push event. */
export interface MindooDBAppViewUpdateStats {
  addedCount: number;
  removedCount: number;
}

/**
 * Stateful view navigator that closely mirrors the core VirtualViewNavigator.
 *
 * All navigation state (current position, selection, expansion) lives on the
 * host per navigator session. `goto*()` calls are cheap but cost one bridge
 * round trip each — prefer {@link entriesForward} / {@link entriesBackward}
 * when rendering lists. Always call {@link dispose} when the consuming UI
 * goes away so the host can release the session.
 */
export interface MindooDBAppViewNavigator {
  /** The effective view definition this navigator was opened with. */
  getDefinition(): Promise<MindooDBAppViewDefinition>;
  /**
   * Opaque cursor describing the database state currently reflected in the
   * view. Pass it to `session.listDocumentsSinceViewCursor()` for
   * delta-sync use cases (legacy polling path — prefer
   * {@link onDidUpdate}).
   */
  getViewCursor(): Promise<string | null>;
  /**
   * Force an incremental catch-up of the underlying view and return the new
   * view cursor. Rarely needed when {@link onDidUpdate} is used — the host
   * keeps live views current on its own.
   */
  refresh(): Promise<string | null>;
  /**
   * Subscribe to host-pushed view updates: the host keeps the underlying
   * view bound to its databases' change feeds and fires this listener
   * after every applied change batch. Apps no longer need to poll or call
   * {@link refresh} — just re-read the visible page when the listener
   * fires. Returns an unsubscribe function.
   */
  onDidUpdate(
    listener: (stats: MindooDBAppViewUpdateStats) => void,
  ): () => void;
  /** The entry at the navigator's current cursor position, if any. */
  getCurrentEntry(): Promise<MindooDBAppViewEntry | null>;
  /**
   * Cursor movement. Each method moves the host-side cursor and resolves to
   * `true` when a matching entry exists (read it with
   * {@link getCurrentEntry}), `false` when the move was not possible.
   */
  gotoFirst(): Promise<boolean>;
  gotoLast(): Promise<boolean>;
  gotoNext(): Promise<boolean>;
  gotoPrev(): Promise<boolean>;
  gotoNextSibling(): Promise<boolean>;
  gotoPrevSibling(): Promise<boolean>;
  gotoParent(): Promise<boolean>;
  gotoFirstChild(): Promise<boolean>;
  gotoLastChild(): Promise<boolean>;
  /** Move the cursor to a `position` token taken from a previously read entry or page result. */
  gotoPos(position: string): Promise<boolean>;
  /** Read the entry at a `position` token without moving the cursor. */
  getPos(position: string): Promise<MindooDBAppViewEntry | null>;
  /**
   * Look up a category entry by its category-value path, e.g.
   * `["Sales", "2026"]` for a two-level categorization.
   */
  findCategoryEntryByParts(
    parts: unknown[],
  ): Promise<MindooDBAppViewEntry | null>;
  /**
   * Read a batch of entries starting at the cursor (or at
   * `options.startPosition`) — the preferred call for rendering lists, since
   * it replaces many `goto*()` round trips with one. Page onwards by passing
   * the result's `nextPosition` back as `startPosition`.
   */
  entriesForward(
    options?: MindooDBAppViewNavigatorPageOptions,
  ): Promise<MindooDBAppViewNavigatorPageResult>;
  /** Like {@link entriesForward}, but walking backwards. */
  entriesBackward(
    options?: MindooDBAppViewNavigatorPageOptions,
  ): Promise<MindooDBAppViewNavigatorPageResult>;
  /** Move the cursor to the next/previous selected entry. */
  gotoNextSelected(): Promise<boolean>;
  gotoPrevSelected(): Promise<boolean>;
  /**
   * Selection state lives on the host per navigator session. `origin` is the
   * source binding name of the entry (see `MindooDBAppViewEntry.origin`);
   * `selectParentCategories` also marks the ancestor categories as selected.
   */
  select(
    origin: string,
    docId: string,
    selectParentCategories?: boolean,
  ): Promise<void>;
  deselect(origin: string, docId: string): Promise<void>;
  selectAllEntries(): Promise<void>;
  deselectAllEntries(): Promise<void>;
  isSelected(origin: string, docId: string): Promise<boolean>;
  /** Snapshot the selection for persistence; restore it with {@link setSelectionState}. */
  getSelectionState(): Promise<MindooDBAppViewNavigatorSelectionState>;
  setSelectionState(
    state: MindooDBAppViewNavigatorSelectionState,
  ): Promise<void>;
  /**
   * Expansion state controls which category subtrees are visible to cursor
   * movement and paging. Like selection, it lives on the host per session.
   */
  expand(origin: string, docId: string): Promise<void>;
  collapse(origin: string, docId: string): Promise<void>;
  expandAll(): Promise<void>;
  collapseAll(): Promise<void>;
  /** Expand categories down to `level` (0 = top-level) and collapse deeper ones. */
  expandToLevel(level: number): Promise<void>;
  isExpanded(entryKey: string): Promise<boolean>;
  /** Snapshot the expansion state for persistence; restore it with {@link setExpansionState}. */
  getExpansionState(): Promise<MindooDBAppViewNavigatorExpansionState>;
  setExpansionState(
    state: MindooDBAppViewNavigatorExpansionState,
  ): Promise<void>;
  /**
   * Direct children of a category entry (`entryKey` from a previously read
   * entry): all entries, categories only, or documents only. These helpers
   * ignore expansion state and read the full child list in one round trip.
   */
  childEntries(
    entryKey: string,
    descending?: boolean,
  ): Promise<MindooDBAppViewEntry[]>;
  childCategories(
    entryKey: string,
    descending?: boolean,
  ): Promise<MindooDBAppViewEntry[]>;
  childDocuments(
    entryKey: string,
    descending?: boolean,
  ): Promise<MindooDBAppViewEntry[]>;
  /**
   * Children of a category whose sort key matches `key`. With
   * `exact: false`, prefix matching is used for string keys.
   */
  childCategoriesByKey(
    entryKey: string,
    key: unknown,
    exact?: boolean,
    descending?: boolean,
  ): Promise<MindooDBAppViewEntry[]>;
  childDocumentsByKey(
    entryKey: string,
    key: unknown,
    exact?: boolean,
    descending?: boolean,
  ): Promise<MindooDBAppViewEntry[]>;
  /** Children of a category whose sort key falls inside `range` (`startKey`..`endKey`). */
  childCategoriesBetween(
    entryKey: string,
    range: MindooDBAppViewNavigatorRangeQuery,
  ): Promise<MindooDBAppViewEntry[]>;
  childDocumentsBetween(
    entryKey: string,
    range: MindooDBAppViewNavigatorRangeQuery,
  ): Promise<MindooDBAppViewEntry[]>;
  /** All document ids in view order, across every category. */
  getSortedDocIds(descending?: boolean): Promise<MindooDBAppScopedDocId[]>;
  /** Document ids in view order below one category subtree. */
  getSortedDocIdsScoped(
    entryKey: string,
    descending?: boolean,
  ): Promise<MindooDBAppScopedDocId[]>;
  /**
   * Release the host-side navigator session (view binding, selection and
   * expansion state, update listeners). Always call this when the consuming
   * UI unmounts.
   */
  dispose(): Promise<void>;
}

/**
 * Attachment operations exposed by an opened database handle. All methods
 * require the `attachments` capability; historical reads (passing
 * `timestamp`/`revisionId` options) additionally require `history`, and
 * mutations (`openWriteStream`, `remove`, `scan`) require `update`.
 */
export interface MindooDBAppAttachmentApi {
  /**
   * Attachment metadata of a document. Pass `options.revisionId` (preferred
   * over `timestamp`) to read the attachment list of an exact historical
   * revision.
   */
  list(
    docId: string,
    options?: MindooDBAppAttachmentPreviewOptions,
  ): Promise<MindooDBAppAttachmentInfo[]>;
  /** Remove an attachment from the current document state. */
  remove(docId: string, attachmentName: string): Promise<{ ok: true }>;
  /**
   * Download via a pull-based chunk stream: call `read()` until it resolves
   * to `null`, then `close()`. Chunks travel as transferable binary over the
   * bridge port, so large files never materialize as one buffer. Accepts
   * historical `options` like {@link list}.
   */
  openReadStream(
    docId: string,
    attachmentName: string,
    options?: MindooDBAppAttachmentPreviewOptions,
  ): Promise<MindooDBAppReadableAttachmentStream>;
  /**
   * Upload via a push-based chunk stream: `write()` chunks, then `close()`
   * to finalize — or `abort()` to discard the partial upload. Always targets
   * the current document state.
   */
  openWriteStream(
    docId: string,
    attachmentName: string,
    contentType?: string,
  ): Promise<MindooDBAppWritableAttachmentStream>;
  /**
   * Open Haven's document-scanner dialog (camera capture with perspective
   * correction) and attach the scan to the document. Resolves with the new
   * attachment, or `ok: false` when the user cancelled.
   */
  scan(
    docId: string,
    options?: MindooDBAppScanAttachmentOptions,
  ): Promise<MindooDBAppScanAttachmentResult>;
  /**
   * Resolve a preview session (`previewUrl`) that the app can open itself
   * in a separate tab or window — the low-level variant of
   * {@link openPreview} for window-mode apps or custom link handling.
   */
  preparePreviewSession(
    docId: string,
    attachmentName: string,
    options?: MindooDBAppAttachmentPreviewOptions,
  ): Promise<MindooDBAppAttachmentPreviewSession>;
  /**
   * Open Haven's built-in attachment viewer (images, PDF, Markdown, text,
   * Office formats, streaming audio/video). Use `canPreviewAttachment()`
   * to gate preview buttons in the app UI. Accepts historical `options`
   * like {@link list}.
   */
  openPreview(
    docId: string,
    attachmentName: string,
    options?: MindooDBAppAttachmentPreviewOptions,
  ): Promise<{ ok: true }>;
}

/** Database handle returned from `session.openDatabase()`. */
export interface MindooDBAppDatabase {
  /** Metadata (id, title, role, granted capabilities) of this database binding. */
  info(): Promise<MindooDBAppDatabaseInfo>;
  documents: MindooDBAppDocumentApi;
  attachments: MindooDBAppAttachmentApi;
  /**
   * Read the database's full-text index configuration from the synced
   * `dbsetup` document. Resolves to `null` when full-text indexing has
   * never been configured. Requires the `read` capability.
   */
  getFulltextSetup(): Promise<MindooDBAppFulltextSetup | null>;
  /**
   * Write the database's full-text index configuration (persisted in the
   * synced `dbsetup` document, so it applies on every replica; each device
   * builds its own local index). Pass `null` to remove the configuration
   * (disables indexing). Typically called once during app setup, e.g.
   * `setFulltextSetup({ enabled: true, attachments: true })`.
   *
   * Requires the `update` capability; the change is idempotent, so calling
   * it on every app start with the same config is fine (no-op write when
   * nothing changed).
   */
  setFulltextSetup(config: MindooDBAppFulltextSetup | null): Promise<void>;
  /**
   * Read the database's attachment extraction configuration from the
   * synced `dbsetup` document. Resolves to `null` when extraction has
   * never been configured. Requires the `read` capability.
   */
  getExtractionSetup(): Promise<MindooDBAppExtractionSetup | null>;
  /**
   * Write the database's attachment extraction configuration (persisted
   * in the synced `dbsetup` document). Enables host-side extraction
   * services (e.g. Haven's OCR): extracted text is persisted at the
   * attachment entry and syncs with the document, so every replica can
   * search it without re-extracting. Pass `null` to remove the
   * configuration.
   *
   * Requires the `update` capability; idempotent like
   * {@link setFulltextSetup}.
   */
  setExtractionSetup(config: MindooDBAppExtractionSetup | null): Promise<void>;
}

/** Connected session between the running app and the Haven host. */
export interface MindooDBAppSession {
  /**
   * The full launch context supplied by Haven: runtime, theme, viewport,
   * locale, user, tenant, launch parameters, plus the databases and views
   * mapped to this app. Cached — repeated calls do not hit the host again.
   */
  getLaunchContext(): Promise<MindooDBAppLaunchContext>;
  /**
   * Product license identifiers active for the current Haven user, for apps
   * that gate features on licensing.
   */
  getLicensedProducts(): Promise<string[]>;
  /**
   * The databases visible to this app together with their granted
   * capabilities. Same data as `launchContext.databases`, re-fetched from
   * the host.
   */
  listDatabases(): Promise<MindooDBAppDatabaseInfo[]>;
  /**
   * Open one of the granted databases by its binding id (from
   * {@link listDatabases} / the launch context) and get the `documents` and
   * `attachments` APIs for it.
   */
  openDatabase(databaseId: string): Promise<MindooDBAppDatabase>;
  /**
   * Legacy polling/delta-sync path: list documents that changed across all
   * granted databases since a view cursor previously obtained from
   * `navigator.getViewCursor()` / `refresh()`. Prefer the push-based
   * `navigator.onDidUpdate()` and `documents.liveQuery()` for keeping UI
   * current; this remains useful for app-side derived state that needs an
   * explicit multi-database checkpoint.
   */
  listDocumentsSinceViewCursor(
    cursor: string | null,
  ): Promise<MindooDBAppViewCursorDocumentListResult>;
  /**
   * Create an app-defined (multi-database) view from a
   * `MindooDBAppViewDefinition` and immediately open a navigator on it.
   * The host builds the view summary-first (see
   * {@link MindooDBAppCreateViewNavigatorInput.useFullDocuments}) and keeps
   * it live-bound to the source databases. Requires the `views` capability
   * on every referenced database. Dispose the navigator when done.
   */
  createViewNavigator(
    input: MindooDBAppCreateViewNavigatorInput,
  ): Promise<MindooDBAppViewNavigator>;
  /**
   * Open a navigator on a Haven-configured view mapping (from
   * `launchContext.views`, referenced by its `id`). Requires the `read`
   * capability on the view's source databases. Dispose the navigator when
   * done.
   */
  openViewNavigator(
    viewId: string,
    options?: MindooDBAppViewNavigatorOpenOptions,
  ): Promise<MindooDBAppViewNavigator>;
  menus: MindooDBAppMenuApi;
  /**
   * Subscribe to host-pushed theme changes (light/dark mode and preset).
   * The initial theme is in `launchContext.theme`. Returns an unsubscribe
   * function.
   */
  onThemeChange(listener: (theme: MindooDBAppHostTheme) => void): () => void;
  /**
   * Subscribe to host-pushed iframe viewport size changes. Only fires for
   * `runtime === "iframe"` (window-mode apps observe their own window).
   * Returns an unsubscribe function.
   */
  onViewportChange(
    listener: (viewport: MindooDBAppViewport) => void,
  ): () => void;
  /**
   * Subscribe to host-pushed UI preference changes (e.g. iOS multitasking
   * optimizations). The initial value is in `launchContext.uiPreferences`.
   * Returns an unsubscribe function.
   */
  onUiPreferencesChange(
    listener: (uiPreferences: MindooDBAppUiPreferences) => void,
  ): () => void;
  /**
   * Subscribe to host-pushed UI language changes. The listener receives the
   * new BCP-47 language tag (e.g. `"de"`). Returns an unsubscribe function.
   */
  onLocaleChange(listener: (locale: string) => void): () => void;
  /**
   * Tear down the session: close the bridge port and release all host-side
   * resources of this launch (navigators, live queries, streams). The
   * session object is unusable afterwards.
   */
  disconnect(): Promise<void>;
}

/** Root SDK bridge object used to establish a session. */
export interface MindooDBAppBridge {
  /**
   * Perform the `postMessage` handshake with the Haven host and resolve
   * with a connected session. Reads the `mindoodbAppLaunchId` query
   * parameter injected by Haven when `options.launchId` is omitted; rejects
   * when no host answers within `connectTimeoutMs`.
   */
  connect(
    options?: MindooDBAppBridgeConnectOptions,
  ): Promise<MindooDBAppSession>;
}
