/**
 * In-memory `session.localFiles` for tests and the browser test host: same name rules,
 * states and errors as Haven, without encryption. `setState` and `setAvailable` let a
 * test walk the fallbacks (not allowed, locked, full device).
 */
import { localFileNameProblem, localFilesError } from "../localFiles";
import type {
  MindooDBAppLocalFileInfo,
  MindooDBAppLocalFileReader,
  MindooDBAppLocalFilesApi,
  MindooDBAppLocalFilesState,
} from "../types";

interface StoredFile {
  data: Uint8Array;
  info: MindooDBAppLocalFileInfo;
}

export interface MockLocalFiles {
  api: MindooDBAppLocalFilesApi;
  /** What `state()` answers; anything but `available` makes every other call fail with it. */
  setState(state: MindooDBAppLocalFilesState): void;
  /** Free bytes reported by `estimate()` and checked by `create()`; null: unknown (no check). */
  setAvailable(bytes: number | null): void;
  /** Stored files, sorted by name. */
  list(): MindooDBAppLocalFileInfo[];
}

export function createMockLocalFiles(options: { state?: MindooDBAppLocalFilesState; available?: number | null } = {}): MockLocalFiles {
  const files = new Map<string, StoredFile>();
  let state: MindooDBAppLocalFilesState = options.state ?? "available";
  let available: number | null = options.available === undefined ? 10 * 1024 ** 3 : options.available;

  const ready = () => {
    if (state !== "available") throw localFilesError(state);
  };
  const checkName = (name: string) => {
    const problem = localFileNameProblem(name);
    if (problem) throw localFilesError("invalid", `${JSON.stringify(name)}: ${problem}`);
  };
  const used = () => [...files.values()].reduce((sum, file) => sum + file.data.byteLength, 0);
  const sorted = () => [...files.values()].map((file) => ({ ...file.info })).sort((a, b) => a.name.localeCompare(b.name));

  const api: MindooDBAppLocalFilesApi = {
    async state() {
      return state;
    },
    async estimate() {
      ready();
      return { used: used(), available };
    },
    async create(name, createOptions) {
      ready();
      checkName(name);
      const size = createOptions?.size;
      if (!Number.isSafeInteger(size) || size < 0) throw localFilesError("invalid", "size must be a non-negative integer");
      if (available !== null && size > available) throw localFilesError("no-space", `${size} bytes do not fit, ${available} free`);
      const data = new Uint8Array(size);
      let done = false;
      const guard = () => {
        if (done) throw localFilesError("closed", `${name} is already closed`);
      };
      return {
        name,
        size,
        async write(chunk, at) {
          guard();
          const bytes = ArrayBuffer.isView(chunk) ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength) : new Uint8Array(chunk);
          if (!Number.isSafeInteger(at) || at < 0 || at + bytes.byteLength > size) throw localFilesError("invalid", "write outside the file");
          data.set(bytes, at);
        },
        async close() {
          guard();
          done = true;
          const info: MindooDBAppLocalFileInfo = { name, size, modifiedAt: Date.now(), backup: createOptions.backup === true };
          files.set(name, { data, info });
          return { ...info };
        },
        async abort() {
          done = true;
        },
      };
    },
    async open(name): Promise<MindooDBAppLocalFileReader> {
      ready();
      checkName(name);
      const file = files.get(name);
      if (!file) throw localFilesError("not-found", name);
      let closed = false;
      const readMany = async (ranges: ReadonlyArray<readonly [number, number]>) => {
        if (closed) throw localFilesError("closed", `${name} is closed`);
        return ranges.map(([offset, length]) => {
          if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) throw localFilesError("invalid", "bad range");
          return file.data.slice(offset, offset + length);
        });
      };
      return {
        name,
        size: file.data.byteLength,
        read: async (offset, length) => (await readMany([[offset, length]]))[0]!,
        readMany,
        async close() {
          closed = true;
        },
      };
    },
    async stat(name) {
      ready();
      checkName(name);
      const file = files.get(name);
      return file ? { ...file.info } : null;
    },
    async list(prefix) {
      ready();
      return sorted().filter((info) => !prefix || info.name.startsWith(prefix));
    },
    async remove(name) {
      ready();
      checkName(name);
      files.delete(name);
    },
  };

  return {
    api,
    setState(next) {
      state = next;
    },
    setAvailable(bytes) {
      available = bytes;
    },
    list: sorted,
  };
}
