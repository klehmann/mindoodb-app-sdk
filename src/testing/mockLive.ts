/**
 * `session.live` as the mocks play Haven: channels of the same database are
 * connected inside one page, so two mock sessions (the test host's "Two users"
 * mode, or two sessions in a unit test) reach each other as they would through
 * a sync server. Nothing is encrypted or stored.
 *
 * @module mockLive
 */
import type {
  MindooDBAppBridgePortMessage,
  MindooDBAppLiveApi,
  MindooDBAppLiveChannel,
  MindooDBAppLiveMessage,
  MindooDBAppLiveOpenOptions,
  MindooDBAppLiveState,
} from "../types";

export interface MockLiveSent {
  databaseId: string;
  groupKeyDocId?: string;
  type: string;
  data: unknown;
}

export interface MockLiveController {
  /** As if another person sent this on the database's channel. */
  receive(databaseId: string, message: { from: string; type: string; data?: unknown; sentAt?: number }): void;
  /** Every message the app sent, oldest first. */
  sent(): MockLiveSent[];
  /** `unavailable`: as on a host without live channels. `connecting`: as while reconnecting. */
  setState(state: MindooDBAppLiveState): void;
  /** Database ids with an open channel. */
  openChannels(): string[];
}

interface Endpoint {
  key: string;
  deliver(message: MindooDBAppLiveMessage): void;
}

/** All mock channels of this page, by "tenant|database|group". */
const bus = new Map<string, Set<Endpoint>>();

export function createMockLive(options: {
  username: () => string;
  tenantId: () => string | undefined;
  requireLive: (databaseId: string) => void;
}) {
  const sent: MockLiveSent[] = [];
  let state: MindooDBAppLiveState = "connected";
  let counter = 0;
  const channels = new Map<
    string,
    {
      databaseId: string;
      endpoint: Endpoint;
      onMessage: Set<(message: MindooDBAppLiveMessage) => void>;
      onState: Set<(state: MindooDBAppLiveState) => void>;
    }
  >();
  /** Level 2: pushes to the app's port, by channel. */
  let post: ((message: MindooDBAppBridgePortMessage) => boolean) | null = null;

  function keyOf(input: MindooDBAppLiveOpenOptions) {
    return `${options.tenantId() ?? "t_mocktenant"}|${input.databaseId}|${input.groupKeyDocId ?? ""}`;
  }

  function openChannel(input: MindooDBAppLiveOpenOptions) {
    if (!input?.databaseId) {
      throw Object.assign(new Error("live.open needs a databaseId."), { name: "invalid-params" });
    }
    options.requireLive(input.databaseId);
    counter += 1;
    const channelId = `mock-live-${counter}`;
    const record = {
      databaseId: input.databaseId,
      onMessage: new Set<(message: MindooDBAppLiveMessage) => void>(),
      onState: new Set<(state: MindooDBAppLiveState) => void>(),
      endpoint: {
        key: keyOf(input),
        deliver(message: MindooDBAppLiveMessage) {
          if (state !== "connected") return;
          for (const handler of [...record.onMessage]) handler(message);
          post?.({ protocol: "mindoodb-app-bridge", kind: "live-message", channelId, message });
        },
      } as Endpoint,
    };
    channels.set(channelId, record);
    const peers = bus.get(record.endpoint.key) ?? new Set<Endpoint>();
    peers.add(record.endpoint);
    bus.set(record.endpoint.key, peers);
    return { channelId, record, input };
  }

  function send(channelId: string, input: MindooDBAppLiveOpenOptions, type: string, data: unknown) {
    const record = channels.get(channelId);
    if (!record) throw new Error("The live channel is closed.");
    if (typeof type !== "string" || type === "" || type.length > 64) {
      throw Object.assign(new Error("A live message needs a type of 1 to 64 characters."), { name: "invalid-params" });
    }
    sent.push({ databaseId: record.databaseId, ...(input.groupKeyDocId ? { groupKeyDocId: input.groupKeyDocId } : {}), type, data: data ?? null });
    if (state !== "connected") return;
    const message: MindooDBAppLiveMessage = { from: options.username(), type, data: data ?? null, sentAt: Date.now() };
    for (const peer of bus.get(record.endpoint.key) ?? []) {
      if (peer !== record.endpoint) peer.deliver(structuredClone(message));
    }
  }

  function close(channelId: string) {
    const record = channels.get(channelId);
    if (!record) return;
    channels.delete(channelId);
    const peers = bus.get(record.endpoint.key);
    peers?.delete(record.endpoint);
    if (peers && peers.size === 0) bus.delete(record.endpoint.key);
  }

  /** Level 1: the mock session's own `session.live`. */
  const api: MindooDBAppLiveApi = {
    async open(input) {
      const { channelId, record } = openChannel(input);
      const channel: MindooDBAppLiveChannel = {
        async send(type, data) {
          send(channelId, input, type, data);
        },
        onMessage(handler) {
          record.onMessage.add(handler);
          return () => {
            record.onMessage.delete(handler);
          };
        },
        onState(handler) {
          record.onState.add(handler);
          handler(state);
          return () => {
            record.onState.delete(handler);
          };
        },
        get state() {
          return state;
        },
        async close() {
          close(channelId);
        },
      };
      return channel;
    },
  };

  /** Level 2: the fake host's `live.*` requests; `push` reaches the app's port. */
  const inputs = new Map<string, MindooDBAppLiveOpenOptions>();
  async function dispatch(method: string, params: unknown, push: (message: MindooDBAppBridgePortMessage) => boolean) {
    const input = (params ?? {}) as { channelId?: string; type?: string; data?: unknown } & Partial<MindooDBAppLiveOpenOptions>;
    switch (method) {
      case "live.open": {
        post = push;
        const opened = openChannel({ databaseId: String(input.databaseId ?? ""), ...(input.groupKeyDocId ? { groupKeyDocId: input.groupKeyDocId } : {}) });
        inputs.set(opened.channelId, opened.input);
        return { result: { channelId: opened.channelId, state } };
      }
      case "live.send":
        send(String(input.channelId), inputs.get(String(input.channelId)) ?? { databaseId: "" }, String(input.type ?? ""), input.data);
        return { result: { ok: true } };
      case "live.close":
        close(String(input.channelId));
        inputs.delete(String(input.channelId));
        return { result: { ok: true } };
      default:
        return undefined;
    }
  }

  const controller: MockLiveController = {
    receive(databaseId, message) {
      const delivered: MindooDBAppLiveMessage = {
        from: message.from,
        type: message.type,
        data: message.data ?? null,
        sentAt: message.sentAt ?? Date.now(),
      };
      for (const record of channels.values()) {
        if (record.databaseId === databaseId) record.endpoint.deliver(delivered);
      }
    },
    sent: () => sent.map((entry) => ({ ...entry })),
    setState(next) {
      state = next;
      for (const [channelId, record] of channels) {
        for (const handler of [...record.onState]) handler(next);
        post?.({ protocol: "mindoodb-app-bridge", kind: "live-state", channelId, state: next });
      }
    },
    openChannels: () => [...new Set([...channels.values()].map((record) => record.databaseId))],
  };

  function reset() {
    for (const channelId of [...channels.keys()]) close(channelId);
    inputs.clear();
    post = null;
  }

  return { api, dispatch, controller, reset };
}
