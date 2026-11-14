import type {
  MindooDBAppBridgeLiveMessageMessage,
  MindooDBAppBridgeLiveStateMessage,
  MindooDBAppBridgePortMessage,
  MindooDBAppLiveApi,
  MindooDBAppLiveChannel,
  MindooDBAppLiveMessage,
  MindooDBAppLiveOpenOptions,
  MindooDBAppLiveState,
} from "../types";
import type { PortRpcClient } from "./portRpcClient";

/** Longest `type` of a live message. */
export const MINDOODB_APP_LIVE_TYPE_MAX = 64;

function isLiveMessage(message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeLiveMessageMessage {
  return message.kind === "live-message";
}

function isLiveState(message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeLiveStateMessage {
  return message.kind === "live-state";
}

class LiveChannelImpl implements MindooDBAppLiveChannel {
  private readonly messageHandlers = new Set<(message: MindooDBAppLiveMessage) => void>();
  private readonly stateHandlers = new Set<(state: MindooDBAppLiveState) => void>();
  private closed = false;

  constructor(
    private readonly rpc: PortRpcClient | null,
    private readonly channelId: string | null,
    private currentState: MindooDBAppLiveState,
    private readonly forget: () => void,
  ) {}

  get state(): MindooDBAppLiveState {
    return this.currentState;
  }

  async send(type: string, data?: unknown): Promise<void> {
    if (this.closed) {
      throw new Error("The live channel is closed.");
    }
    if (typeof type !== "string" || type === "" || type.length > MINDOODB_APP_LIVE_TYPE_MAX) {
      throw new Error(`A live message needs a type of 1 to ${MINDOODB_APP_LIVE_TYPE_MAX} characters.`);
    }
    if (!this.rpc || !this.channelId || this.currentState === "unavailable") {
      // No channel on this host: live messages are best-effort by definition.
      return;
    }
    await this.rpc.call("live.send", { channelId: this.channelId, type, ...(data === undefined ? {} : { data }) });
  }

  onMessage(handler: (message: MindooDBAppLiveMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onState(handler: (state: MindooDBAppLiveState) => void): () => void {
    this.stateHandlers.add(handler);
    handler(this.currentState);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.messageHandlers.clear();
    this.stateHandlers.clear();
    this.forget();
    if (this.rpc && this.channelId) {
      await this.rpc.call("live.close", { channelId: this.channelId }).catch(() => undefined);
    }
  }

  deliver(message: MindooDBAppLiveMessage) {
    for (const handler of [...this.messageHandlers]) {
      try {
        handler(message);
      } catch (error) {
        console.warn("[mindoodb-app-sdk] A live message handler failed.", error);
      }
    }
  }

  setState(state: MindooDBAppLiveState) {
    if (this.closed || state === this.currentState) {
      return;
    }
    this.currentState = state;
    for (const handler of [...this.stateHandlers]) {
      try {
        handler(state);
      } catch (error) {
        console.warn("[mindoodb-app-sdk] A live state handler failed.", error);
      }
    }
  }
}

/**
 * `session.live`. Haven encrypts, signs, relays and checks the messages; the
 * app only names the database (and, for a private group, its group document).
 */
export class MindooDBAppLiveApiImpl implements MindooDBAppLiveApi {
  private readonly channels = new Map<string, LiveChannelImpl>();
  private readonly stopListening: () => void;

  constructor(private readonly rpc: PortRpcClient) {
    this.stopListening = this.rpc.addMessageListener((message) => {
      if (isLiveMessage(message)) {
        this.channels.get(message.channelId)?.deliver(message.message);
      } else if (isLiveState(message)) {
        this.channels.get(message.channelId)?.setState(message.state);
      }
    });
  }

  async open(options: MindooDBAppLiveOpenOptions): Promise<MindooDBAppLiveChannel> {
    if (!options || typeof options.databaseId !== "string" || !options.databaseId) {
      throw new Error("live.open needs a databaseId.");
    }
    let opened: { channelId: string; state: MindooDBAppLiveState };
    try {
      opened = await this.rpc.call<{ channelId: string; state: MindooDBAppLiveState }>("live.open", {
        databaseId: options.databaseId,
        ...(options.groupKeyDocId ? { groupKeyDocId: options.groupKeyDocId } : {}),
      });
    } catch (error) {
      // A refusal the app must hear about (unknown database, missing permission) ...
      const name = (error as { name?: string } | null)?.name;
      if (name === "forbidden" || name === "database-not-found" || name === "invalid-params") {
        throw error;
      }
      // ... anything else is an older Haven without live channels.
      return new LiveChannelImpl(null, null, "unavailable", () => undefined);
    }
    const channel = new LiveChannelImpl(this.rpc, opened.channelId, opened.state, () => {
      this.channels.delete(opened.channelId);
    });
    this.channels.set(opened.channelId, channel);
    return channel;
  }

  dispose() {
    this.stopListening();
    this.channels.clear();
  }
}
