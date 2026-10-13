import type { MindooDBAppPdfApi, MindooDBAppPdfSignInput, MindooDBAppPdfSignResult } from "../types";
import type { PortRpcClient } from "./portRpcClient";

function isUnknownMethod(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "method-not-found" || code === "unsupported";
}

/** `session.pdf`. Older Haven versions answer `unsupported`. */
export class MindooDBAppPdfApiImpl implements MindooDBAppPdfApi {
  constructor(private readonly rpc: PortRpcClient) {}

  async sign(input: MindooDBAppPdfSignInput): Promise<MindooDBAppPdfSignResult> {
    try {
      return await this.rpc.call<MindooDBAppPdfSignResult>("pdf.sign", {
        pdf: input.pdf,
        fileName: input.fileName,
        reason: input.reason,
        location: input.location,
        contactInfo: input.contactInfo,
        visibleSignature: input.visibleSignature,
        timestamp: input.timestamp,
      });
    } catch (error) {
      if (isUnknownMethod(error)) {
        return { ok: false, reason: "unsupported" };
      }
      throw error;
    }
  }
}
