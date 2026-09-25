import type {
  MindooDBAppCreateDocumentInput,
  MindooDBAppDatabase,
  MindooDBAppDocument,
} from "./types";

/**
 * Copy the parent's named key onto a chunk create when the caller did not
 * choose a key. Person-bound documents pass `recipients` explicitly.
 */
export function inheritDocumentEncryption(
  parent: Pick<MindooDBAppDocument, "decryptionKeyId">,
  input: MindooDBAppCreateDocumentInput,
): MindooDBAppCreateDocumentInput {
  if (input.decryptionKeyId || input.recipients) return input;
  if (!parent.decryptionKeyId) return input;
  return { ...input, decryptionKeyId: parent.decryptionKeyId };
}

/**
 * Watch every Word chunk that belongs to `parentId`.
 * The listener receives the chunk ids currently visible, including chunks
 * another person inserted.
 */
export async function watchWordChunks(
  database: MindooDBAppDatabase,
  parentId: string,
  listener: (docIds: string[]) => void,
): Promise<() => Promise<void>> {
  const subscription = await database.documents.liveQuery(
    {
      filter: `v.and(v.eq(v.field("type"), "wordChunk"), v.eq(v.field("parentId"), ${JSON.stringify(parentId)}))`,
    },
    (result) => {
      listener(result.rows.map((row) => row.docId));
    },
  );
  return () => subscription.dispose();
}
