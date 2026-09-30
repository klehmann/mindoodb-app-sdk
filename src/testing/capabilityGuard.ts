/**
 * Capability checks for the mock databases, the way Haven enforces them: a call the
 * database was not granted is rejected with a `forbidden` error. Opt in with
 * `enforceCapabilities: true`; without it the mock only lists the capabilities.
 */
import type {
  MindooDBAppAccessDecision,
  MindooDBAppCapability,
  MindooDBAppDatabase,
  MindooDBAppDatabaseInfo,
} from "../types";

type Requirement = readonly MindooDBAppCapability[];

const NONE: Requirement = [];
const READ: Requirement = ["read"];

/** Document methods by the capability they need; everything else needs `read`. */
const DOCUMENT_REQUIREMENTS: Record<string, Requirement> = {
  // capability probes answer false instead of failing
  canChange: NONE,
  canCreate: NONE,
  canDelete: NONE,
  canUndelete: NONE,
  create: ["create"],
  createMany: ["create"],
  getDefaultCreateKeyId: ["create"],
  listCreateKeys: ["create"],
  update: ["update"],
  applyAutomergeChanges: ["update"],
  applyAutomergeChangesBatch: ["update"],
  addRecipients: ["update"],
  removeRecipients: ["update"],
  setRecipients: ["update"],
  delete: ["delete"],
  deleteMany: ["delete"],
  undelete: ["delete"],
  listHistory: ["history"],
  getAtHeads: ["history"],
  getAtRevision: ["history"],
  getAtTimestamp: ["history"],
  listVerification: ["history"],
};

/** Attachment reads need `attachments`; writes also `update` (as documented for `scan`). */
const ATTACHMENT_REQUIREMENTS: Record<string, Requirement> = {
  openWriteStream: ["attachments", "update"],
  remove: ["attachments", "update"],
  scan: ["attachments", "update"],
};

/** Database-level setup calls. */
const DATABASE_REQUIREMENTS: Record<string, Requirement> = {
  info: NONE,
  getFulltextSetup: READ,
  getExtractionSetup: READ,
  getSummarySetup: READ,
  setFulltextSetup: ["update"],
  setExtractionSetup: ["update"],
  setSummarySetup: ["update"],
};

export class MockForbiddenError extends Error {
  override name = "forbidden";
}

function guardApi<T extends object>(
  api: T,
  requirementOf: (method: string) => Requirement,
  check: (method: string, requirement: Requirement) => void,
): T {
  const guarded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(api)) {
    guarded[key] =
      typeof value === "function"
        ? (...args: unknown[]) => {
            try {
              check(key, requirementOf(key));
            } catch (error) {
              // every API method is async: fail the way the bridge would
              return Promise.reject(error);
            }
            return (value as (...a: unknown[]) => unknown).apply(api, args);
          }
        : value;
  }
  return guarded as T;
}

/**
 * Wraps a mock database so that `info()` always reports the current capabilities and,
 * when `enforce()` is true, every call checks them first. Capabilities are read on each
 * call, so `setCapabilities()` applies without reopening the database.
 */
export function guardDatabase(
  database: MindooDBAppDatabase,
  currentInfo: () => MindooDBAppDatabaseInfo,
  enforce: () => boolean,
): MindooDBAppDatabase {
  const check = (area: string) => (method: string, requirement: Requirement) => {
    if (!enforce()) return;
    const info = currentInfo();
    for (const capability of requirement) {
      if (!info.capabilities.includes(capability)) {
        throw new MockForbiddenError(
          `Database "${info.id}" was not granted the "${capability}" capability (${area}${method})`,
        );
      }
    }
  };
  const predict =
    <A extends unknown[]>(
      fn: (...args: A) => Promise<MindooDBAppAccessDecision>,
      capability: MindooDBAppCapability,
    ) =>
    async (...args: A): Promise<MindooDBAppAccessDecision> => {
      const info = currentInfo();
      if (enforce() && !info.capabilities.includes(capability)) {
        return {
          allowed: false,
          reason: `database "${info.id}" was not granted the "${capability}" capability`,
          tier: "tier1",
        };
      }
      return await fn.apply(database.documents, args);
    };
  const base = guardApi(
    database,
    (method) => DATABASE_REQUIREMENTS[method] ?? READ,
    check(""),
  );
  return {
    ...base,
    async info() {
      const info = currentInfo();
      return { ...info, capabilities: [...info.capabilities] };
    },
    documents: {
      ...guardApi(
        database.documents,
        (method) => DOCUMENT_REQUIREMENTS[method] ?? READ,
        check("documents."),
      ),
      // the non-throwing predictions report the missing capability instead
      canCreate: predict(database.documents.canCreate, "create"),
      canChange: predict(database.documents.canChange, "update"),
      canDelete: predict(database.documents.canDelete, "delete"),
      canUndelete: predict(database.documents.canUndelete, "delete"),
    },
    attachments: guardApi(
      database.attachments,
      (method) => ATTACHMENT_REQUIREMENTS[method] ?? ["attachments"],
      check("attachments."),
    ),
    identity: guardApi(database.identity, () => ["sign"], check("identity.")),
    timestamps: guardApi(database.timestamps, () => ["timestamps"], check("timestamps.")),
    directory: guardApi(database.directory, () => ["directory"], check("directory.")),
  };
}
