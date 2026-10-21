import type {
  MindooDBAppAccountBlobDownload,
  MindooDBAppAccountBlobUpload,
  MindooDBAppAccountRequestInput,
  MindooDBAppAccountRequestResult,
  MindooDBAppAccountsApi,
  MindooDBAppAccountSummary,
  MindooDBAppJmapRequest,
  MindooDBAppJmapResponse,
  MindooDBAppJmapSession,
} from "../types";
import type { PortRpcClient } from "./portRpcClient";

const MAX_BLOB_BYTES = 25 * 1024 * 1024;

function isUnknownMethod(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "method-not-found" || code === "unsupported";
}

/** `session.accounts`: everything goes to Haven, which holds the credentials. */
export class MindooDBAppAccountsApiImpl implements MindooDBAppAccountsApi {
  constructor(private readonly rpc: PortRpcClient) {}

  async list(): Promise<MindooDBAppAccountSummary[]> {
    try {
      return await this.rpc.call<MindooDBAppAccountSummary[]>("accounts.list", {});
    } catch (error) {
      if (isUnknownMethod(error)) {
        return [];
      }
      throw error;
    }
  }

  async request(input: MindooDBAppAccountRequestInput): Promise<MindooDBAppAccountRequestResult> {
    try {
      return await this.rpc.call<MindooDBAppAccountRequestResult>("accounts.request", {
        scopes: [...input.scopes],
        multiple: input.multiple === true,
        kinds: input.kinds ? [...input.kinds] : undefined,
        reason: input.reason,
      });
    } catch (error) {
      if (isUnknownMethod(error)) {
        return { ok: false, reason: "unsupported" };
      }
      throw error;
    }
  }

  async release(accountId: string): Promise<void> {
    await this.rpc.call("accounts.release", { accountId });
  }

  async jmapSession(accountId: string): Promise<MindooDBAppJmapSession> {
    return await this.rpc.call<MindooDBAppJmapSession>("accounts.jmapSession", { accountId });
  }

  async jmap(accountId: string, request: MindooDBAppJmapRequest): Promise<MindooDBAppJmapResponse> {
    return await this.rpc.call<MindooDBAppJmapResponse>("accounts.jmap", {
      accountId,
      request: { using: [...request.using], methodCalls: request.methodCalls },
    });
  }

  async uploadBlob(
    accountId: string,
    input: MindooDBAppAccountBlobUpload,
  ): Promise<{ blobId: string; type: string; size: number }> {
    if (input.data.byteLength > MAX_BLOB_BYTES) {
      throw new Error("Attachments are limited to 25 MB.");
    }
    return await this.rpc.call("accounts.uploadBlob", {
      accountId,
      name: input.name,
      type: input.type,
      data: input.data,
    });
  }

  async downloadBlob(
    accountId: string,
    input: MindooDBAppAccountBlobDownload,
  ): Promise<{ name: string; type: string; data: Uint8Array }> {
    return await this.rpc.call("accounts.downloadBlob", {
      accountId,
      blobId: input.blobId,
      name: input.name,
      type: input.type,
    });
  }
}
