/**
 * Client-side implementation of the MindooDB App Bridge.
 *
 * This module is the SDK's main entry point: apps call
 * `createMindooDBAppBridge().connect()` to establish a connection with the
 * Haven host, and then interact with databases, documents, views, and
 * attachments through the returned `MindooDBAppSession`.
 *
 * ## Connection lifecycle
 *
 * 1. `createMindooDBAppBridge()` returns a lightweight factory (no side
 *    effects).
 * 2. `bridge.connect(options?)` resolves the `launchId` (from options or the
 *    URL query string), locates the Haven host window (`window.parent` for
 *    iframes, `window.opener` for pop-outs), creates a `MessageChannel`,
 *    posts a `mindoodb-app:connect` handshake, and waits for the host to
 *    reply with `mindoodb-app:connected` on the dedicated port.
 * 3. All subsequent communication flows through the `MessagePort` via a
 *    `PortRpcClient`.  RPC requests are serialised JSON; binary attachment
 *    traffic uses a separate stream protocol with explicit ack/error flow
 *    control.
 *
 * ## Key classes
 *
 * - {@link MindooDBAppSessionImpl} -- top-level session facade exposing
 *   database opening, navigator creation, and host-event subscriptions.
 * - {@link MindooDBAppDatabaseImpl} -- per-database facade wiring
 *   `documents.*` and `attachments.*` RPC methods.
 * - {@link MindooDBAppViewNavigatorImpl} -- stateful view navigator proxy
 *   mapping every `MindooDBAppViewNavigator` method to a
 *   `viewNavigators.*` RPC call, including traversal, expansion, selection,
 *   and child/key/range lookups.
 * - {@link MindooDBAppReadableAttachmentStreamImpl} /
 *   {@link MindooDBAppWritableAttachmentStreamImpl} -- pull-based and
 *   push-based attachment stream adapters built on the port's stream
 *   protocol.
 *
 * @module createMindooDBAppBridge
 */
import { PortRpcClient } from "./portRpcClient";
import type {
  MindooDBAppAttachmentApi,
  MindooDBAppAttachmentChunk,
  MindooDBAppBridge,
  MindooDBAppBridgeConnectMessage,
  MindooDBAppBridgeConnectOptions,
  MindooDBAppBridgeConnectedMessage,
  MindooDBAppBridgePortMessage,
  MindooDBAppBridgeThemeChangedMessage,
  MindooDBAppBridgeUiPreferencesChangedMessage,
  MindooDBAppBridgeViewportChangedMessage,
  MindooDBAppBridgeStreamAck,
  MindooDBAppBridgeStreamError,
  MindooDBAppBridgeStreamOpenResult,
  MindooDBAppCreateViewNavigatorInput,
  MindooDBAppDatabase,
  MindooDBAppDatabaseInfo,
  MindooDBAppDocumentApi,
  MindooDBAppLaunchContext,
  MindooDBAppMenuApi,
  MindooDBAppReadableAttachmentStream,
  MindooDBAppSession,
  MindooDBAppShowMenuInput,
  MindooDBAppShowMenuResult,
  MindooDBAppScopedDocId,
  MindooDBAppViewCursorDocumentListResult,
  MindooDBAppViewDefinition,
  MindooDBAppViewEntry,
  MindooDBAppViewNavigator,
  MindooDBAppViewNavigatorExpansionState,
  MindooDBAppViewNavigatorOpenOptions,
  MindooDBAppViewNavigatorPageOptions,
  MindooDBAppViewNavigatorPageResult,
  MindooDBAppViewNavigatorRangeQuery,
  MindooDBAppViewNavigatorSelectionState,
  MindooDBAppWritableAttachmentStream,
} from "../types";

/** Wire protocol identifier shared with the Haven host. */
const PROTOCOL = "mindoodb-app-bridge";

/** Default maximum wait (ms) for the host to acknowledge the handshake. */
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;

/** Copies a `Uint8Array` into a transferable `ArrayBuffer` for stream writes. */
function toTransferableArrayBuffer(chunk: Uint8Array) {
  return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
}

/** Narrows a port message to a chunk event for one specific stream id. */
function isStreamChunkFor(streamId: string, message: MindooDBAppBridgePortMessage): message is MindooDBAppAttachmentChunk {
  return message.kind === "stream-chunk" && message.streamId === streamId;
}

