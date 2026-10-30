import { localFileNameProblem, localFilesError } from "../localFiles";
import type {
  MindooDBAppLocalFileCreateOptions,
  MindooDBAppLocalFileInfo,
  MindooDBAppLocalFileReader,
  MindooDBAppLocalFilesApi,
  MindooDBAppLocalFilesEstimate,
  MindooDBAppLocalFilesState,
  MindooDBAppLocalFileWriter,
} from "../types";
import type { PortRpcClient } from "./portRpcClient";

const CODES = new Set(["not-allowed", "locked", "unsupported", "not-found", "no-space", "invalid", "closed"]);

/** Bridge errors carry their code as `name` (see `toBridgeError`); some as `code`. */
function codeOf(error: unknown): string | undefined {
  const value = error as { code?: unknown; name?: unknown } | null;
  return typeof value?.code === "string" ? value.code : typeof value?.name === "string" ? value.name : undefined;
}

/** Bytes of `data` as a Uint8Array view (no copy; the RPC layer copies). */
function view(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  return ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
}

function checkName(name: string) {
  const problem = localFileNameProblem(name);
  if (problem) throw localFilesError("invalid", `${JSON.stringify(name)}: ${problem}`);
}

/**
 * `session.localFiles` over the bridge. Writers and readers are handles in Haven;
 * every call is one RPC, `readMany` bundles ranges into one.
 */
export class MindooDBAppLocalFilesApiImpl implements MindooDBAppLocalFilesApi {
  constructor(private readonly rpc: PortRpcClient) {}

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    try {
      return await this.rpc.call<T>(method, params);
    } catch (error) {
      const code = codeOf(error);
      if (code === "method-not-found") throw localFilesError("unsupported", "This Haven does not keep files for apps.");
      if (code && CODES.has(code)) throw localFilesError(code as never, (error as Error).message);
      throw error;
    }
  }

  async state(): Promise<MindooDBAppLocalFilesState> {
    try {
      return await this.call<MindooDBAppLocalFilesState>("localFiles.state", {});
    } catch (error) {
      if ((error as { code?: unknown }).code === "unsupported") return "unsupported";
      throw error;
    }
  }

  estimate(): Promise<MindooDBAppLocalFilesEstimate> {
    return this.call("localFiles.estimate", {});
  }

  async create(name: string, options: MindooDBAppLocalFileCreateOptions): Promise<MindooDBAppLocalFileWriter> {
    checkName(name);
    if (!Number.isSafeInteger(options?.size) || options.size < 0) throw localFilesError("invalid", "size must be a non-negative integer");
    const { handle } = await this.call<{ handle: string }>("localFiles.create", { name, size: options.size, backup: options.backup === true });
    let done = false;
    const guard = () => {
      if (done) throw localFilesError("closed", `${name} is already closed`);
    };
    return {
      name,
      size: options.size,
      write: async (data, at) => {
        guard();
        const bytes = view(data);
        if (!Number.isSafeInteger(at) || at < 0 || at + bytes.byteLength > options.size) {
          throw localFilesError("invalid", `write of ${bytes.byteLength} bytes at ${at} is outside ${options.size} bytes`);
        }
        await this.call("localFiles.write", { handle, at, data: bytes });
      },
      close: async () => {
        guard();
        done = true;
        return await this.call<MindooDBAppLocalFileInfo>("localFiles.close", { handle });
      },
      abort: async () => {
        if (done) return;
        done = true;
        await this.call("localFiles.abort", { handle });
      },
    };
  }

  async open(name: string): Promise<MindooDBAppLocalFileReader> {
    checkName(name);
    const { handle, size } = await this.call<{ handle: string; size: number }>("localFiles.open", { name });
    let closed = false;
    const readMany = async (ranges: ReadonlyArray<readonly [number, number]>) => {
      if (closed) throw localFilesError("closed", `${name} is closed`);
      return await this.call<Uint8Array[]>("localFiles.read", { handle, ranges: ranges.map(([offset, length]) => [offset, length]) });
    };
    return {
      name,
      size,
      read: async (offset, length) => (await readMany([[offset, length]]))[0]!,
      readMany,
      close: async () => {
        if (closed) return;
        closed = true;
        await this.call("localFiles.release", { handle });
      },
    };
  }

  stat(name: string): Promise<MindooDBAppLocalFileInfo | null> {
    checkName(name);
    return this.call("localFiles.stat", { name });
  }

  list(prefix?: string): Promise<MindooDBAppLocalFileInfo[]> {
    return this.call("localFiles.list", { prefix: prefix ?? "" });
  }

  async remove(name: string): Promise<void> {
    checkName(name);
    await this.call("localFiles.remove", { name });
  }
}
