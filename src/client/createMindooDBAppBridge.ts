import { PortRpcClient } from "./portRpcClient";
import type {
  MindooDBAppAttachmentApi,
  MindooDBAppAttachmentChunk,
  MindooDBAppBridge,
  MindooDBAppBridgeConnectMessage,
  MindooDBAppBridgeConnectOptions,
  MindooDBAppBridgeConnectedMessage,
  MindooDBAppBridgePortMessage,
  MindooDBAppBridgeStreamAck,
  MindooDBAppBridgeStreamError,
  MindooDBAppBridgeStreamOpenResult,
  MindooDBAppDatabase,
  MindooDBAppDatabaseInfo,
  MindooDBAppDocumentApi,
  MindooDBAppLaunchContext,
  MindooDBAppReadableAttachmentStream,
  MindooDBAppSession,
  MindooDBAppViewApi,
  MindooDBAppViewCategoryChildrenPageRequest,
  MindooDBAppViewDefinition,
  MindooDBAppViewExpansionState,
  MindooDBAppViewHandle,
  MindooDBAppViewLookupByPath,
  MindooDBAppViewPageRequest,
  MindooDBAppViewPageResult,
  MindooDBAppViewRow,
  MindooDBAppWritableAttachmentStream,
} from "../types";

const PROTOCOL = "mindoodb-app-bridge";
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;

function toTransferableArrayBuffer(chunk: Uint8Array) {
  return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
}

function isStreamChunkFor(streamId: string, message: MindooDBAppBridgePortMessage): message is MindooDBAppAttachmentChunk {
  return message.kind === "stream-chunk" && message.streamId === streamId;
}

function isStreamAckFor(streamId: string, message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeStreamAck {
  return message.kind === "stream-ack" && message.streamId === streamId;
}

function isStreamErrorFor(streamId: string, message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeStreamError {
  return message.kind === "stream-error" && message.streamId === streamId;
}

function toStreamError(message: MindooDBAppBridgeStreamError) {
  const error = new Error(message.error.message);
  error.name = message.error.code || "MindooDBAppBridgeStreamError";
  return error;
}

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

class MindooDBAppViewHandleImpl implements MindooDBAppViewHandle {
  constructor(
    private readonly rpc: PortRpcClient,
    private readonly databaseId: string,
    private readonly viewId: string,
  ) {}

  async getDefinition(): Promise<MindooDBAppViewDefinition> {
    return await this.rpc.call("views.getDefinition", {
      databaseId: this.databaseId,
      viewId: this.viewId,
    });
  }

  async refresh(): Promise<void> {
    await this.rpc.call("views.refresh", {
      databaseId: this.databaseId,
      viewId: this.viewId,
    });
  }

  async page(input?: MindooDBAppViewPageRequest): Promise<MindooDBAppViewPageResult> {
    return await this.rpc.call("views.page", {
      databaseId: this.databaseId,
      viewId: this.viewId,
      request: input ?? {},
    });
  }

  async getExpansionState(): Promise<MindooDBAppViewExpansionState> {
    return await this.rpc.call("views.expansion.get", {
      databaseId: this.databaseId,
      viewId: this.viewId,
    });
  }

  async setExpansionState(state: MindooDBAppViewExpansionState): Promise<MindooDBAppViewExpansionState> {
    return await this.rpc.call("views.expansion.set", {
      databaseId: this.databaseId,
      viewId: this.viewId,
      expansion: state,
    });
  }

  async expand(rowKey: string): Promise<MindooDBAppViewExpansionState> {
    return await this.rpc.call("views.expansion.expand", {
      databaseId: this.databaseId,
      viewId: this.viewId,
      rowKey,
    });
  }

  async collapse(rowKey: string): Promise<MindooDBAppViewExpansionState> {
    return await this.rpc.call("views.expansion.collapse", {
      databaseId: this.databaseId,
      viewId: this.viewId,
      rowKey,
    });
  }

  async expandAll(): Promise<MindooDBAppViewExpansionState> {
    return await this.rpc.call("views.expansion.expandAll", {
      databaseId: this.databaseId,
      viewId: this.viewId,
    });
  }

  async collapseAll(): Promise<MindooDBAppViewExpansionState> {
    return await this.rpc.call("views.expansion.collapseAll", {
      databaseId: this.databaseId,
      viewId: this.viewId,
    });
  }

  async getRow(rowKey: string): Promise<MindooDBAppViewRow | null> {
    return await this.rpc.call("views.row.get", {
      databaseId: this.databaseId,
      viewId: this.viewId,
      rowKey,
    });
  }

  async getCategory(input: MindooDBAppViewLookupByPath): Promise<MindooDBAppViewRow | null> {
    return await this.rpc.call("views.category.get", {
      databaseId: this.databaseId,
      viewId: this.viewId,
      lookup: input,
    });
  }

  async pageCategory(categoryKey: string, input?: MindooDBAppViewCategoryChildrenPageRequest): Promise<MindooDBAppViewPageResult> {
    return await this.rpc.call("views.category.page", {
      databaseId: this.databaseId,
      viewId: this.viewId,
      categoryKey,
      request: input ?? {},
    });
  }

  async listCategoryDocumentIds(categoryKey: string): Promise<string[]> {
    return await this.rpc.call("views.category.documentIds", {
      databaseId: this.databaseId,
      viewId: this.viewId,
      categoryKey,
    });
  }

  async dispose(): Promise<void> {
    await this.rpc.call("views.dispose", {
      databaseId: this.databaseId,
      viewId: this.viewId,
    });
  }
}

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

  private enqueue(operation: () => Promise<void>) {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async waitForAck(send: () => void) {
    return await new Promise<void>((resolve, reject) => {
      this.inflight = { resolve, reject };
      send();
    });
  }

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

class MindooDBAppDatabaseImpl implements MindooDBAppDatabase {
  public readonly documents: MindooDBAppDocumentApi;
  public readonly views: MindooDBAppViewApi;
  public readonly attachments: MindooDBAppAttachmentApi;

  constructor(private readonly rpc: PortRpcClient, private readonly databaseId: string) {
    this.documents = {
      list: async (query) => await this.rpc.call("documents.list", {
        databaseId: this.databaseId,
        query: query ?? {},
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

    this.views = {
      create: async (definition) => {
        const result = await this.rpc.call<{ viewId: string }>("views.create", {
          databaseId: this.databaseId,
          definition,
        });
        return new MindooDBAppViewHandleImpl(this.rpc, this.databaseId, result.viewId);
      },
      open: async (viewId) => new MindooDBAppViewHandleImpl(this.rpc, this.databaseId, viewId),
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
    };
  }

  async info(): Promise<MindooDBAppDatabaseInfo> {
    return await this.rpc.call("databases.info", {
      databaseId: this.databaseId,
    });
  }
}

class MindooDBAppSessionImpl implements MindooDBAppSession {
  constructor(private readonly rpc: PortRpcClient) {}

  async getLaunchContext(): Promise<MindooDBAppLaunchContext> {
    return await this.rpc.call("session.getLaunchContext", {});
  }

  async listDatabases(): Promise<MindooDBAppDatabaseInfo[]> {
    return await this.rpc.call("session.listDatabases", {});
  }

  async openDatabase(databaseId: string): Promise<MindooDBAppDatabase> {
    await this.rpc.call("session.openDatabase", { databaseId });
    return new MindooDBAppDatabaseImpl(this.rpc, databaseId);
  }

  async disconnect(): Promise<void> {
    try {
      await this.rpc.call("session.disconnect", {});
    } finally {
      this.rpc.dispose();
    }
  }
}

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
