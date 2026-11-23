import type {
  MindooDBAppBridgePortMessage,
  MindooDBAppBridgeTransferProgressMessage,
  MindooDBAppTransferApi,
  MindooDBAppTransferDescriptor,
  MindooDBAppTransferIncoming,
  MindooDBAppTransferOfferInput,
  MindooDBAppTransferOutgoing,
  MindooDBAppTransferProgress,
} from "../types";
import type { PortRpcClient } from "./portRpcClient";

const FINAL = new Set(["done", "failed", "cancelled"]);

function isTransferProgress(message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeTransferProgressMessage {
  return message.kind === "transfer-progress";
}

/** Checks the shape of a descriptor that arrived from the other side (it is the app's JSON). */
export function isMindooDBAppTransferDescriptor(value: unknown): value is MindooDBAppTransferDescriptor {
  const d = value as Partial<MindooDBAppTransferDescriptor> | null;
  return Boolean(
    d &&
      d.v === 1 &&
      typeof d.transferId === "string" &&
      /^[0-9A-Za-z_-]{8,64}$/.test(d.transferId) &&
      typeof d.name === "string" &&
      typeof d.type === "string" &&
      Number.isSafeInteger(d.size) &&
      (d.size as number) >= 0 &&
      Number.isSafeInteger(d.blockSize) &&
      (d.blockSize as number) > 0 &&
      typeof d.key === "string" &&
      typeof d.nonce === "string" &&
      typeof d.endpointId === "string" &&
      typeof d.tenantId === "string",
  );
}

class Progress {
  private readonly handlers = new Set<(progress: MindooDBAppTransferProgress) => void>();
  constructor(public current: MindooDBAppTransferProgress) {}

  on(handler: (progress: MindooDBAppTransferProgress) => void): () => void {
    this.handlers.add(handler);
    handler({ ...this.current });
    return () => {
      this.handlers.delete(handler);
    };
  }

  set(progress: MindooDBAppTransferProgress) {
    this.current = progress;
    for (const handler of [...this.handlers]) {
      try {
        handler({ ...progress });
      } catch (error) {
        console.warn("[mindoodb-app-sdk] A transfer progress handler failed.", error);
      }
    }
  }

  get final() {
    return FINAL.has(this.current.state);
  }
}

/**
 * `session.transfer` over the bridge. Haven reads, encrypts, serves and fetches
 * the bytes; the app only passes the file in and the descriptor around.
 */
export class MindooDBAppTransferApiImpl implements MindooDBAppTransferApi {
  private readonly progress = new Map<string, Progress>();
  private readonly files = new Map<string, { resolve: (file: File) => void; reject: (error: Error) => void }>();
  private readonly stopListening: () => void;

  constructor(private readonly rpc: PortRpcClient) {
    this.stopListening = this.rpc.addMessageListener((message) => {
      if (!isTransferProgress(message)) {
        return;
      }
      const { progress, file } = message;
      this.progress.get(progress.transferId)?.set(progress);
      const waiter = this.files.get(progress.transferId);
      if (!waiter) {
        return;
      }
      if (progress.state === "done" && file) {
        this.files.delete(progress.transferId);
        waiter.resolve(file);
      } else if (progress.state === "failed" || progress.state === "cancelled") {
        this.files.delete(progress.transferId);
        waiter.reject(Object.assign(new Error(progress.error ?? `The transfer was ${progress.state}.`), { name: progress.state }));
      }
    });
  }

  async available(): Promise<boolean> {
    try {
      const result = await this.rpc.call<{ available?: boolean }>("transfer.available", {});
      return result?.available === true;
    } catch {
      return false;
    }
  }

  async offer(input: MindooDBAppTransferOfferInput): Promise<MindooDBAppTransferOutgoing> {
    if (!input || !(input.file instanceof Blob)) {
      throw new Error("transfer.offer needs a file (a Blob or File).");
    }
    if (typeof input.to !== "string" || !input.to) {
      throw new Error("transfer.offer needs the username it is for (to).");
    }
    const name = (input.name ?? (input.file as File).name ?? "").trim() || "file";
    const type = input.type ?? input.file.type ?? "";
    const { descriptor } = await this.rpc.call<{ descriptor: MindooDBAppTransferDescriptor }>("transfer.offer", {
      file: input.file,
      name,
      type,
      to: input.to,
    });
    const progress = this.track(descriptor.transferId, descriptor.size);
    return {
      descriptor,
      onProgress: (handler) => progress.on(handler),
      cancel: async () => {
        await this.rpc.call("transfer.cancel", { transferId: descriptor.transferId }).catch(() => undefined);
        this.progress.delete(descriptor.transferId);
      },
    };
  }

  async receive(descriptor: MindooDBAppTransferDescriptor, options: { from: string }): Promise<MindooDBAppTransferIncoming> {
    if (!isMindooDBAppTransferDescriptor(descriptor)) {
      throw new Error("transfer.receive needs a transfer descriptor.");
    }
    if (typeof options?.from !== "string" || !options.from) {
      throw new Error("transfer.receive needs the sender's username (from).");
    }
    const progress = this.track(descriptor.transferId, descriptor.size);
    const file = new Promise<File>((resolve, reject) => {
      this.files.set(descriptor.transferId, { resolve, reject });
    });
    // Nobody may be awaiting it yet; an unhandled rejection would only be noise.
    file.catch(() => undefined);
    try {
      await this.rpc.call("transfer.receive", { descriptor, from: options.from });
    } catch (error) {
      this.files.delete(descriptor.transferId);
      this.progress.delete(descriptor.transferId);
      throw error;
    }
    const transferId = descriptor.transferId;
    return {
      transferId,
      onProgress: (handler) => progress.on(handler),
      file,
      cancel: async () => {
        await this.rpc.call("transfer.cancel", { transferId }).catch(() => undefined);
      },
      discard: async () => {
        await this.rpc.call("transfer.discard", { transferId }).catch(() => undefined);
        this.progress.delete(transferId);
      },
    };
  }

  private track(transferId: string, total: number): Progress {
    let progress = this.progress.get(transferId);
    if (!progress) {
      progress = new Progress({ transferId, state: "waiting", bytes: 0, total });
      this.progress.set(transferId, progress);
    }
    return progress;
  }

  dispose() {
    this.stopListening();
    this.progress.clear();
    for (const waiter of this.files.values()) {
      waiter.reject(Object.assign(new Error("The app closed."), { name: "cancelled" }));
    }
    this.files.clear();
  }
}
