/**
 * Folders ("filing") for the mock host: an in-memory stand-in for
 * `database.filing(store)` with the same semantics Haven/MindooDB have —
 * filing never changes the filed document, deleted folders hide their
 * memberships, refs to other databases use the app's binding ids — plus
 * the view-side pieces (`folders()` / `inFolder()` evaluation and
 * `rootCategoryPaths`) for the evaluating mock navigator.
 */
import type {
  MindooDBAppCreateFolderInput,
  MindooDBAppFilingApi,
  MindooDBAppFilingEntry,
  MindooDBAppFilingFolder,
  MindooDBAppFilingRef,
} from "../types";

type FolderState = MindooDBAppFilingFolder & { deleted: boolean };

interface StoreState {
  folders: Map<string, FolderState>;
  /** `<databaseId>\u0000<docId>` -> folderId -> filedAt */
  members: Map<string, Map<string, number>>;
}

const FOLDER_ID = /^[^\\\u0000-\u001f]{1,200}$/;

function assertFolderId(folderId: unknown): asserts folderId is string {
  if (typeof folderId !== "string" || !FOLDER_ID.test(folderId)) {
    throw new Error(`Invalid folder id ${JSON.stringify(folderId)}: 1-200 characters, no backslash.`);
  }
}

function toList(value: string | string[]): string[] {
  const list = Array.isArray(value) ? value : [value];
  list.forEach(assertFolderId);
  return list;
}

/** All filing stores of one mock database. */
/** Deletion state of a mock document: `null` = exists or unknown, else deleted at (epoch ms). */
export type MockDeletionLookup = (databaseId: string, docId: string) => number | null;

