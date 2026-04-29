import type {
  MindooDBAppDatabase,
  MindooDBAppDocument,
  MindooDBAppTextEdit,
} from "./types";

/**
 * Options used to create a text buffer for one string field in a MindooDB
 * document.
 *
 * The buffer keeps a local editable string and records text operations that can
 * later be flushed over the JSON bridge. `path` points to the string inside
 * `document.data`, for example `["body"]` for a markdown body field.
 */
export interface CreateMindooDBTextBufferOptions {
  /** Open database handle used when `flush()` sends the buffered text patch. */
  database: MindooDBAppDatabase;
  /** Document snapshot the local editor state is based on. */
  document: MindooDBAppDocument;
  /** Path to the string field inside `document.data`. */
  path: Array<string | number>;
}

/**
 * Result returned after flushing pending text edits.
 */
export interface MindooDBTextBufferFlushResult {
  /** Updated document returned by Haven after applying and reconciling edits. */
  document: MindooDBAppDocument;
  /** Canonical text value at the configured path after the flush. */
  value: string;
  /**
   * `true` when the canonical value returned by Haven differs from the local
   * value that was flushed. This usually means concurrent edits from another
   * app instance or sync source were merged during save and the editor should
   * replace its visible content with `value`.
   */
  reconciled: boolean;
}

/**
 * Local text editing buffer for SDK apps.
 *
 * `MindooDBTextBuffer` is intentionally not an Automerge document. It is a
 * small app-side helper that behaves like a mutable string, keeps track of
 * local text edits, and flushes those edits as JSON-safe operations to Haven.
 * Haven then applies the operations against the real Automerge document using
 * the document heads captured when this buffer was created or last reconciled.
 *
 * Use `splice()` when your editor can report exact text operations. Use
 * `replaceText()` for WYSIWYG or markdown editors that expose only the full
 * current text value; the buffer computes a minimal single-splice diff.
 */
export class MindooDBTextBuffer {
  private valueInternal: string;
  private heads: string[];
  private pendingEdits: MindooDBAppTextEdit[] = [];

  constructor(private readonly options: CreateMindooDBTextBufferOptions) {
    this.valueInternal = readTextAtPath(options.document.data, options.path);
    this.heads = options.document.heads ? [...options.document.heads] : [];
  }

  get value() {
    return this.valueInternal;
  }

  /** Whether there are local edits that have not been flushed yet. */
  get dirty() {
    return this.pendingEdits.length > 0;
  }

  /** Number of pending text operations currently buffered. */
  get pendingCount() {
    return this.pendingEdits.length;
  }

  /** Return the current local text value. */
  toString() {
    return this.valueInternal;
  }

  /**
   * Apply an exact local text splice and queue it for the next flush.
   *
   * Offsets use JavaScript string indexing. The delete count is clamped to the
   * remaining local text length so callers can safely delete to the end.
   */
  splice(index: number, deleteCount: number, insert = "") {
    if (!Number.isInteger(index) || index < 0 || index > this.valueInternal.length) {
      throw new RangeError("Text splice index is out of range");
    }
    if (!Number.isInteger(deleteCount) || deleteCount < 0) {
      throw new RangeError("Text splice deleteCount must be a non-negative integer");
    }
    const clampedDeleteCount = Math.min(deleteCount, this.valueInternal.length - index);
    this.valueInternal = this.valueInternal.slice(0, index) + insert + this.valueInternal.slice(index + clampedDeleteCount);
    this.pendingEdits.push({ index, deleteCount: clampedDeleteCount, insert });
  }

  /**
   * Replace the current local text value and queue the change as one splice.
   *
   * This is useful for editors such as Milkdown that can produce the full
   * markdown string after each transaction but do not expose raw text splices.
   */
  replaceText(nextValue: string) {
    if (nextValue === this.valueInternal) {
      return;
    }
    const edit = computeSingleSplice(this.valueInternal, nextValue);
    this.splice(edit.index, edit.deleteCount, edit.insert ?? "");
  }

  /**
   * Replace local state from a fresh document snapshot and clear pending edits.
   *
   * Returns whether the text value changed. Use this after an external refresh
   * or after receiving a document update through another app-level mechanism.
   */
  reconcile(document: MindooDBAppDocument) {
    const nextValue = readTextAtPath(document.data, this.options.path);
    const changed = nextValue !== this.valueInternal;
    this.valueInternal = nextValue;
    this.heads = document.heads ? [...document.heads] : [];
    this.pendingEdits = [];
    return changed;
  }

  /**
   * Flush pending edits to Haven using `documents.update({ text: ... })`.
   *
   * The request includes the document heads this buffer is based on, allowing
   * Haven to apply the text operations at the original causal version and merge
   * them with any concurrent document changes. After a successful flush the
   * buffer adopts the returned canonical value and heads, and clears the
   * pending edit queue.
   */
  async flush(): Promise<MindooDBTextBufferFlushResult> {
    if (this.pendingEdits.length === 0) {
      return {
        document: this.options.document,
        value: this.valueInternal,
        reconciled: false,
      };
    }
    const localValueAtFlush = this.valueInternal;
    const document = await this.options.database.documents.update(this.options.document.id, {
      text: [{
        path: this.options.path,
        baseHeads: this.heads,
        edits: this.pendingEdits.map((edit) => ({ ...edit })),
      }],
    });
    const nextValue = readTextAtPath(document.data, this.options.path);
    const reconciled = nextValue !== localValueAtFlush;
    this.valueInternal = nextValue;
    this.heads = document.heads ? [...document.heads] : [];
    this.pendingEdits = [];
    return {
      document,
      value: this.valueInternal,
      reconciled,
    };
  }
}

/** Create a local text buffer for one string field in a document. */
export function createMindooDBTextBuffer(options: CreateMindooDBTextBufferOptions) {
  return new MindooDBTextBuffer(options);
}

/** Read a string from a nested document path, treating missing/non-string values as empty text. */
function readTextAtPath(data: Record<string, unknown>, path: Array<string | number>) {
  let value: unknown = data;
  for (const segment of path) {
    if (value == null || typeof value !== "object") {
      return "";
    }
    value = (value as Record<string | number, unknown>)[segment];
  }
  return typeof value === "string" ? value : "";
}

/**
 * Compute the smallest single splice that transforms `previous` into `next`.
 *
 * This is a lightweight diff for full-value editor integrations. It preserves
 * the common prefix and suffix and replaces only the changed middle segment.
 */
function computeSingleSplice(previous: string, next: string): MindooDBAppTextEdit {
  let prefixLength = 0;
  const maxPrefix = Math.min(previous.length, next.length);
  while (prefixLength < maxPrefix && previous[prefixLength] === next[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const previousRemaining = previous.length - prefixLength;
  const nextRemaining = next.length - prefixLength;
  const maxSuffix = Math.min(previousRemaining, nextRemaining);
  while (
    suffixLength < maxSuffix
    && previous[previous.length - 1 - suffixLength] === next[next.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    index: prefixLength,
    deleteCount: previous.length - prefixLength - suffixLength,
    insert: next.slice(prefixLength, next.length - suffixLength),
  };
}