/** Narrows a port message to an acknowledgement for one specific stream id. */
function isStreamAckFor(streamId: string, message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeStreamAck {
  return message.kind === "stream-ack" && message.streamId === streamId;
}

/** Narrows a port message to an error event for one specific stream id. */
function isStreamErrorFor(streamId: string, message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeStreamError {
  return message.kind === "stream-error" && message.streamId === streamId;
}

/** Narrows a port message to a host theme change event. */
function isThemeChangedMessage(message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeThemeChangedMessage {
  return message.kind === "theme-changed";
}

/** Narrows a port message to a host viewport change event. */
function isViewportChangedMessage(message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeViewportChangedMessage {
  return message.kind === "viewport-changed";
}

/** Narrows a port message to a host UI preferences change event. */
function isUiPreferencesChangedMessage(message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeUiPreferencesChangedMessage {
  return message.kind === "ui-preferences-changed";
}

/** Converts a stream error payload into a normal `Error`. */
function toStreamError(message: MindooDBAppBridgeStreamError) {
  const error = new Error(message.error.message);
  error.name = message.error.code || "MindooDBAppBridgeStreamError";
  return error;
}

/** Resolves the launch id either from explicit options or the current browser URL. */
function resolveLaunchId(options: MindooDBAppBridgeConnectOptions | undefined) {
  if (options?.launchId) {
    return options.launchId;
  }
  if (typeof window === "undefined") {
    throw new Error("A launchId must be provided when connecting outside the browser.");
  }
  const search = new URLSearchParams(window.location.search);
  const launchId = search.get("mindoodbAppLaunchId");
  if (!launchId) {
    throw new Error("Missing mindoodbAppLaunchId in the current URL.");
  }
  return launchId;
}

/** Finds the Administrator window hosting the current app runtime. */
function resolveTargetWindow() {
  if (typeof window === "undefined") {
    throw new Error("The MindooDB app bridge is only available in the browser.");
  }
  if (window.parent && window.parent !== window) {
    return window.parent;
  }
  if (window.opener) {
    return window.opener;
  }
  throw new Error("Could not find a MindooDB Administrator host window.");
}

/**
 * Perform the initial `postMessage` handshake with the Haven host.
 *
 * Creates a `MessageChannel`, sends port2 to the host via the connect
 * message, and listens on port1 for the `mindoodb-app:connected` reply.
 * Rejects if the host does not respond within `connectTimeoutMs`.
 */
function waitForConnectedPort(options: MindooDBAppBridgeConnectOptions | undefined, launchId: string) {
  const targetWindow = resolveTargetWindow();
  const targetOrigin = options?.targetOrigin ?? "*";
  const channel = new MessageChannel();
  const timeoutMs = options?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

  return new Promise<MessagePort>((resolve, reject) => {
    let timeoutId: number | null = null;

    const cleanup = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      channel.port1.removeEventListener("message", handleMessage as EventListener);
    };

    const handleMessage = (event: MessageEvent<unknown>) => {
      const payload = event.data as MindooDBAppBridgeConnectedMessage | undefined;
      if (!payload || payload.protocol !== PROTOCOL || payload.type !== "mindoodb-app:connected") {
        return;
      }
      cleanup();
      resolve(channel.port1);
    };

    timeoutId = window.setTimeout(() => {
      cleanup();
      channel.port1.close();
      reject(new Error(`Timed out while connecting to the MindooDB Administrator bridge for launch ${launchId}.`));
    }, timeoutMs);

    channel.port1.addEventListener("message", handleMessage as EventListener);
    channel.port1.start();

    const message: MindooDBAppBridgeConnectMessage = {
      protocol: PROTOCOL,
      type: "mindoodb-app:connect",
      launchId,
    };
    targetWindow.postMessage(message, targetOrigin, [channel.port2]);
  });
}

/**
 * Client-side proxy for a single host-side `VirtualViewNavigator`.
 *
 * Every public method maps 1:1 to a `viewNavigators.*` RPC call, passing
 * the `navigatorId` allocated by the host during `createViewNavigator` or
 * `openViewNavigator`.  The host retains the navigator's cursor, expansion,
 * and selection state between calls, so this class is intentionally
 * stateless -- all state lives server-side.
 *
 * Methods are grouped into:
 * - **Traversal** (`gotoFirst`, `gotoNext`, `gotoParent`, ...): move the
 *   host cursor and return whether the move succeeded.
 * - **Position lookup** (`getPos`, `findCategoryEntryByParts`): locate an
 *   entry without moving the cursor.
 * - **Batch reads** (`entriesForward`, `entriesBackward`): collect a page
 *   of serialised entries from a cloned navigator on the host, leaving the
 *   primary cursor untouched.
 * - **Selection / Expansion**: toggle or query per-entry UI state.
 * - **Child / Key / Range lookups**: list direct children, optionally
 *   filtered by key or key range.
 * - **Lifecycle** (`refresh`, `dispose`): rebuild or release the host-side
 *   navigator session.
 */
class MindooDBAppViewNavigatorImpl implements MindooDBAppViewNavigator {
  constructor(
    private readonly rpc: PortRpcClient,
    private readonly navigatorId: string,
    private viewCursor: string | null,
  ) {}

  /** Shorthand: call an RPC method with the navigator ID automatically injected. */
  private async call<TResult>(method: string, params: Record<string, unknown> = {}) {
    return await this.rpc.call<TResult>(method, {
      navigatorId: this.navigatorId,
      ...params,
    });
  }

  async getDefinition(): Promise<MindooDBAppViewDefinition> {
    return await this.call("viewNavigators.getDefinition");
  }

  async getViewCursor(): Promise<string | null> {
    return this.viewCursor;
  }

  async refresh(): Promise<string | null> {
    const result = await this.call<{ viewCursor: string | null }>("viewNavigators.refresh");
    this.viewCursor = result.viewCursor;
    return this.viewCursor;
  }

  async getCurrentEntry(): Promise<MindooDBAppViewEntry | null> {
    return await this.call("viewNavigators.current.get");
  }

  async gotoFirst(): Promise<boolean> {
    return await this.call("viewNavigators.goto.first");
  }

  async gotoLast(): Promise<boolean> {
    return await this.call("viewNavigators.goto.last");
  }

  async gotoNext(): Promise<boolean> {
    return await this.call("viewNavigators.goto.next");
  }

  async gotoPrev(): Promise<boolean> {
    return await this.call("viewNavigators.goto.prev");
  }

  async gotoNextSibling(): Promise<boolean> {
    return await this.call("viewNavigators.goto.nextSibling");
  }

  async gotoPrevSibling(): Promise<boolean> {
    return await this.call("viewNavigators.goto.prevSibling");
  }

  async gotoParent(): Promise<boolean> {
    return await this.call("viewNavigators.goto.parent");
  }

  async gotoFirstChild(): Promise<boolean> {
    return await this.call("viewNavigators.goto.firstChild");
  }

  async gotoLastChild(): Promise<boolean> {
    return await this.call("viewNavigators.goto.lastChild");
  }

  async gotoPos(position: string): Promise<boolean> {
    return await this.call("viewNavigators.goto.pos", { position });
  }

  async getPos(position: string): Promise<MindooDBAppViewEntry | null> {
    return await this.call("viewNavigators.pos.get", { position });
  }

  async findCategoryEntryByParts(parts: unknown[]): Promise<MindooDBAppViewEntry | null> {
    return await this.call("viewNavigators.category.findByParts", { parts });
  }

  async entriesForward(options?: MindooDBAppViewNavigatorPageOptions): Promise<MindooDBAppViewNavigatorPageResult> {
    return await this.call("viewNavigators.entries.forward", { options: options ?? {} });
  }

  async entriesBackward(options?: MindooDBAppViewNavigatorPageOptions): Promise<MindooDBAppViewNavigatorPageResult> {
    return await this.call("viewNavigators.entries.backward", { options: options ?? {} });
  }

  async gotoNextSelected(): Promise<boolean> {
    return await this.call("viewNavigators.goto.nextSelected");
  }

  async gotoPrevSelected(): Promise<boolean> {
    return await this.call("viewNavigators.goto.prevSelected");
  }

  async select(origin: string, docId: string, selectParentCategories?: boolean): Promise<void> {
    await this.call("viewNavigators.selection.select", {
      origin,
      docId,
      selectParentCategories,
    });
  }

  async deselect(origin: string, docId: string): Promise<void> {
    await this.call("viewNavigators.selection.deselect", { origin, docId });
  }

  async selectAllEntries(): Promise<void> {
    await this.call("viewNavigators.selection.selectAll");
  }

  async deselectAllEntries(): Promise<void> {
    await this.call("viewNavigators.selection.deselectAll");
  }

  async isSelected(origin: string, docId: string): Promise<boolean> {
    return await this.call("viewNavigators.selection.isSelected", { origin, docId });
  }

  async getSelectionState(): Promise<MindooDBAppViewNavigatorSelectionState> {
    return await this.call("viewNavigators.selection.get");
  }

  async setSelectionState(state: MindooDBAppViewNavigatorSelectionState): Promise<void> {
    await this.call("viewNavigators.selection.set", { state });
  }

  async expand(origin: string, docId: string): Promise<void> {
    await this.call("viewNavigators.expansion.expand", { origin, docId });
  }

  async collapse(origin: string, docId: string): Promise<void> {
    await this.call("viewNavigators.expansion.collapse", { origin, docId });
  }

  async expandAll(): Promise<void> {
    await this.call("viewNavigators.expansion.expandAll");
  }

  async collapseAll(): Promise<void> {
    await this.call("viewNavigators.expansion.collapseAll");
  }

  async expandToLevel(level: number): Promise<void> {
    await this.call("viewNavigators.expansion.expandToLevel", { level });
  }

  async isExpanded(entryKey: string): Promise<boolean> {
    return await this.call("viewNavigators.expansion.isExpanded", { entryKey });
  }

  async getExpansionState(): Promise<MindooDBAppViewNavigatorExpansionState> {
    return await this.call("viewNavigators.expansion.get");
  }

  async setExpansionState(state: MindooDBAppViewNavigatorExpansionState): Promise<void> {
    await this.call("viewNavigators.expansion.set", { state });
  }

  async childEntries(entryKey: string, descending?: boolean): Promise<MindooDBAppViewEntry[]> {
    return await this.call("viewNavigators.children.entries", { entryKey, descending });
  }

  async childCategories(entryKey: string, descending?: boolean): Promise<MindooDBAppViewEntry[]> {
    return await this.call("viewNavigators.children.categories", { entryKey, descending });
  }

  async childDocuments(entryKey: string, descending?: boolean): Promise<MindooDBAppViewEntry[]> {
    return await this.call("viewNavigators.children.documents", { entryKey, descending });
  }

  async childCategoriesByKey(entryKey: string, key: unknown, exact?: boolean, descending?: boolean): Promise<MindooDBAppViewEntry[]> {
    return await this.call("viewNavigators.children.categoriesByKey", {
      entryKey,
      key,
      exact,
      descending,
    });
  }

  async childDocumentsByKey(entryKey: string, key: unknown, exact?: boolean, descending?: boolean): Promise<MindooDBAppViewEntry[]> {
    return await this.call("viewNavigators.children.documentsByKey", {
      entryKey,
      key,
      exact,
      descending,
    });
  }

  async childCategoriesBetween(entryKey: string, range: MindooDBAppViewNavigatorRangeQuery): Promise<MindooDBAppViewEntry[]> {
    return await this.call("viewNavigators.children.categoriesBetween", { entryKey, range });
  }

  async childDocumentsBetween(entryKey: string, range: MindooDBAppViewNavigatorRangeQuery): Promise<MindooDBAppViewEntry[]> {
    return await this.call("viewNavigators.children.documentsBetween", { entryKey, range });
  }

  async getSortedDocIds(descending?: boolean): Promise<MindooDBAppScopedDocId[]> {
    return await this.call<MindooDBAppScopedDocId[]>("viewNavigators.sortedDocIds.get", { descending });
  }

  async getSortedDocIdsScoped(entryKey: string, descending?: boolean): Promise<MindooDBAppScopedDocId[]> {
    return await this.call<MindooDBAppScopedDocId[]>("viewNavigators.sortedDocIds.scoped", { entryKey, descending });
  }

  async dispose(): Promise<void> {
    await this.call("viewNavigators.dispose");
  }
}

/**
 * Pull-based attachment download stream.
 *
 * Each `read()` call sends a `stream-read` message to the host and parks on
 * a promise until the host replies with a `stream-chunk` (carrying an
 * `ArrayBuffer`) or a terminal `stream-chunk` with `done: true`.
 *
 * Only one `read()` may be in-flight at a time; calling `read()` while a
 * previous read is pending throws immediately.  `close()` can be called at
 * any time and is idempotent.
 */
class MindooDBAppReadableAttachmentStreamImpl implements MindooDBAppReadableAttachmentStream {
  private readonly unsubscribe: () => void;
  private closed = false;
  private pendingRead: {
    resolve: (value: Uint8Array | null) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(private readonly rpc: PortRpcClient, private readonly streamId: string) {
    this.unsubscribe = this.rpc.addMessageListener((message) => {
      if (isStreamChunkFor(this.streamId, message)) {
        const pending = this.pendingRead;
        this.pendingRead = null;
        if (!pending) {
          return;
        }
        pending.resolve(message.done ? null : new Uint8Array(message.chunk ?? new ArrayBuffer(0)));
        if (message.done) {
          this.closed = true;
          this.unsubscribe();
        }
        return;
      }

      if (isStreamErrorFor(this.streamId, message)) {
        const pending = this.pendingRead;
        this.pendingRead = null;
        pending?.reject(toStreamError(message));
        this.closed = true;
        this.unsubscribe();
      }
    });
  }

  /** Requests and returns the next attachment chunk, or `null` when the stream ends. */
  async read(): Promise<Uint8Array | null> {
    if (this.closed) {
      return null;
    }
    if (this.pendingRead) {
      throw new Error("A read() call is already in progress for this attachment stream.");
    }

    return await new Promise<Uint8Array | null>((resolve, reject) => {
      this.pendingRead = { resolve, reject };
      this.rpc.postMessage({
        protocol: PROTOCOL,
        kind: "stream-read",
        streamId: this.streamId,
      });
    });
  }

  /** Closes the read stream and releases any pending read waiter. */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.pendingRead?.resolve(null);
    this.pendingRead = null;
    this.rpc.postMessage({
      protocol: PROTOCOL,
      kind: "stream-close",
      streamId: this.streamId,
    });
    this.unsubscribe();
  }
}

/**
 * Push-based attachment upload stream with back-pressure.
 *
 * Each `write(chunk)` transfers a binary `ArrayBuffer` to the host and
 * waits for a `stream-ack` before the next write can proceed.  Writes are
 * serialised through an internal promise queue so callers can fire-and-forget
 * multiple `write()` calls and the class will sequence them correctly.
 *
 * `close()` gracefully finalises the upload (waits for the host ack);
 * `abort()` tells the host to discard the partial upload.  Both are
 * idempotent and enqueued behind any in-flight write.
 */
class MindooDBAppWritableAttachmentStreamImpl implements MindooDBAppWritableAttachmentStream {
  private readonly unsubscribe: () => void;
  private closed = false;
  private inflight: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  private queue = Promise.resolve();

  constructor(private readonly rpc: PortRpcClient, private readonly streamId: string) {
    this.unsubscribe = this.rpc.addMessageListener((message) => {
      if (isStreamAckFor(this.streamId, message)) {
        const inflight = this.inflight;
        this.inflight = null;
        inflight?.resolve();
        return;
      }

      if (isStreamErrorFor(this.streamId, message)) {
        const inflight = this.inflight;
        this.inflight = null;
        inflight?.reject(toStreamError(message));
        this.closed = true;
        this.unsubscribe();
      }
    });
  }

  /** Ensures write/close/abort operations run strictly in order. */
  private enqueue(operation: () => Promise<void>) {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Sends one stream operation and waits for its ack/error response. */
  private async waitForAck(send: () => void) {
    return await new Promise<void>((resolve, reject) => {
      this.inflight = { resolve, reject };
      send();
    });
  }

  /** Writes one binary chunk to the host-managed attachment stream. */
  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new Error("The attachment write stream is already closed.");
    }
    return await this.enqueue(async () => {
      const buffer = toTransferableArrayBuffer(chunk);
      await this.waitForAck(() => {
        this.rpc.postMessage({
          protocol: PROTOCOL,
          kind: "stream-write",
          streamId: this.streamId,
          chunk: buffer,
        }, [buffer]);
      });
    });
  }

  /** Gracefully closes the write stream after any queued writes complete. */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.enqueue(async () => {
      await this.waitForAck(() => {
        this.rpc.postMessage({
          protocol: PROTOCOL,
          kind: "stream-close",
          streamId: this.streamId,
        });
      });
    });
    this.unsubscribe();
  }

  /** Aborts the write stream after any in-flight work has settled. */
  async abort(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.enqueue(async () => {
      await this.waitForAck(() => {
        this.rpc.postMessage({
          protocol: PROTOCOL,
          kind: "stream-abort",
          streamId: this.streamId,
        });
      });
    });
    this.unsubscribe();
  }
}

/**
 * Per-database facade that wires the public `MindooDBAppDatabase` interface
 * to bridge RPC calls.
 *
 * Created by `MindooDBAppSessionImpl.openDatabase()`.  The `databaseId` is
 * injected into every outgoing RPC request so the host can route the call
 * to the correct database binding.
 *
 * Sub-APIs:
 * - `documents` -- list, get, create, update, delete, history.
 * - `attachments` -- list, remove, read/write streams, preview.
 */
class MindooDBAppDatabaseImpl implements MindooDBAppDatabase {
  public readonly documents: MindooDBAppDocumentApi;
  public readonly attachments: MindooDBAppAttachmentApi;

  constructor(private readonly rpc: PortRpcClient, private readonly databaseId: string) {
    this.documents = {
      list: async (query) => await this.rpc.call("documents.list", {
        databaseId: this.databaseId,
        query: query ?? {},
      }),
      getHeadCursor: async () => await this.rpc.call("documents.getHeadCursor", {
        databaseId: this.databaseId,
      }),
      get: async (docId) => await this.rpc.call("documents.get", {
        databaseId: this.databaseId,
        docId,
      }),
      create: async (input) => await this.rpc.call("documents.create", {
        databaseId: this.databaseId,
        input,
      }),
      update: async (docId, patch) => await this.rpc.call("documents.update", {
        databaseId: this.databaseId,
        docId,
        patch,
      }),
      delete: async (docId) => await this.rpc.call("documents.delete", {
        databaseId: this.databaseId,
        docId,
      }),
      listHistory: async (docId) => await this.rpc.call("documents.history.list", {
        databaseId: this.databaseId,
        docId,
      }),
      getAtTimestamp: async (docId, timestamp) => await this.rpc.call("documents.history.getAtTimestamp", {
        databaseId: this.databaseId,
        docId,
        timestamp,
      }),
    };

    this.attachments = {
      list: async (docId) => await this.rpc.call("attachments.list", {
        databaseId: this.databaseId,
        docId,
      }),
      remove: async (docId, attachmentName) => await this.rpc.call("attachments.remove", {
        databaseId: this.databaseId,
        docId,
        attachmentName,
      }),
      openReadStream: async (docId, attachmentName) => {
        const result = await this.rpc.call<MindooDBAppBridgeStreamOpenResult>("attachments.openReadStream", {
          databaseId: this.databaseId,
          docId,
          attachmentName,
        });
        return new MindooDBAppReadableAttachmentStreamImpl(this.rpc, result.streamId);
      },
      openWriteStream: async (docId, attachmentName, contentType) => {
        const result = await this.rpc.call<MindooDBAppBridgeStreamOpenResult>("attachments.openWriteStream", {
          databaseId: this.databaseId,
          docId,
          attachmentName,
          contentType,
        });
        return new MindooDBAppWritableAttachmentStreamImpl(this.rpc, result.streamId);
      },
      preparePreviewSession: async (docId, attachmentName, options) => await this.rpc.call("attachments.preparePreviewSession", {
        databaseId: this.databaseId,
        docId,
        attachmentName,
        timestamp: options?.timestamp,
      }),
      openPreview: async (docId, attachmentName, options) => await this.rpc.call("attachments.openPreview", {
        databaseId: this.databaseId,
        docId,
        attachmentName,
        timestamp: options?.timestamp,
      }),
    };
  }

  /** Returns database metadata for the currently opened binding. */
  async info(): Promise<MindooDBAppDatabaseInfo> {
    return await this.rpc.call("databases.info", {
      databaseId: this.databaseId,
    });
  }
}

/**
 * Top-level session facade returned by `bridge.connect()`.
 *
 * Wraps the `PortRpcClient` and provides:
 * - `getLaunchContext()` / `listDatabases()` -- read-only session metadata.
 * - `openDatabase(id)` -- creates a `MindooDBAppDatabaseImpl` for CRUD
 *   and attachment operations.
 * - `createViewNavigator(input)` / `openViewNavigator(viewId)` -- allocate
 *   a host-side navigator and return a `MindooDBAppViewNavigatorImpl`.
 * - `onThemeChange` / `onViewportChange` / `onUiPreferencesChange` --
 *   subscribe to push events from
 *   the host.
 * - `disconnect()` -- sends a disconnect RPC, then unconditionally disposes
 *   the port client.
 */
class MindooDBAppSessionImpl implements MindooDBAppSession {
  public readonly menus: MindooDBAppMenuApi;

  constructor(private readonly rpc: PortRpcClient) {
    this.menus = {
      show: async (input: MindooDBAppShowMenuInput) =>
        await this.rpc.call<MindooDBAppShowMenuResult>("menus.show", input),
      hide: async () => {
        await this.rpc.call("menus.hide", {});
      },
    };
  }

  /** Returns the launch context provided by the Administrator host. */
  async getLaunchContext(): Promise<MindooDBAppLaunchContext> {
    return await this.rpc.call("session.getLaunchContext", {});
  }

  /** Lists the databases that the host has made available for this app session. */
  async listDatabases(): Promise<MindooDBAppDatabaseInfo[]> {
    return await this.rpc.call("session.listDatabases", {});
  }

  /** Opens one database binding and returns a client facade for it. */
  async openDatabase(databaseId: string): Promise<MindooDBAppDatabase> {
    await this.rpc.call("session.openDatabase", { databaseId });
    return new MindooDBAppDatabaseImpl(this.rpc, databaseId);
  }

  async listDocumentsSinceViewCursor(cursor: string | null): Promise<MindooDBAppViewCursorDocumentListResult> {
    return await this.rpc.call("session.listDocumentsSinceViewCursor", { cursor });
  }

  /**
   * Create a navigator from an ad-hoc view definition and one or more database bindings.
   *
   * The host builds a `VirtualView` from `input.definition`, optionally applying
   * open options (root scoping, category filtering), and returns a `navigatorId`
   * that all subsequent navigator RPCs reference.
   */
  async createViewNavigator(input: MindooDBAppCreateViewNavigatorInput): Promise<MindooDBAppViewNavigator> {
    const result = await this.rpc.call<{ navigatorId: string; viewCursor: string | null }>("session.createViewNavigator", input);
    return new MindooDBAppViewNavigatorImpl(this.rpc, result.navigatorId, result.viewCursor);
  }

  /**
   * Open a navigator for a preconfigured view that the host already knows about.
   *
   * `viewId` must match one of the views declared in the launch context. The
   * host resolves the full view definition and database bindings automatically.
   */
  async openViewNavigator(viewId: string, options?: MindooDBAppViewNavigatorOpenOptions): Promise<MindooDBAppViewNavigator> {
    const result = await this.rpc.call<{ navigatorId: string; viewCursor: string | null }>("session.openViewNavigator", { viewId, options: options ?? {} });
    return new MindooDBAppViewNavigatorImpl(this.rpc, result.navigatorId, result.viewCursor);
  }

  /** Subscribe to host-pushed theme changes (dark/light mode, color tokens). */
  onThemeChange(listener: (theme: MindooDBAppLaunchContext["theme"]) => void) {
    return this.rpc.addMessageListener((message) => {
      if (isThemeChangedMessage(message)) {
        listener(message.theme);
      }
    });
  }

  /** Subscribe to host-pushed viewport dimension changes (resize, orientation). */
  onViewportChange(listener: (viewport: NonNullable<MindooDBAppLaunchContext["viewport"]>) => void) {
    return this.rpc.addMessageListener((message) => {
      if (isViewportChangedMessage(message)) {
        listener(message.viewport);
      }
    });
  }

  /** Subscribe to host-pushed embedded UI preference changes. */
  onUiPreferencesChange(listener: (uiPreferences: MindooDBAppLaunchContext["uiPreferences"]) => void) {
    return this.rpc.addMessageListener((message) => {
      if (isUiPreferencesChangedMessage(message)) {
        listener(message.uiPreferences);
      }
    });
  }

  /** Disconnects from the host and always disposes the underlying port client. */
  async disconnect(): Promise<void> {
    try {
      await this.rpc.call("session.disconnect", {});
    } finally {
      this.rpc.dispose();
    }
  }
}

/**
 * Creates the browser-side bridge entry point used by MindooDB apps.
 *
 * The returned object performs the initial postMessage handshake with the
 * Administrator host and exposes a session with document, view, and attachment
 * APIs over a dedicated `MessagePort`.
 */
export function createMindooDBAppBridge(): MindooDBAppBridge {
  return {
    async connect(options?: MindooDBAppBridgeConnectOptions): Promise<MindooDBAppSession> {
      const launchId = resolveLaunchId(options);
      const port = await waitForConnectedPort(options, launchId);
      const rpc = new PortRpcClient(port);
      return new MindooDBAppSessionImpl(rpc);
    },
  };
}
