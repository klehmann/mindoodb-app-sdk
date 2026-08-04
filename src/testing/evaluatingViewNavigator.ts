/**
 * Evaluating mock VirtualView navigator for `mindoodb-app-sdk/testing`.
 *
 * Mirrors Haven's `viewNavigatorRuntime` path: build a core `VirtualView` from
 * an SDK view definition + materialised documents, then wrap the sync
 * `VirtualViewNavigator` as the async `MindooDBAppViewNavigator` apps call.
 *
 * Requires the optional `mindoodb` peer (same engine Haven uses). When it is
 * unavailable, callers should fall back to the empty stub navigator.
 */
import { evaluateExpression, getFieldValue } from "mindoodb-view-language";
import type {
  MindooDBAppCreateViewNavigatorInput,
  MindooDBAppScopedDocId,
  MindooDBAppViewDefinition,
  MindooDBAppViewEntry,
  MindooDBAppViewNavigator,
  MindooDBAppViewNavigatorExpansionState,
  MindooDBAppViewNavigatorOpenOptions,
  MindooDBAppViewNavigatorPageOptions,
  MindooDBAppViewNavigatorPageResult,
  MindooDBAppViewNavigatorRangeQuery,
  MindooDBAppViewNavigatorSelectionState,
  MindooDBAppViewUpdateStats,
} from "../types.js";

export type EvaluatingViewDocument = {
  origin: string;
  docId: string;
  data: Record<string, unknown>;
  createdAt?: string | null;
  lastModifiedAt?: string | null;
  witnessed?: boolean;
  awaitingWitness?: boolean;
};

type MindoodbVirtualViews = typeof import("mindoodb");

let mindoodbModulePromise: Promise<MindoodbVirtualViews | null> | null = null;

export async function loadMindoodbForTesting(): Promise<MindoodbVirtualViews | null> {
  if (!mindoodbModulePromise) {
    mindoodbModulePromise = import("mindoodb")
      .then((mod) => mod)
      .catch(() => null);
  }
  return mindoodbModulePromise;
}

function toFormulaBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized !== "" && normalized !== "false" && normalized !== "0" && normalized !== "no";
  }
  return Boolean(value);
}

function matchesFilter(
  mindoodb: MindoodbVirtualViews,
  definition: MindooDBAppViewDefinition,
  doc: Record<string, unknown>,
  origin: string,
  createdAt?: string | null,
  lastModifiedAt?: string | null,
  witnessed?: boolean,
  awaitingWitness?: boolean,
): boolean {
  void mindoodb;
  if (!definition.filter) return true;
  return toFormulaBoolean(
    evaluateExpression(definition.filter.expression, {
      doc,
      values: doc,
      origin,
      createdAt,
      lastModifiedAt,
      witnessed,
      awaitingWitness,
      variables: {},
    }),
  );
}

function computeColumnValues(
  definition: MindooDBAppViewDefinition,
  doc: Record<string, unknown>,
  origin: string,
  createdAt?: string | null,
  lastModifiedAt?: string | null,
  witnessed?: boolean,
  awaitingWitness?: boolean,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!key.startsWith("_")) values[key] = value;
  }
  for (const column of definition.columns) {
    const expression = column.expression;
    const value =
      expression.kind === "field"
        ? (getFieldValue(doc, expression.path) ?? getFieldValue(values, expression.path))
        : evaluateExpression(expression, {
            doc,
            values,
            origin,
            createdAt,
            lastModifiedAt,
            witnessed,
            awaitingWitness,
            variables: {},
          });
    values[column.name] = value;
  }
  return values;
}

function mapSorting(
  mindoodb: MindoodbVirtualViews,
  direction: "none" | "ascending" | "descending" | undefined,
) {
  switch (direction) {
    case "ascending":
      return mindoodb.ColumnSorting.ASCENDING;
    case "descending":
      return mindoodb.ColumnSorting.DESCENDING;
    default:
      return mindoodb.ColumnSorting.NONE;
  }
}

