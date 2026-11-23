/**
 * `session.transfer` as the mocks play Haven: offers of all mock sessions in
 * one page sit in a shared registry, so the test host's "Two users" mode (or two
 * sessions in a unit test) can hand a file from one to the other. Bytes are not
 * encrypted and nothing goes over a network; progress advances on a timer.
 *
 * @module mockTransfer
 */
import type {
  MindooDBAppBridgePortMessage,
  MindooDBAppTransferApi,
  MindooDBAppTransferDescriptor,
  MindooDBAppTransferIncoming,
  MindooDBAppTransferOutgoing,
  MindooDBAppTransferProgress,
} from "../types";
import { isMindooDBAppTransferDescriptor } from "../client/transfer";

export interface MockTransferController {
  /** `false`: as on a host without direct transfers. */
  setAvailable(available: boolean): void;
  /** Transfer ids this session offers right now. */
  offers(): string[];
  /** Steps a mock transfer takes (default 5) and the delay between them (default 40 ms). */
  setPace(steps: number, delayMs: number): void;
}

interface Offer {
  descriptor: MindooDBAppTransferDescriptor;
  file: Blob;
  from: string;
  to: string;
  progress: (progress: MindooDBAppTransferProgress) => void;
}

/** All mock offers of this page, by transfer id. */
const registry = new Map<string, Offer>();

const FINAL = new Set(["done", "failed", "cancelled"]);

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function progressHub(initial: MindooDBAppTransferProgress) {
  let current = initial;
  const handlers = new Set<(progress: MindooDBAppTransferProgress) => void>();
  return {
    get current() {
      return current;
    },
    set(next: MindooDBAppTransferProgress) {
      current = next;
      for (const handler of [...handlers]) handler({ ...next });
    },
    on(handler: (progress: MindooDBAppTransferProgress) => void) {
      handlers.add(handler);
      handler({ ...current });
      return () => {
        handlers.delete(handler);
      };
    },
  };
}

