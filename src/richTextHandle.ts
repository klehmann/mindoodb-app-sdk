import type {
  MindooDBAppDatabase,
  MindooDBAppDocument,
  MindooDBAppRichTextSnapshot,
  MindooDBAppRichTextSpan,
  MindooDBAppTextEdit,
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
 * Mirrors `MindooDBTextBuffer`: track edits against a base snapshot, then flush
 * with causal `baseHeads`. Text edits prefer positional `richTextSteps` so
 * concurrent saves merge like plain-text splices; formatting-only or structural
 * changes fall back to full `richText` span snapshots.
 */
export class MindooDBRichTextHandle {
  private spansInternal: MindooDBAppRichTextSpan[];
  private baseMaterializedText: string;
  private heads: string[];
  private dirtyInternal = false;
  private listeners = new Set<MindooDBRichTextHandleChangeListener>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: CreateMindooDBRichTextHandleOptions) {
    const initialSpans = cloneSpans(options.spans ?? []);
    this.spansInternal = initialSpans;
    this.baseMaterializedText = readMaterializedRichTextText(
      options.document.data,
      options.path,
      initialSpans,
    );
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
    this.baseMaterializedText = spansToPlainText(snapshot.spans);
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

    const localSpansAtFlush = cloneSpans(this.spansInternal);
    const localTextAtFlush = spansToPlainText(localSpansAtFlush);
    const textChanged = localTextAtFlush !== this.baseMaterializedText;

    const document = textChanged
      ? await this.flushTextSteps(localTextAtFlush)
      : await this.options.database.documents.update(
        this.options.document.id,
        {
          richText: [{
            path: this.options.path,
            baseHeads: this.heads,
            spans: localSpansAtFlush,
            updateSpansConfig,
          }],
        },
      );

    const snapshot = await this.options.database.documents.getRichText(
      this.options.document.id,
      this.options.path,
    );
    const reconciled = JSON.stringify(snapshot.spans) !== JSON.stringify(localSpansAtFlush);
    this.spansInternal = cloneSpans(snapshot.spans);
    this.baseMaterializedText = spansToPlainText(snapshot.spans);
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

  private async flushTextSteps(localTextAtFlush: string) {
    const edit = computeSingleSplice(this.baseMaterializedText, localTextAtFlush);
    return this.options.database.documents.update(this.options.document.id, {
      richTextSteps: [{
        path: this.options.path,
        baseHeads: this.heads,
        steps: [{
          type: "splice",
          index: edit.index,
          deleteCount: edit.deleteCount,
          insert: edit.insert ?? "",
        }],
      }],
    });
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

function spansToPlainText(spans: MindooDBAppRichTextSpan[]) {
  return spans
    .filter((span) => span.type === "text")
    .map((span) => (span.type === "text" ? span.value : ""))
    .join("");
}

function readMaterializedRichTextText(
  data: Record<string, unknown>,
  path: Array<string | number>,
  fallbackSpans: MindooDBAppRichTextSpan[],
) {
  let value: unknown = data;
  for (const segment of path) {
    if (value == null || typeof value !== "object") {
      return spansToPlainText(fallbackSpans);
    }
    value = (value as Record<string | number, unknown>)[segment];
  }
  if (typeof value === "string") {
    return value.replace(/\uFFFC/g, "");
  }
  if (Array.isArray(value)) {
    return spansToPlainText(value as MindooDBAppRichTextSpan[]);
  }
  return spansToPlainText(fallbackSpans);
}

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
