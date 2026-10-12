import type {
  MindooDBAppBridgePortMessage,
  MindooDBAppBridgeReminderOpenedMessage,
  MindooDBAppReminder,
  MindooDBAppReminderOpened,
  MindooDBAppReminderOpenedHandler,
  MindooDBAppReminderRequest,
  MindooDBAppReminderScheduleResult,
  MindooDBAppRemindersApi,
} from "../types";
import type { PortRpcClient } from "./portRpcClient";

function isReminderOpenedMessage(message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeReminderOpenedMessage {
  return message.kind === "reminder-opened";
}

function isUnknownMethod(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "method-not-found" || code === "unsupported";
}

/**
 * `session.reminders`. Haven only delivers taps after `reminders.subscribe`,
 * so taps from before the app was running wait in Haven until a handler is
 * registered.
 */
export class MindooDBAppRemindersApiImpl implements MindooDBAppRemindersApi {
  private handler: MindooDBAppReminderOpenedHandler | null = null;
  private readonly pending: MindooDBAppReminderOpened[] = [];
  private readonly stopListening: () => void;

  constructor(private readonly rpc: PortRpcClient) {
    this.stopListening = this.rpc.addMessageListener((message) => {
      if (!isReminderOpenedMessage(message)) {
        return;
      }
      if (this.handler) {
        void this.deliver(message.reminder);
      } else {
        this.pending.push(message.reminder);
      }
    });
  }

  async schedule(request: MindooDBAppReminderRequest): Promise<MindooDBAppReminderScheduleResult> {
    const at = request.at instanceof Date ? request.at.getTime() : request.at;
    try {
      return await this.rpc.call<MindooDBAppReminderScheduleResult>("reminders.schedule", {
        id: request.id,
        title: request.title,
        body: request.body,
        at,
        target: request.target,
      });
    } catch (error) {
      if (isUnknownMethod(error)) {
        return { status: "unsupported" };
      }
      throw error;
    }
  }

  async cancel(id: string): Promise<void> {
    try {
      await this.rpc.call("reminders.cancel", { id });
    } catch (error) {
      if (!isUnknownMethod(error)) {
        throw error;
      }
    }
  }

  async list(): Promise<MindooDBAppReminder[]> {
    try {
      return await this.rpc.call<MindooDBAppReminder[]>("reminders.list", {});
    } catch (error) {
      if (isUnknownMethod(error)) {
        return [];
      }
      throw error;
    }
  }

  onOpened(handler: MindooDBAppReminderOpenedHandler): () => void {
    this.handler = handler;
    void this.rpc.call("reminders.subscribe", {}).catch(() => {
      // Older Haven versions have no reminders; nothing will be delivered.
    });
    this.pending.splice(0).forEach((opened) => {
      void this.deliver(opened);
    });
    return () => {
      if (this.handler !== handler) {
        return;
      }
      this.handler = null;
      void this.rpc.call("reminders.unsubscribe", {}).catch(() => {});
    };
  }

  dispose() {
    this.stopListening();
    this.handler = null;
    this.pending.length = 0;
  }

  private async deliver(opened: MindooDBAppReminderOpened) {
    const handler = this.handler;
    if (!handler) {
      this.pending.push(opened);
      return;
    }
    try {
      await handler(opened);
    } catch (error) {
      console.warn("[mindoodb-app-sdk] A reminder handler failed.", error);
    }
  }
}