export function createMockTransfer(options: { username: () => string; tenantId: () => string | undefined }) {
  let available = true;
  let steps = 5;
  let delayMs = 40;
  const mine = new Set<string>();
  const running = new Map<string, () => void>();
  /** Level 2: pushes to the app's port. */
  let post: ((message: MindooDBAppBridgePortMessage) => boolean) | null = null;

  function offer(input: { file: Blob; name?: string; type?: string; to: string }, report: (p: MindooDBAppTransferProgress) => void) {
    if (!available) throw Object.assign(new Error("Direct transfers are not available."), { name: "unsupported" });
    if (!(input?.file instanceof Blob)) throw Object.assign(new Error("transfer.offer needs a file."), { name: "invalid-params" });
    if (!input.to) throw Object.assign(new Error("transfer.offer needs to."), { name: "invalid-params" });
    const descriptor: MindooDBAppTransferDescriptor = {
      v: 1,
      transferId: randomId(),
      name: (input.name ?? (input.file as File).name ?? "file") || "file",
      type: input.type || input.file.type || "application/octet-stream",
      size: input.file.size,
      blockSize: 1024 * 1024,
      key: "bW9jaw==",
      nonce: "bW9jaw==",
      endpointId: "0".repeat(64),
      tenantId: options.tenantId() ?? "t_mocktenant",
    };
    registry.set(descriptor.transferId, { descriptor, file: input.file, from: options.username(), to: input.to, progress: report });
    mine.add(descriptor.transferId);
    report({ transferId: descriptor.transferId, state: "waiting", bytes: 0, total: descriptor.size });
    return descriptor;
  }

  function cancel(transferId: string) {
    running.get(transferId)?.();
    if (mine.delete(transferId)) {
      const entry = registry.get(transferId);
      registry.delete(transferId);
      entry?.progress({ transferId, state: "cancelled", bytes: 0, total: entry.descriptor.size });
    }
  }

  function receive(descriptor: MindooDBAppTransferDescriptor, from: string, report: (p: MindooDBAppTransferProgress, file?: File) => void) {
    if (!available) throw Object.assign(new Error("Direct transfers are not available."), { name: "unsupported" });
    if (!isMindooDBAppTransferDescriptor(descriptor)) throw Object.assign(new Error("Not a transfer descriptor."), { name: "invalid-params" });
    const { transferId, size } = descriptor;
    let step = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      running.delete(transferId);
      report({ transferId, state: "cancelled", bytes: 0, total: size });
    };
    running.set(transferId, stop);
    const tick = () => {
      const entry = registry.get(transferId);
      if (!entry || entry.from !== from || entry.to !== options.username()) {
        running.delete(transferId);
        report({ transferId, state: "failed", bytes: 0, total: size, error: "The other person is no longer offering this file." });
        return;
      }
      step += 1;
      const bytes = Math.min(size, Math.round((size * step) / steps));
      if (step >= steps) {
        running.delete(transferId);
        entry.progress({ transferId, state: "done", bytes: size, total: size });
        const file = new File([entry.file], entry.descriptor.name, { type: entry.descriptor.type });
        report({ transferId, state: "done", bytes: size, total: size }, file);
        return;
      }
      entry.progress({ transferId, state: "transferring", bytes, total: size });
      report({ transferId, state: "transferring", bytes, total: size });
      timer = setTimeout(tick, delayMs);
    };
    report({ transferId, state: "connecting", bytes: 0, total: size });
    timer = setTimeout(tick, delayMs);
  }

  /** Level 1: the mock session's own `session.transfer`. */
  const api: MindooDBAppTransferApi = {
    async available() {
      return available;
    },
    async offer(input) {
      let hub: ReturnType<typeof progressHub> | null = null;
      const pending: MindooDBAppTransferProgress[] = [];
      const descriptor = offer(input, (p) => (hub ? hub.set(p) : pending.push(p)));
      hub = progressHub(pending[pending.length - 1] ?? { transferId: descriptor.transferId, state: "waiting", bytes: 0, total: descriptor.size });
      const outgoing: MindooDBAppTransferOutgoing = {
        descriptor,
        onProgress: (handler) => hub!.on(handler),
        async cancel() {
          cancel(descriptor.transferId);
        },
      };
      return outgoing;
    },
    async receive(descriptor, receiveOptions) {
      const hub = progressHub({ transferId: descriptor?.transferId ?? "", state: "waiting", bytes: 0, total: descriptor?.size ?? 0 });
      let resolve!: (file: File) => void;
      let reject!: (error: Error) => void;
      const file = new Promise<File>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      file.catch(() => undefined);
      receive(descriptor, receiveOptions?.from ?? "", (p, received) => {
        hub.set(p);
        if (p.state === "done" && received) resolve(received);
        else if (FINAL.has(p.state) && p.state !== "done") reject(Object.assign(new Error(p.error ?? p.state), { name: p.state }));
      });
      const incoming: MindooDBAppTransferIncoming = {
        transferId: descriptor.transferId,
        onProgress: (handler) => hub.on(handler),
        file,
        async cancel() {
          running.get(descriptor.transferId)?.();
        },
        async discard() {},
      };
      return incoming;
    },
  };

  /** Level 2: the fake host's `transfer.*` requests; progress goes to the app's port. */
  async function dispatch(method: string, params: unknown, push: (message: MindooDBAppBridgePortMessage) => boolean) {
    const input = (params ?? {}) as Record<string, unknown>;
    const report = (progress: MindooDBAppTransferProgress, file?: File) => {
      (post ?? push)({ protocol: "mindoodb-app-bridge", kind: "transfer-progress", progress, ...(file ? { file } : {}) });
    };
    switch (method) {
      case "transfer.available":
        return { result: { available } };
      case "transfer.offer": {
        post = push;
        const descriptor = offer(input as never, report);
        return { result: { descriptor } };
      }
      case "transfer.receive":
        post = push;
        receive(input.descriptor as MindooDBAppTransferDescriptor, String(input.from ?? ""), report);
        return { result: { ok: true } };
      case "transfer.cancel":
        cancel(String(input.transferId ?? ""));
        return { result: { ok: true } };
      case "transfer.discard":
        return { result: { ok: true } };
      default:
        return undefined;
    }
  }

  const controller: MockTransferController = {
    setAvailable(next) {
      available = next;
    },
    offers: () => [...mine],
    setPace(nextSteps, nextDelay) {
      steps = Math.max(1, Math.round(nextSteps));
      delayMs = Math.max(0, nextDelay);
    },
  };

  function reset() {
    for (const id of [...mine]) cancel(id);
    for (const stop of [...running.values()]) stop();
    post = null;
  }

  return { api, dispatch, controller, reset };
}