function mapTotalMode(
  mindoodb: MindoodbVirtualViews,
  mode: "none" | "sum" | "average" | undefined,
) {
  switch (mode) {
    case "sum":
      return mindoodb.TotalMode.SUM;
    case "average":
      return mindoodb.TotalMode.AVERAGE;
    default:
      return mindoodb.TotalMode.NONE;
  }
}

function getCategoryPath(entry: import("mindoodb").VirtualViewEntryData): unknown[] {
  const path: unknown[] = [];
  let current: import("mindoodb").VirtualViewEntryData | null = entry.isCategory()
    ? entry
    : entry.getParent();
  while (current && !current.isRoot()) {
    if (current.isCategory()) path.unshift(current.getCategoryValue());
    current = current.getParent();
  }
  return path;
}

function serializeEntry(
  navigator: import("mindoodb").VirtualViewNavigator,
  entry: import("mindoodb").VirtualViewEntryData,
): MindooDBAppViewEntry {
  const parent = entry.getParent();
  return {
    key: entry.getPositionStr(),
    kind: entry.isCategory() ? "category" : "document",
    origin: entry.origin,
    docId: entry.docId,
    level: entry.getLevel(),
    parentKey: parent && !parent.isRoot() ? parent.getPositionStr() : null,
    categoryPath: getCategoryPath(entry),
    categoryValue: entry.isCategory() ? entry.getCategoryValue() : null,
    columnValues: entry.getColumnValues(),
    childCount: entry.getChildCount(),
    descendantDocumentCount: entry.getDescendantDocumentCount(),
    descendantCount: entry.getDescendantCount(),
    descendantCategoryCount: entry.getDescendantCategoryCount(),
    siblingCount: entry.getSiblingCount(),
    childCategoryCount: entry.getChildCategoryCount(),
    childDocumentCount: entry.getChildDocumentCount(),
    position: entry.getPositionStr(),
    expanded: entry.isCategory() ? navigator.isExpanded(entry) : false,
    selected: navigator.isSelected(entry.origin, entry.docId),
    isVisible: true,
  };
}

async function buildVirtualView(
  mindoodb: MindoodbVirtualViews,
  definition: MindooDBAppViewDefinition,
  documents: EvaluatingViewDocument[],
  categorizationStyle?: MindooDBAppCreateViewNavigatorInput["categorizationStyle"],
): Promise<import("mindoodb").VirtualView> {
  const builder = mindoodb.VirtualViewFactory.createView().withCategorizationStyle(
    categorizationStyle === "category_then_document"
      ? mindoodb.CategorizationStyle.CATEGORY_THEN_DOCUMENT
      : mindoodb.CategorizationStyle.DOCUMENT_THEN_CATEGORY,
  );

  for (const column of definition.columns) {
    const commonOptions = {
      title: column.title,
      isHidden: column.hidden,
      expression: column.expression,
    };
    switch (column.role) {
      case "category":
        builder.addCategoryColumn(column.name, {
          ...commonOptions,
          sorting: mapSorting(
            mindoodb,
            column.sorting === "none" ? "ascending" : column.sorting,
          ),
        });
        break;
      case "sort":
        builder.addSortedColumn(
          column.name,
          mapSorting(
            mindoodb,
            !column.sorting || column.sorting === "none" ? "ascending" : column.sorting,
          ),
          commonOptions,
        );
        break;
      case "display":
        if (column.sorting && column.sorting !== "none") {
          builder.addSortedColumn(column.name, mapSorting(mindoodb, column.sorting), commonOptions);
        } else {
          builder.addDisplayColumn(column.name, commonOptions);
        }
        break;
      case "total":
        builder.addTotalColumn(
          column.name,
          mapTotalMode(mindoodb, column.totalMode === "none" ? "sum" : column.totalMode),
          commonOptions,
        );
        break;
    }
  }

  const view = await builder.build();
  const changes = new Map<string, import("mindoodb").VirtualViewDataChange>();
  for (const document of documents) {
    if (
      !matchesFilter(
        mindoodb,
        definition,
        document.data,
        document.origin,
        document.createdAt,
        document.lastModifiedAt,
        document.witnessed,
        document.awaitingWitness,
      )
    ) {
      continue;
    }
    const change =
      changes.get(document.origin) ?? new mindoodb.VirtualViewDataChange(document.origin);
    change.addEntry(
      document.docId,
      computeColumnValues(
        definition,
        document.data,
        document.origin,
        document.createdAt,
        document.lastModifiedAt,
        document.witnessed,
        document.awaitingWitness,
      ),
    );
    changes.set(document.origin, change);
  }
  for (const change of changes.values()) {
    if (change.hasChanges()) view.applyChanges(change);
  }
  view.getRoot();
  return view;
}

