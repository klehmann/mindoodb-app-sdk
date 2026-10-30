import type {
  MindooDBAppFilesApi,
  MindooDBAppFilesShareOptions,
  MindooDBAppFilesShareResult,
  MindooDBAppShareFile,
} from "../types";
import type { PortRpcClient } from "./portRpcClient";

/** At most this many files per `session.files.share`. */
export const MAX_SHARE_FILES = 50;
/** At most this many bytes together per `session.files.share`. */
export const MAX_SHARE_BYTES = 200 * 1024 * 1024;

/** A file as it travels to Haven: name, type and bytes. */
export interface MindooDBAppShareFilePayload {
  name: string;
  type: string;
  data: Uint8Array;
}

function isUnknownMethod(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "method-not-found" || code === "unsupported";
}

/** Name, type and bytes of each file; throws a message when a limit is broken. */
export async function toShareFilePayloads(files: readonly MindooDBAppShareFile[]): Promise<MindooDBAppShareFilePayload[]> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("No files to share.");
  }
  if (files.length > MAX_SHARE_FILES) {
    throw new Error(`At most ${MAX_SHARE_FILES} files can be shared at once.`);
  }
  const payloads: MindooDBAppShareFilePayload[] = [];
  let total = 0;
  for (const file of files) {
    const name = String(file?.name ?? "").trim();
    if (!name) {
      throw new Error("Every file needs a name.");
    }
    const source = typeof File !== "undefined" && file instanceof File ? file : (file as { data: Uint8Array | Blob }).data;
    const data =
      source instanceof Uint8Array ? source.slice() : new Uint8Array(await (source as Blob).arrayBuffer());
    const type =
      (file as { type?: string }).type || (typeof Blob !== "undefined" && source instanceof Blob ? source.type : "") ||
      "application/octet-stream";
    total += data.byteLength;
    if (total > MAX_SHARE_BYTES) {
      throw new Error("The files are larger than 200 MB together.");
    }
    payloads.push({ name, type, data });
  }
  return payloads;
}

/** `session.files`. Older Haven versions answer `unsupported`. */
export class MindooDBAppFilesApiImpl implements MindooDBAppFilesApi {
  constructor(private readonly rpc: PortRpcClient) {}

  async share(files: MindooDBAppShareFile[], options?: MindooDBAppFilesShareOptions): Promise<MindooDBAppFilesShareResult> {
    let payloads: MindooDBAppShareFilePayload[];
    try {
      payloads = await toShareFilePayloads(files);
    } catch (error) {
      return { ok: false, reason: "invalid", message: error instanceof Error ? error.message : String(error) };
    }
    try {
      return await this.rpc.call<MindooDBAppFilesShareResult>("files.share", {
        files: payloads,
        title: options?.title,
      });
    } catch (error) {
      if (isUnknownMethod(error)) {
        return { ok: false, reason: "unsupported" };
      }
      throw error;
    }
  }
}
