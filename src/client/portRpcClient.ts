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

function toBridgeError(error: MindooDBAppBridgeErrorPayload) {
  const wrapped = new Error(error.message);
  wrapped.name = error.code || "MindooDBAppBridgeError";
  return wrapped;
}

function isRpcMessage(message: unknown): message is MindooDBAppBridgeRpcMessage {
  if (!isProtocolMessage(message)) {
    return false;
  }
  return "id" in message && typeof (message as { id?: unknown }).id === "string";
}

function isProtocolMessage(message: unknown): message is MindooDBAppBridgePortMessage {
  return Boolean(
    message
    && typeof message === "object"
    && "protocol" in message
    && (message as { protocol?: unknown }).protocol === PROTOCOL,
  );
}

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

  async call<TResult>(method: string, params: unknown): Promise<TResult> {
    if (this.disposed) {
      throw new Error("The bridge connection has already been closed.");
    }

    const id = `${Date.now()}-${this.requestCounter += 1}`;
    const message: MindooDBAppBridgeRpcRequest = {
      protocol: PROTOCOL,
      kind: "request",
      id,
      method,
      params,
    };

    return await new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.port.postMessage(message);
    });
  }

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

  addMessageListener(listener: (message: MindooDBAppBridgePortMessage) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  postMessage(message: MindooDBAppBridgePortMessage, transfer: Transferable[] = []) {
    if (this.disposed) {
      throw new Error("The bridge connection has already been closed.");
    }
    this.port.postMessage(message, transfer);
  }

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