function createCoreNavigator(
  mindoodb: MindoodbVirtualViews,
  view: import("mindoodb").VirtualView,
  options?: MindooDBAppViewNavigatorOpenOptions,
): import("mindoodb").VirtualViewNavigator {
  const builder = mindoodb.VirtualViewFactory.createNavigator(view);
  const includeCategories = options?.includeCategories ?? true;
  const includeDocuments = options?.includeDocuments ?? true;

  if (!includeCategories && includeDocuments) builder.documentsOnly();
  else if (includeCategories && !includeDocuments) builder.categoriesOnly();
  if (options?.hideEmptyCategories) builder.hideEmptyCategories();

  if (Array.isArray(options?.rootCategoryPath) && options.rootCategoryPath.length > 0) {
    builder.fromCategory(options.rootCategoryPath.map((part) => String(part)).join("\\"));
  } else if (options?.rootEntryKey) {
    const temp = mindoodb.VirtualViewFactory.createSimpleNavigator(view);
    const rootEntry = temp.getPos(options.rootEntryKey);
    if (rootEntry) builder.fromEntry(rootEntry);
  }

  return builder.build();
}

function normalizePageLimit(limit?: number): number {
  return Math.max(1, Math.min(1000, Math.trunc(limit ?? 100)));
}

function pageEntries(
  navigator: import("mindoodb").VirtualViewNavigator,
  direction: "forward" | "backward",
  options: MindooDBAppViewNavigatorPageOptions = {},
): MindooDBAppViewNavigatorPageResult {
  const entries: MindooDBAppViewEntry[] = [];
  const startOk = options.startPosition
    ? navigator.gotoPos(options.startPosition)
    : direction === "forward"
      ? navigator.gotoFirst()
      : navigator.gotoLast();
  if (!startOk) {
    return { entries, nextPosition: null, hasMore: false };
  }

  const moveNext = () => {
    if (direction === "forward") {
      return options.selectedOnly ? navigator.gotoNextSelected() : navigator.gotoNext();
    }
    return options.selectedOnly ? navigator.gotoPrevSelected() : navigator.gotoPrev();
  };

  if (options.selectedOnly) {
    const current = navigator.getCurrentEntry();
    if (!current || !navigator.isSelected(current.origin, current.docId)) {
      if (!moveNext()) return { entries, nextPosition: null, hasMore: false };
    }
  }

  const limit = normalizePageLimit(options.limit);
  let nextPosition: string | null = null;
  let hasMore = false;
  while (true) {
    const current = navigator.getCurrentEntry();
    if (!current) break;
    entries.push(serializeEntry(navigator, current));
    if (entries.length >= limit) {
      hasMore = moveNext();
      nextPosition = hasMore ? (navigator.getCurrentEntry()?.getPositionStr() ?? null) : null;
      break;
    }
    if (!moveNext()) break;
  }
  return { entries, nextPosition, hasMore };
}

