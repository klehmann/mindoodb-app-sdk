/**
 * In-memory attachments for mock databases: what an app writes can be listed and read
 * back, like in Haven. The default mock attachment API stores nothing; the browser test
 * host (`mockDatabasesFromDefinition`) uses this store instead.
 */
import type { MindooDBAppAttachmentApi, MindooDBAppAttachmentInfo } from "../types";

interface StoredAttachment {
  bytes: Uint8Array;
  mimeType: string;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Marks a store made by `createMemoryAttachments` (the two-user mode gives each user one). */
export const MEMORY_ATTACHMENTS = Symbol.for("mindoodb-app-sdk.memoryAttachments");

export function isMemoryAttachments(value: unknown): boolean {
  return !!value && typeof value === "object" && MEMORY_ATTACHMENTS in value;
}

export function createMemoryAttachments(): Partial<MindooDBAppAttachmentApi> {
  const files = new Map<string, Map<string, StoredAttachment>>();
  const forDoc = (docId: string) => {
    let map = files.get(docId);
    if (!map) files.set(docId, (map = new Map()));
    return map;
  };
  const api: Partial<MindooDBAppAttachmentApi> = {
    async list(docId) {
      return [...forDoc(docId)].map(
        ([fileName, file]): MindooDBAppAttachmentInfo => ({
          attachmentId: `${docId}/${fileName}`,
          fileName,
          mimeType: file.mimeType,
          size: file.bytes.length,
        }),
      );
    },
    async remove(docId, attachmentName) {
      forDoc(docId).delete(attachmentName);
      return { ok: true as const };
    },
    async openReadStream(docId, attachmentName) {
      const file = forDoc(docId).get(attachmentName);
      if (!file) throw new Error(`Attachment not found: ${attachmentName}`);
      let done = false;
      return {
        async read() {
          if (done) return null;
          done = true;
          return file.bytes.slice();
        },
        async close() {},
      };
    },
    async openWriteStream(docId, attachmentName, contentType) {
      const chunks: Uint8Array[] = [];
      return {
        async write(chunk) {
          chunks.push(new Uint8Array(chunk));
        },
        async close() {
          forDoc(docId).set(attachmentName, {
            bytes: concat(chunks),
            mimeType: contentType ?? "application/octet-stream",
          });
        },
        async abort() {
          chunks.length = 0;
        },
      };
    },
  };
  return Object.assign(api, { [MEMORY_ATTACHMENTS]: true });
}
