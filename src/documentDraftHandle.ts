import type {
  MindooDBAppDatabase,
  MindooDBAppDocument,
  MindooDBAppDocumentDraftOpenInput,
  MindooDBAppRichTextSnapshot,
  MindooDBAppRichTextSpan,
} from "./types";

export interface CreateMindooDBDocumentDraftHandleOptions {
  database: MindooDBAppDatabase;
  document: MindooDBAppDocument;
  path: Array<string | number>;
  pollIntervalMs?: number;
}

export interface MindooDBDocumentDraftHandleCommitInput {
  spans: MindooDBAppRichTextSpan[];
  updateSpansConfig?: Record<string, unknown>;
}

export interface MindooDBDocumentDraftHandleCommitResult {
  document: MindooDBAppDocument;
  snapshot: MindooDBAppRichTextSnapshot;
  reconciled: boolean;
}

export type MindooDBDocumentDraftHandleChangeListener = (
  snapshot: MindooDBAppRichTextSnapshot,
) => void;

/**
 * Server-side document draft handle for commit-only rich-text editing.
 *
 * Haven stores the Automerge baseline at {@link open}; the app edits locally
 * and sends spans once on {@link commit}.
 */
export class MindooDBDocumentDraftHandle {
  private draftIdInternal: string | null = null;
  private spansInternal: MindooDBAppRichTextSpan[] = [];
  private heads: string[] = [];
  private dirtyInternal = false;
  private listeners = new Set<MindooDBDocumentDraftHandleChangeListener>();

  constructor(private readonly options: CreateMindooDBDocumentDraftHandleOptions) {}

  get draftId() {
    return this.draftIdInternal;
  }

  get spans() {
    return structuredClone(this.spansInternal);
  }

  get dirty() {
    return this.dirtyInternal;
  }

  get baseHeads() {
    return [...this.heads];
  }

  on(event: "change", listener: MindooDBDocumentDraftHandleChangeListener) {
    if (event === "change") {
      this.listeners.add(listener);
    }
  }

  off(event: "change", listener: MindooDBDocumentDraftHandleChangeListener) {
    if (event === "change") {
      this.listeners.delete(listener);
    }
  }

  replaceSpans(spans: MindooDBAppRichTextSpan[]) {
    this.spansInternal = structuredClone(spans);
    this.dirtyInternal = true;
    this.emitChange();
  }

  async open(input?: MindooDBAppDocumentDraftOpenInput) {
    const paths = input?.paths ?? [this.options.path];
    const opened = await this.options.database.documents.openDocumentDraft(
      this.options.document.id,
      { paths },
    );
    this.draftIdInternal = opened.draftId;
    this.options.document = opened.document;
    const field = opened.richText.find((entry) => pathsEqual(entry.path, this.options.path))
      ?? opened.richText[0];
    if (field) {
      this.spansInternal = structuredClone(field.spans);
      this.heads = field.heads ?? opened.document.heads ?? [];
    }
    this.dirtyInternal = false;
    this.emitChange();
    return opened;
  }

  async commit(
    input?: MindooDBDocumentDraftHandleCommitInput,
  ): Promise<MindooDBDocumentDraftHandleCommitResult> {
    if (!this.draftIdInternal) {
      throw new Error("Document draft is not open.");
    }
    const spans = structuredClone(input?.spans ?? this.spansInternal);
    if (input?.spans) {
      this.spansInternal = spans;
    }
    if (!this.dirtyInternal && !input?.spans) {
      const snapshot: MindooDBAppRichTextSnapshot = {
        path: [...this.options.path],
        heads: [...this.heads],
        spans: structuredClone(this.spansInternal),
      };
      return {
        document: this.options.document,
        snapshot,
        reconciled: false,
      };
    }

    const localSpansAtCommit = structuredClone(spans);
    const result = await this.options.database.documents.commitDocumentDraft({
      draftId: this.draftIdInternal,
      richText: [{
        path: this.options.path,
        spans,
        updateSpansConfig: input?.updateSpansConfig,
      }],
    });
    this.draftIdInternal = null;
    this.options.document = result.document;
    const snapshot = result.richText.find((entry) => pathsEqual(entry.path, this.options.path))
      ?? {
        path: [...this.options.path],
        heads: result.document.heads ?? [],
        spans: localSpansAtCommit,
      };
    this.spansInternal = structuredClone(snapshot.spans);
    this.heads = snapshot.heads ?? result.document.heads ?? [];
    this.dirtyInternal = false;
    if (result.reconciled) {
      this.emitChange();
    }
    return {
      document: result.document,
      snapshot,
      reconciled: result.reconciled,
    };
  }

  async discard() {
    if (!this.draftIdInternal) {
      return;
    }
    await this.options.database.documents.discardDocumentDraft({
      draftId: this.draftIdInternal,
    });
    this.draftIdInternal = null;
  }

  reconcile(document: MindooDBAppDocument, snapshot: MindooDBAppRichTextSnapshot) {
    const previous = JSON.stringify(this.spansInternal);
    this.spansInternal = structuredClone(snapshot.spans);
    this.heads = snapshot.heads ?? document.heads ?? [];
    this.dirtyInternal = false;
    this.options.document = document;
    const changed = JSON.stringify(this.spansInternal) !== previous;
    if (changed) {
      this.emitChange();
    }
    return changed;
  }

  private emitChange() {
    const snapshot: MindooDBAppRichTextSnapshot = {
      path: [...this.options.path],
      heads: [...this.heads],
      spans: structuredClone(this.spansInternal),
    };
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export function createMindooDBDocumentDraftHandle(
  options: CreateMindooDBDocumentDraftHandleOptions,
) {
  return new MindooDBDocumentDraftHandle(options);
}

function pathsEqual(
  left: Array<string | number>,
  right: Array<string | number>,
) {
  return left.length === right.length
    && left.every((segment, index) => segment === right[index]);
}
