import type {
  MindooDBAppActionInvoked,
  MindooDBAppActionInvokedHandler,
  MindooDBAppActionsApi,
  MindooDBAppBridgeActionInvokedMessage,
  MindooDBAppBridgePortMessage,
} from "../types";
import type { PortRpcClient } from "./portRpcClient";

function isActionInvokedMessage(message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeActionInvokedMessage {
  return message.kind === "action-invoked";
}

/**
 * `session.actions`. Haven only delivers runs after `actions.subscribe`, so a
 * run that started the app waits in Haven until a handler is registered.
 */
export class MindooDBAppActionsApiImpl implements MindooDBAppActionsApi {
  private handler: MindooDBAppActionInvokedHandler | null = null;
  private readonly pending: MindooDBAppActionInvoked[] = [];
  private readonly stopListening: () => void;

  constructor(private readonly rpc: PortRpcClient) {
    this.stopListening = this.rpc.addMessageListener((message) => {
      if (!isActionInvokedMessage(message)) {
        return;
      }
      if (this.handler) {
        void this.deliver(message.action);
      } else {
        this.pending.push(message.action);
      }
    });
  }

  onInvoked(handler: MindooDBAppActionInvokedHandler): () => void {
    this.handler = handler;
    void this.rpc.call("actions.subscribe", {}).catch(() => {
      // Older Haven versions have no actions; nothing will be delivered.
    });
    this.pending.splice(0).forEach((invoked) => {
      void this.deliver(invoked);
    });
    return () => {
      if (this.handler !== handler) {
        return;
      }
      this.handler = null;
      void this.rpc.call("actions.unsubscribe", {}).catch(() => {});
    };
  }

  dispose() {
    this.stopListening();
    this.handler = null;
    this.pending.length = 0;
  }

  private async deliver(invoked: MindooDBAppActionInvoked) {
    const handler = this.handler;
    if (!handler) {
      this.pending.push(invoked);
      return;
    }
    try {
      await handler(invoked);
    } catch (error) {
      console.warn("[mindoodb-app-sdk] An action handler failed.", error);
    }
  }
}