function resolveEntry(
  navigator: import("mindoodb").VirtualViewNavigator,
  entryKey: string,
): import("mindoodb").VirtualViewEntryData {
  const entry = navigator.getPos(entryKey);
  if (!entry) {
    throw new Error(`Unknown view entry: ${entryKey}`);
  }
  return entry;
}

function wrapNavigator(
  definition: MindooDBAppViewDefinition,
  navigator: import("mindoodb").VirtualViewNavigator,
): MindooDBAppViewNavigator {
  const updateListeners = new Set<(stats: MindooDBAppViewUpdateStats) => void>();
  let viewCursor: string | null = null;

  return {
    async getDefinition() {
      return definition;
    },
    async getViewCursor() {
      return viewCursor;
    },
    async refresh() {
      return viewCursor;
    },
    onDidUpdate(listener) {
      updateListeners.add(listener);
      return () => updateListeners.delete(listener);
    },
    async getCurrentEntry() {
      const entry = navigator.getCurrentEntry();
      return entry ? serializeEntry(navigator, entry) : null;
    },
    async gotoFirst() {
      return navigator.gotoFirst();
    },
    async gotoLast() {
      return navigator.gotoLast();
    },
    async gotoNext() {
      return navigator.gotoNext();
    },
    async gotoPrev() {
      return navigator.gotoPrev();
    },
    async gotoNextSibling() {
      return navigator.gotoNextSibling();
    },
    async gotoPrevSibling() {
      return navigator.gotoPrevSibling();
    },
    async gotoParent() {
      return navigator.gotoParent();
    },
    async gotoFirstChild() {
      return navigator.gotoFirstChild();
    },
    async gotoLastChild() {
      return navigator.gotoLastChild();
    },
    async gotoPos(position) {
      return navigator.gotoPos(position);
    },
    async getPos(position) {
      const entry = navigator.getPos(position);
      return entry ? serializeEntry(navigator, entry) : null;
    },
    async findCategoryEntryByParts(parts) {
      const entry = navigator.findCategoryEntryByParts(parts);
      return entry ? serializeEntry(navigator, entry) : null;
    },
    async entriesForward(options) {
      return pageEntries(navigator, "forward", options);
    },
    async entriesBackward(options) {
      return pageEntries(navigator, "backward", options);
    },
    async gotoNextSelected() {
      return navigator.gotoNextSelected();
    },
    async gotoPrevSelected() {
      return navigator.gotoPrevSelected();
    },
    async select(origin, docId, selectParentCategories = false) {
      navigator.select(origin, docId, selectParentCategories);
    },
    async deselect(origin, docId) {
      navigator.deselect(origin, docId);
    },
    async selectAllEntries() {
      navigator.selectAllEntries();
    },
    async deselectAllEntries() {
      navigator.deselectAllEntries();
    },
    async isSelected(origin, docId) {
      return navigator.isSelected(origin, docId);
    },
    async getSelectionState() {
      return {
        selectAllByDefault: navigator.isSelectAllByDefault(),
        entryKeys: Array.from(navigator.getSelectedOrDeselectedEntries()),
      };
    },
    async setSelectionState(state: MindooDBAppViewNavigatorSelectionState) {
      if (state.selectAllByDefault) navigator.selectAllEntries();
      else navigator.deselectAllEntries();
      navigator.setSelectedOrDeselectedEntries(new Set(state.entryKeys));
    },
    async expand(origin, docId) {
      navigator.expand(origin, docId);
    },
    async collapse(origin, docId) {
      navigator.collapse(origin, docId);
    },
    async expandAll() {
      navigator.expandAll();
    },
    async collapseAll() {
      navigator.collapseAll();
    },
    async expandToLevel(level) {
      navigator.expandToLevel(level);
    },
    async isExpanded(entryKey) {
      const entry = navigator.getPos(entryKey);
      return entry ? navigator.isExpanded(entry) : false;
    },
    async getExpansionState() {
      return {
        expandAllByDefault: navigator.isExpandAllByDefault(),
        expandLevel: navigator.getExpandLevel(),
        entryKeys: Array.from(navigator.getExpandedOrCollapsedEntries()),
      };
    },
    async setExpansionState(state: MindooDBAppViewNavigatorExpansionState) {
      if (state.expandAllByDefault) navigator.expandAll();
      else navigator.collapseAll();
      navigator.expandToLevel(state.expandLevel);
      navigator.setExpandedOrCollapsedEntries(new Set(state.entryKeys));
    },
    async childEntries(entryKey, descending) {
      return navigator
        .childEntries(resolveEntry(navigator, entryKey), descending)
        .map((entry) => serializeEntry(navigator, entry));
    },
    async childCategories(entryKey, descending) {
      return navigator
        .childCategories(resolveEntry(navigator, entryKey), descending)
        .map((entry) => serializeEntry(navigator, entry));
    },
    async childDocuments(entryKey, descending) {
      return navigator
        .childDocuments(resolveEntry(navigator, entryKey), descending)
        .map((entry) => serializeEntry(navigator, entry));
    },
    async childCategoriesByKey(entryKey, key, exact, descending) {
      return navigator
        .childCategoriesByKey(
          resolveEntry(navigator, entryKey),
          String(key ?? ""),
          Boolean(exact),
          descending,
        )
        .map((entry) => serializeEntry(navigator, entry));
    },
    async childDocumentsByKey(entryKey, key, exact, descending) {
      return navigator
        .childDocumentsByKey(
          resolveEntry(navigator, entryKey),
          String(key ?? ""),
          Boolean(exact),
          descending,
        )
        .map((entry) => serializeEntry(navigator, entry));
    },
    async childCategoriesBetween(entryKey, range: MindooDBAppViewNavigatorRangeQuery) {
      return navigator
        .childCategoriesBetween(
          resolveEntry(navigator, entryKey),
          range.startKey,
          range.endKey,
          range.descending,
        )
        .map((entry) => serializeEntry(navigator, entry));
    },
    async childDocumentsBetween(entryKey, range: MindooDBAppViewNavigatorRangeQuery) {
      return navigator
        .childDocumentsBetween(
          resolveEntry(navigator, entryKey),
          range.startKey,
          range.endKey,
          range.descending,
        )
        .map((entry) => serializeEntry(navigator, entry));
    },
    async getSortedDocIds(descending): Promise<MindooDBAppScopedDocId[]> {
      const page = pageEntries(navigator, descending ? "backward" : "forward", { limit: 1000 });
      return collectSortedDocIds(page.entries);
    },
    async getSortedDocIdsScoped(entryKey, descending): Promise<MindooDBAppScopedDocId[]> {
      const docs = navigator.childDocuments(resolveEntry(navigator, entryKey), descending);
      return docs.map((entry) => ({ origin: entry.origin, docId: entry.docId }));
    },
    async dispose() {
      updateListeners.clear();
    },
  };
}

function collectSortedDocIds(entries: MindooDBAppViewEntry[]): MindooDBAppScopedDocId[] {
  const results: MindooDBAppScopedDocId[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "document" || !entry.docId) continue;
    const key = `${entry.origin}:${entry.docId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ origin: entry.origin, docId: entry.docId });
  }
  return results;
}

/**
 * Build an async SDK navigator that evaluates `input.definition` against the
 * provided materialised documents (same engine Haven uses for bridge views).
 *
 * Returns `null` when the optional `mindoodb` peer is not installed.
 */
export async function createEvaluatingViewNavigator(
  input: MindooDBAppCreateViewNavigatorInput,
  documents: EvaluatingViewDocument[],
): Promise<MindooDBAppViewNavigator | null> {
  const mindoodb = await loadMindoodbForTesting();
  if (!mindoodb) return null;

  const view = await buildVirtualView(
    mindoodb,
    input.definition,
    documents,
    input.categorizationStyle,
  );
  const navigator = createCoreNavigator(mindoodb, view, input.options);
  return wrapNavigator(input.definition, navigator);
}
