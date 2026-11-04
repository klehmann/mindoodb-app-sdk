/**
 * Attachment pins for mock databases, shaped like Haven's: with
 * `info.attachmentStorage: "onDemand"` every attachment starts as `"remote"`,
 * `pin()` answers `"queued"` and then reports a short download (`downloading`
 * at half the size, then `local`) through `onAvailabilityChange`, and `unpin()`
 * turns the file back into `"remote"`. With `"local"` (or no value) everything
 * is local, and with `"remote"` `pin()` rejects with `unsupported`.
 */
import type {
  MindooDBAppAttachmentApi,
  MindooDBAppAttachmentAvailability,
  MindooDBAppAttachmentInfo,
  MindooDBAppAttachmentPin,
  MindooDBAppAttachmentStorage,
} from "../types";

type PinMethods = Pick<
  MindooDBAppAttachmentApi,
  "pin" | "unpin" | "availability" | "listPins" | "onAvailabilityChange"
>;

function pinKey(docId: string, attachmentId?: string) {
  return `${docId}\u0000${attachmentId ?? ""}`;
}

export function createMockAttachmentPins(options: {
  storage: () => MindooDBAppAttachmentStorage | undefined;
  list: (docId: string) => Promise<MindooDBAppAttachmentInfo[]>;
}): PinMethods {
  const pins = new Map<string, MindooDBAppAttachmentPin>();
  /** Files that reached the device through a pin. */
  const downloaded = new Set<string>();
  const listeners = new Set<(availability: MindooDBAppAttachmentAvailability) => void>();

  const onDemand = () => options.storage() === "onDemand";
  const isPinned = (docId: string, attachmentId: string) =>
    pins.has(pinKey(docId, attachmentId)) || pins.has(pinKey(docId));

  const resolve = async (docId: string, attachmentName?: string) => {
    const files = await options.list(docId);
    if (attachmentName === undefined) return files;
    const file = files.find((entry) => entry.attachmentId === attachmentName || entry.fileName === attachmentName);
    if (!file) {
      const error = new Error(`Attachment "${attachmentName}" was not found in document "${docId}".`);
      error.name = "not-found";
      throw error;
    }
    return [file];
  };

  const describe = (docId: string, file: MindooDBAppAttachmentInfo): MindooDBAppAttachmentAvailability => {
    const local = !onDemand() || downloaded.has(pinKey(docId, file.attachmentId));
    return {
      docId,
      attachmentId: file.attachmentId,
      state: local ? "local" : "remote",
      bytesLocal: local ? file.size : 0,
      size: file.size,
      pinned: isPinned(docId, file.attachmentId),
    };
  };

  const emit = (availability: MindooDBAppAttachmentAvailability) => {
    for (const listener of listeners) listener(availability);
  };

  return {
    async pin(docId, attachmentName) {
      if (options.storage() === "remote") {
        const error = new Error("Attachments of a server database cannot be kept on the device.");
        error.name = "unsupported";
        throw error;
      }
      const files = await resolve(docId, attachmentName);
      const attachmentId = attachmentName === undefined ? undefined : files[0]!.attachmentId;
      pins.set(pinKey(docId, attachmentId), {
        docId,
        ...(attachmentId ? { attachmentId } : {}),
        pinnedAt: new Date().toISOString(),
      });
      const bytes = files.reduce((total, file) => total + file.size, 0);
      const missing = files.filter((file) => describe(docId, file).state !== "local");
      if (missing.length === 0) {
        return { state: "local" as const, bytes };
      }
      for (const file of missing) {
        emit({ ...describe(docId, file), state: "queued" });
      }
      // Like Haven, the download runs after pin() has answered.
      void Promise.resolve().then(() => {
        for (const file of missing) {
          if (!isPinned(docId, file.attachmentId)) continue;
          emit({ ...describe(docId, file), state: "downloading", bytesLocal: Math.floor(file.size / 2) });
          downloaded.add(pinKey(docId, file.attachmentId));
          emit(describe(docId, file));
        }
      });
      return { state: "queued" as const, bytes };
    },
    async unpin(docId, attachmentName) {
      let files: MindooDBAppAttachmentInfo[];
      try {
        files = await resolve(docId, attachmentName);
      } catch {
        return { ok: true as const };
      }
      const attachmentId = attachmentName === undefined ? undefined : files[0]!.attachmentId;
      if (!pins.delete(pinKey(docId, attachmentId))) {
        return { ok: true as const };
      }
      for (const file of files) {
        if (isPinned(docId, file.attachmentId)) continue;
        // The mock server holds every file, so the local copy can always go.
        downloaded.delete(pinKey(docId, file.attachmentId));
        emit(describe(docId, file));
      }
      return { ok: true as const };
    },
    async availability(refs) {
      const rows: MindooDBAppAttachmentAvailability[] = [];
      for (const ref of refs) {
        for (const file of await resolve(ref.docId, ref.attachmentName)) {
          rows.push(describe(ref.docId, file));
        }
      }
      return rows;
    },
    async listPins() {
      return [...pins.values()].map((pin) => ({ ...pin }));
    },
    async onAvailabilityChange(listener) {
      listeners.add(listener);
      return {
        async dispose() {
          listeners.delete(listener);
        },
      };
    },
  };
}
