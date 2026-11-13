import type {
  MindooDBAppBridgeFamiliesChangedMessage,
  MindooDBAppBridgePortMessage,
  MindooDBAppDatabase,
  MindooDBAppDatabaseFamiliesApi,
  MindooDBAppFamilyChange,
  MindooDBAppFamilyDatabase,
  MindooDBAppFamilyUnsubscribeOptions,
} from "../types";
import { MINDOODB_APP_FAMILY_MEMBER_ID_PATTERN } from "../appDefinition";
import type { PortRpcClient } from "./portRpcClient";

function isFamiliesChangedMessage(
  message: MindooDBAppBridgePortMessage,
): message is MindooDBAppBridgeFamiliesChangedMessage {
  return message.kind === "families-changed";
}

function isUnknownMethod(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "method-not-found" || code === "unsupported";
}

function requireMemberId(memberId: string): string {
  if (!MINDOODB_APP_FAMILY_MEMBER_ID_PATTERN.test(memberId)) {
    throw new Error(
      `families: member id "${memberId}" must match ${String(MINDOODB_APP_FAMILY_MEMBER_ID_PATTERN)}.`,
    );
  }
  return memberId;
}

/** `session.families`; `openDatabase` builds the handle once the host has the binding. */
export class MindooDBAppDatabaseFamiliesApiImpl implements MindooDBAppDatabaseFamiliesApi {
  constructor(
    private readonly rpc: PortRpcClient,
    private readonly openDatabase: (databaseId: string) => Promise<MindooDBAppDatabase>,
  ) {}

  async list(family: string): Promise<MindooDBAppFamilyDatabase[]> {
    try {
      return await this.rpc.call<MindooDBAppFamilyDatabase[]>("families.list", { family });
    } catch (error) {
      if (isUnknownMethod(error)) {
        return [];
      }
      throw error;
    }
  }

  async open(family: string, memberId: string): Promise<MindooDBAppDatabase> {
    let opened: MindooDBAppFamilyDatabase;
    try {
      opened = await this.rpc.call<MindooDBAppFamilyDatabase>("families.open", {
        family,
        memberId: requireMemberId(memberId),
      });
    } catch (error) {
      if (isUnknownMethod(error)) {
        throw new Error("This Haven version does not support database families (session.families).");
      }
      throw error;
    }
    return await this.openDatabase(opened.databaseId);
  }

  async subscribe(family: string, memberId: string): Promise<MindooDBAppFamilyDatabase> {
    return await this.rpc.call<MindooDBAppFamilyDatabase>("families.subscribe", {
      family,
      memberId: requireMemberId(memberId),
    });
  }

  async unsubscribe(
    family: string,
    memberId: string,
    options: MindooDBAppFamilyUnsubscribeOptions = {},
  ): Promise<void> {
    await this.rpc.call("families.unsubscribe", {
      family,
      memberId: requireMemberId(memberId),
      removeLocalCopy: options.removeLocalCopy === true,
    });
  }

  onChange(handler: (change: MindooDBAppFamilyChange) => void): () => void {
    return this.rpc.addMessageListener((message) => {
      if (isFamiliesChangedMessage(message)) {
        handler(message.change);
      }
    });
  }
}
