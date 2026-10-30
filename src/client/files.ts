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

/** A copy of the bytes of a typed array, ArrayBuffer or Blob/File. */
async function bytesOf(source: unknown): Promise<Uint8Array> {
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
  }
  if (Object.prototype.toString.call(source) === "[object ArrayBuffer]") {
    return new Uint8Array(source as ArrayBuffer).slice();
  }
  const blob = source as Blob;
  if (typeof blob?.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof FileReader !== "undefined" && typeof blob?.size === "number") {
    // Blobs without arrayBuffer() (jsdom).
    return await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }
  throw new Error("Every file needs its bytes: a File, a Blob or a Uint8Array.");
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
    // No instanceof: files and bytes may come from another realm (a frame, a
    // MessagePort in jsdom), where they are not this realm's File or Uint8Array.
    const data = await bytesOf((file as { data?: unknown }).data ?? file);
    const source = (file as { data?: unknown }).data ?? file;
    const sourceType = (source as { type?: unknown }).type;
    const type =
      (file as { type?: string }).type || (typeof sourceType === "string" ? sourceType : "") || "application/octet-stream";
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
