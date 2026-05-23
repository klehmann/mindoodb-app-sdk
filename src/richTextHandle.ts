import type {
  MindooDBAppDatabase,
  MindooDBAppDocument,
  MindooDBAppRichTextSnapshot,
  MindooDBAppRichTextSpan,
} from "./types";

export interface CreateMindooDBRichTextHandleOptions {
  database: MindooDBAppDatabase;
  document: MindooDBAppDocument;
  path: Array<string | number>;
  spans?: MindooDBAppRichTextSpan[];
  pollIntervalMs?: number;
}

export interface MindooDBRichTextHandleFlushResult {
  document: MindooDBAppDocument;
  snapshot: MindooDBAppRichTextSnapshot;
  reconciled: boolean;
}

export type MindooDBRichTextHandleChangeListener = (
  snapshot: MindooDBAppRichTextSnapshot,
) => void;

/**
 * Local rich-text span buffer for SDK apps.
 *
 * The helper deliberately mirrors the causal shape of `MindooDBTextBuffer`:
 * local editor code replaces the current span snapshot, then `flush()` sends a
 * separate `richText` patch with the document heads the snapshot was based on.
 */
export class MindooDBRichTextHandle {
  private spansInternal: MindooDBAppRichTextSpan[];
  private heads: string[];
  private dirtyInternal = false;
  private listeners = new Set<MindooDBRichTextHandleChangeListener>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: CreateMindooDBRichTextHandleOptions) {
    this.spansInternal = cloneSpans(options.spans ?? []);
    this.heads = options.document.heads ? [...options.document.heads] : [];
  }

  get spans() {
    return cloneSpans(this.spansInternal);
  }

  get dirty() {
    return this.dirtyInternal;
  }

  get baseHeads() {
    return [...this.heads];
  }

  on(event: "change", listener: MindooDBRichTextHandleChangeListener) {
    this.listeners.add(listener);
  }

  off(event: "change", listener: MindooDBRichTextHandleChangeListener) {
    this.listeners.delete(listener);
  }

  replaceSpans(spans: MindooDBAppRichTextSpan[]) {
    this.spansInternal = cloneSpans(spans);
    this.dirtyInternal = true;
    this.emitChange();
  }

  startPolling(intervalMs = this.options.pollIntervalMs ?? 2000) {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  reconcile(document: MindooDBAppDocument, snapshot: MindooDBAppRichTextSnapshot) {
    const previous = JSON.stringify(this.spansInternal);
    this.spansInternal = cloneSpans(snapshot.spans);
    this.heads = snapshot.heads ?? document.heads ?? [];
    this.dirtyInternal = false;
    const changed = JSON.stringify(this.spansInternal) !== previous;
    if (changed) {
      this.emitChange();
    }
    return changed;
  }

  async refresh() {
    const snapshot = await this.options.database.documents.getRichText(
      this.options.document.id,
      this.options.path,
    );
    return snapshot;
  }

  async pollOnce() {
    if (this.dirtyInternal) {
      return false;
    }
    const document = await this.options.database.documents.get(
      this.options.document.id,
    );
    if (!document) {
      return false;
    }
    const snapshot = await this.refresh();
    return this.reconcile(document, snapshot);
  }

  async flush(
    updateSpansConfig?: Record<string, unknown>,
  ): Promise<MindooDBRichTextHandleFlushResult> {
    if (!this.dirtyInternal) {
      return {
        document: this.options.document,
        snapshot: {
          path: [...this.options.path],
          heads: [...this.heads],
          spans: cloneSpans(this.spansInternal),
        },
        reconciled: false,
      };
    }

    const localSpansAtFlush = JSON.stringify(this.spansInternal);
    const document = await this.options.database.documents.update(
      this.options.document.id,
      {
        richText: [{
          path: this.options.path,
          baseHeads: this.heads,
          spans: cloneSpans(this.spansInternal),
          updateSpansConfig,
        }],
      },
    );
    const snapshot = await this.options.database.documents.getRichText(
      this.options.document.id,
      this.options.path,
    );
    const reconciled = JSON.stringify(snapshot.spans) !== localSpansAtFlush;
    this.spansInternal = cloneSpans(snapshot.spans);
    this.heads = snapshot.heads ?? document.heads ?? [];
    this.dirtyInternal = false;
    if (reconciled) {
      this.emitChange();
    }
    return {
      document,
      snapshot,
      reconciled,
    };
  }

  private emitChange() {
    const snapshot: MindooDBAppRichTextSnapshot = {
      path: [...this.options.path],
      heads: [...this.heads],
      spans: cloneSpans(this.spansInternal),
    };
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export function createMindooDBRichTextHandle(
  options: CreateMindooDBRichTextHandleOptions,
) {
  return new MindooDBRichTextHandle(options);
}

function cloneSpans(spans: MindooDBAppRichTextSpan[]) {
  return structuredClone(spans);
}
