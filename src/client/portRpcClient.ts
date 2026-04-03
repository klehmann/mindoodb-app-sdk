import type {
  MindooDBAppBridgePortMessage,
  MindooDBAppBridgeErrorPayload,
  MindooDBAppBridgeRpcError,
  MindooDBAppBridgeRpcMessage,
  MindooDBAppBridgeRpcRequest,
  MindooDBAppBridgeRpcSuccess,
} from "../types";

const PROTOCOL = "mindoodb-app-bridge";

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

function normalizeRpcValue<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (typeof value === "function") {
    throw new Error("Bridge RPC params cannot include functions.");
  }
  if (typeof value === "symbol") {
    throw new Error("Bridge RPC params cannot include symbols.");
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0) as T;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)) as T;
  }
  if (seen.has(value)) {
    return seen.get(value) as T;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const entry of value) {
      copy.push(normalizeRpcValue(entry, seen));
    }
    return copy as T;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, entry] of Object.entries(value)) {
    copy[key] = normalizeRpcValue(entry, seen);
  }
  return copy as T;
}

/** Converts a structured bridge error payload into a thrown `Error`. */
function toBridgeError(error: MindooDBAppBridgeErrorPayload) {
  const wrapped = new Error(error.message);
  wrapped.name = error.code || "MindooDBAppBridgeError";
  return wrapped;
}

/** Narrows an incoming protocol message to the RPC subset that carries request ids. */
function isRpcMessage(message: unknown): message is MindooDBAppBridgeRpcMessage {
  if (!isProtocolMessage(message)) {
    return false;
  }
  return "id" in message && typeof (message as { id?: unknown }).id === "string";
}

/** Guards all messages that belong to the MindooDB bridge protocol. */
function isProtocolMessage(message: unknown): message is MindooDBAppBridgePortMessage {
  return Boolean(
    message
    && typeof message === "object"
    && "protocol" in message
    && (message as { protocol?: unknown }).protocol === PROTOCOL,
  );
}

/**
 * Small RPC helper over a dedicated `MessagePort`.
 *
 * It tracks pending requests by id, resolves them when success/error responses
 * arrive, and also exposes a listener channel for non-RPC stream messages used
 * by attachment reads and writes.
 */
export class PortRpcClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<(message: MindooDBAppBridgePortMessage) => void>();
  private requestCounter = 0;
  private disposed = false;

  constructor(private readonly port: MessagePort) {
    this.handleMessage = this.handleMessage.bind(this);
    this.port.addEventListener("message", this.handleMessage as EventListener);
    this.port.start();
  }

  /** Sends one RPC request and resolves with the typed response payload. */
  async call<TResult>(method: string, params: unknown): Promise<TResult> {
    if (this.disposed) {
      throw new Error("The bridge connection has already been closed.");
    }

    const normalizedParams = normalizeRpcValue(params);
    const id = `${Date.now()}-${this.requestCounter += 1}`;
    const message: MindooDBAppBridgeRpcRequest = {
      protocol: PROTOCOL,
      kind: "request",
      id,
      method,
      params: normalizedParams,
    };

    return await new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.port.postMessage(message);
      } catch (error) {
        this.pending.delete(id);
        console.error("MindooDB app bridge RPC postMessage failed.", { method, params: normalizedParams, error });
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Closes the port and rejects any requests that are still waiting for a response. */
  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.port.removeEventListener("message", this.handleMessage as EventListener);
    this.port.close();
    this.pending.forEach(({ reject }) => reject(new Error("The bridge connection was closed.")));
    this.pending.clear();
    this.listeners.clear();
  }

  /** Subscribes to all protocol messages, including attachment stream traffic. */
  addMessageListener(listener: (message: MindooDBAppBridgePortMessage) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Posts a raw protocol message over the port, optionally with transferables. */
  postMessage(message: MindooDBAppBridgePortMessage, transfer: Transferable[] = []) {
    if (this.disposed) {
      throw new Error("The bridge connection has already been closed.");
    }
    try {
      this.port.postMessage(message, transfer);
    } catch (error) {
      console.error("MindooDB app bridge raw postMessage failed.", { message, transferCount: transfer.length, error });
      throw error;
    }
  }

  /** Dispatches incoming messages to listeners and resolves matching RPC requests. */
  private handleMessage(event: MessageEvent<unknown>) {
    if (!isProtocolMessage(event.data)) {
      return;
    }
    const message = event.data;

    this.listeners.forEach((listener) => listener(message));

    if (!isRpcMessage(message)) {
      return;
    }

    if (message.kind !== "success" && message.kind !== "error") {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    if (message.kind === "success") {
      pending.resolve((message as MindooDBAppBridgeRpcSuccess).result);
      return;
    }

    pending.reject(toBridgeError((message as MindooDBAppBridgeRpcError).error));
  }
}