/** Default grace period before deleted documents leave their folders (as in MindooDB). */
export const MOCK_FILING_PRUNE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export class MockFilingRegistry {
  private readonly stores = new Map<string, StoreState>();

  constructor(
    private readonly databaseId: string,
    private readonly onChange: () => void,
    private readonly deletedAt: MockDeletionLookup = () => null,
  ) {}

  private state(store: string): StoreState {
    let state = this.stores.get(store);
    if (!state) {
      state = { folders: new Map(), members: new Map() };
      this.stores.set(store, state);
    }
    return state;
  }

  private key(ref: MindooDBAppFilingRef): string {
    const target = typeof ref === "string" ? { docId: ref } : ref;
    if (!target || typeof target.docId !== "string" || !target.docId) {
      throw new Error("Invalid filing reference: expected a document id or { databaseId?, docId }.");
    }
    return `${target.databaseId ?? this.databaseId}\u0000${target.docId}`;
  }

  /** Visible folder ids of a document (database binding id + doc id). */
  foldersOf(store: string, databaseId: string, docId: string): string[] {
    const state = this.stores.get(store);
    const map = state?.members.get(`${databaseId}\u0000${docId}`);
    if (!state || !map) return [];
    return [...map.keys()].filter((folderId) => state.folders.get(folderId)?.deleted !== true).sort();
  }

  api(store: string): MindooDBAppFilingApi {
    if (typeof store !== "string" || !store) {
      throw new Error("database.filing(store): store must be a non-empty string.");
    }
    const state = () => this.state(store);
    const changed = () => this.onChange();
    const visible = (key: string) => {
      const s = state();
      return [...(s.members.get(key)?.keys() ?? [])].filter((id) => s.folders.get(id)?.deleted !== true).sort();
    };
    const removeKeys = (key: string, ids: string[] | null) => {
      const map = state().members.get(key);
      if (!map) return;
      for (const id of ids ?? [...map.keys()]) map.delete(id);
    };
    const toEntry = (key: string, filedAt: number): MindooDBAppFilingEntry => {
      const [databaseId, docId] = key.split("\u0000");
      return { databaseId: databaseId ?? null, docId: docId ?? "", filedAt };
    };
    const publicFolder = (folder: FolderState): MindooDBAppFilingFolder => {
      const { deleted: _deleted, ...rest } = folder;
      return { ...rest };
    };
    return {
      store,
      add: async (ref, folderIds) => {
        const ids = toList(folderIds);
        const key = this.key(ref);
        let map = state().members.get(key);
        if (!map) {
          map = new Map();
          state().members.set(key, map);
        }
        const now = Date.now();
        for (const id of ids) if (!map.has(id)) map.set(id, now);
        changed();
      },
      remove: async (ref, folderIds) => {
        removeKeys(this.key(ref), folderIds === undefined ? null : toList(folderIds));
        changed();
      },
      move: async (ref, options) => {
        const to = toList(options.to);
        const key = this.key(ref);
        const map = state().members.get(key) ?? new Map<string, number>();
        state().members.set(key, map);
        const from = options.from === undefined ? [...map.keys()] : toList(options.from);
        for (const id of from) if (!to.includes(id)) map.delete(id);
        const now = Date.now();
        for (const id of to) if (!map.has(id)) map.set(id, now);
        changed();
      },
      foldersOf: async (ref) => visible(this.key(ref)),
      contents: async (folderId, options) => {
        assertFolderId(folderId);
        const s = state();
        const all: MindooDBAppFilingEntry[] = [];
        if (s.folders.get(folderId)?.deleted !== true) {
          for (const [key, map] of s.members) {
            const at = map.get(folderId);
            if (at !== undefined) all.push(toEntry(key, at));
          }
        }
        all.sort((a, b) => a.filedAt - b.filedAt || a.docId.localeCompare(b.docId));
        const start = Number(options?.cursor ?? 0) || 0;
        const limit = Math.max(1, Math.min(1000, Math.trunc(options?.limit ?? 100)));
        const items = all.slice(start, start + limit);
        return { items, nextCursor: start + limit < all.length ? String(start + limit) : null };
      },
      count: async (folderId) => {
        assertFolderId(folderId);
        const s = state();
        if (s.folders.get(folderId)?.deleted === true) return 0;
        let count = 0;
        for (const map of s.members.values()) if (map.has(folderId)) count++;
        return count;
      },
      createFolder: async (input: MindooDBAppCreateFolderInput) => {
        if (typeof input?.name !== "string" || !input.name.trim()) {
          throw new Error("createFolder: name must be a non-empty string.");
        }
        const folderId = input.folderId ?? `fld_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
        assertFolderId(folderId);
        const folder: FolderState = {
          folderId,
          name: input.name,
          parentId: input.parentId ?? null,
          role: input.role ?? null,
          design: input.design ?? null,
          deleted: false,
        };
        state().folders.set(folderId, folder);
        changed();
        return publicFolder(folder);
      },
      updateFolder: async (folderId, changes) => {
        const folder = state().folders.get(folderId);
        if (!folder || folder.deleted) throw new Error(`Folder "${folderId}" does not exist in filing store "${store}".`);
        if (changes.name !== undefined) folder.name = changes.name;
        if (changes.parentId !== undefined) folder.parentId = changes.parentId ?? null;
        if (changes.role !== undefined) folder.role = changes.role ?? null;
        if (changes.design !== undefined) folder.design = changes.design ?? null;
        changed();
      },
      renameFolder: async (folderId, name) => {
        const folder = state().folders.get(folderId);
        if (!folder || folder.deleted) throw new Error(`Folder "${folderId}" does not exist in filing store "${store}".`);
        folder.name = name;
        changed();
      },
      deleteFolder: async (folderId, options) => {
        assertFolderId(folderId);
        const folder = state().folders.get(folderId);
        if (folder) folder.deleted = true;
        if (!options?.keepFiling) {
          for (const map of state().members.values()) map.delete(folderId);
        }
        changed();
      },
      getFolder: async (folderId) => {
        const folder = state().folders.get(folderId);
        return folder && !folder.deleted ? publicFolder(folder) : null;
      },
      listFolders: async () => [...state().folders.values()].filter((f) => !f.deleted).map(publicFolder),
      prune: async (options) => {
        const grace = Math.max(0, options?.gracePeriodMs ?? MOCK_FILING_PRUNE_GRACE_MS);
        const databases = new Set([this.databaseId, ...(options?.databaseIds ?? [])]);
        let removed = 0;
        let pending = 0;
        for (const [key, map] of state().members) {
          if (map.size === 0) continue;
          const [databaseId, docId] = key.split("\u0000");
          if (!databaseId || !docId || !databases.has(databaseId)) continue;
          const at = this.deletedAt(databaseId, docId);
          if (at === null) continue;
          if (Date.now() - at < grace) {
            pending++;
            continue;
          }
          map.clear();
          removed++;
        }
        if (removed) changed();
        return { removed, pending };
      },
    };
  }
}

type Expression = { kind: string; op?: string; args?: Expression[]; [key: string]: unknown };

/**
 * Replace `folders(store)` / `inFolder(store, id?)` by literals for one
 * document, so any evaluator — also one that predates the filing
 * operations — can evaluate the expression.
 */
export function substituteFilingOperations<T>(expression: T, foldersOf: (store: string) => string[]): T {
  const visit = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(visit);
    const expr = node as Expression;
    if (expr.kind === "operation" && (expr.op === "folders" || expr.op === "inFolder")) {
      const storeArg = expr.args?.[0];
      const store = storeArg?.kind === "literal" ? String(storeArg.value ?? "") : "";
      const folders = foldersOf(store);
      if (expr.op === "folders") return { kind: "literal", value: folders };
      const idArg = expr.args?.[1];
      const id = idArg?.kind === "literal" ? idArg.value : undefined;
      return {
        kind: "literal",
        value: id === undefined || id === null || id === "" ? folders.length > 0 : folders.includes(String(id)),
      };
    }
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(expr)) copy[key] = visit(value);
    return copy;
  };
  return visit(expression) as T;
}
