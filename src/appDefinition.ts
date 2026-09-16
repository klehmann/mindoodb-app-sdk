/**
 * Shared description of a deployed application, served by the app itself from its own
 * origin as `haven-app.json`.
 *
 * This is the publisher contract: one URL is enough to install an app. Haven fetches
 * this file, shows the user what it asks for, and turns it into an app registration —
 * label, permissions, and the databases the app needs.
 *
 * The definition deliberately carries no tenant ids, no physical database targets, and
 * no identity: those belong to the installing Haven, not to the publisher. A publisher
 * names a *logical* database ("notes") and may suggest a physical id; Haven decides
 * which tenant it lands in.
 *
 * Note for maintainers: Haven validates `haven-app.json` with its own copy of these
 * rules (`features/apps/lib/appDefinition.ts`) because a Haven release runs against a
 * published SDK version, not the workspace source. Both sides must stay wire
 * compatible; add fields as optional and never repurpose an existing name.
 */

export const MINDOODB_APP_DEFINITION_FORMAT = "mindoodb.haven.app";
export const MINDOODB_APP_DEFINITION_VERSION = 1;

export const MINDOODB_APP_DEFINITION_FILE_NAME = "haven-app.json";

/**
 * Permissions a publisher may request. `read` is not listed because it is implied by a
 * database mapping existing at all.
 *
 * `sign` and `proposeapps` grant only the right to *ask*: Haven still runs a consent
 * dialog for every signature and every proposed app.
 */
export const MINDOODB_APP_DEFINITION_PERMISSIONS = [
  "write",
  "delete",
  "history",
  "attachments",
  "views",
  "sign",
  "timestamps",
  "directory",
  "sealedchannel",
  "proposeapps",
] as const;

export type MindooDBAppDefinitionPermission = (typeof MINDOODB_APP_DEFINITION_PERMISSIONS)[number];

/** Permissions that are properties of the app as a whole, not of one database. */
export const MINDOODB_APP_DEFINITION_REGISTRATION_PERMISSIONS = ["proposeapps"] as const;

export type MindooDBAppDefinitionRegistrationPermission =
  (typeof MINDOODB_APP_DEFINITION_REGISTRATION_PERMISSIONS)[number];

export interface MindooDBAppDefinitionDatabase {
  /**
   * The id the app passes to `session.openDatabase()`. Stable part of the app's own
   * source code, independent of where the data physically lives.
   */
  logicalDatabaseId: string;
  /** Shown to the user during install. Defaults to `logicalDatabaseId`. */
  label?: string;
  /**
   * Suggested physical database id. Haven may substitute a different one; the app must
   * never assume this value and always address the database by `logicalDatabaseId`.
   */
  databaseId?: string;
  /**
   * Requested per-database permissions. Registration-level permissions
   * (see {@link MINDOODB_APP_DEFINITION_REGISTRATION_PERMISSIONS}) do not belong here.
   */
  permissions?: MindooDBAppDefinitionPermission[];
  /**
   * Whether Haven should create the database during install when it does not
   * exist yet. Defaults to `true`, because an app that declares a database
   * needs it to start. Set `false` for a database the app only joins if the
   * user already has it.
   */
  create?: boolean;
}

export interface MindooDBAppDefinition {
  format: typeof MINDOODB_APP_DEFINITION_FORMAT;
  formatVersion: number;
  /** Stable publisher-side identifier, e.g. `mindoodb-app-builder`. */
  appId: string;
  label: string;
  description?: string;
  /** Human-readable version, shown in the install dialog. */
  version?: string;
  /**
   * How the app wants to be launched. `iframe` is the default and correct for almost
   * every app; `window` exists for apps that cannot run framed.
   */
  runtime?: "iframe" | "window";
  /**
   * `external` keeps the app live at its own origin. `hosted` asks Haven to download
   * the built assets from `haven-bundle.json` on this same origin and serve them
   * locally, which also works offline.
   */
  hosting?: "external" | "hosted";
  /** Origins the app needs to reach at runtime. Shown to the user before install. */
  networkAllowlist?: string[];
  allowPopups?: boolean;
  allowCamera?: boolean;
  allowMicrophone?: boolean;
  allowGeolocation?: boolean;
  allowWebRtc?: boolean;
  allowWorkers?: boolean;
  /** Permissions that apply to the app itself rather than to one database. */
  permissions?: MindooDBAppDefinitionRegistrationPermission[];
  /** Static launch parameters the app expects in its launch context. */
  launchParameters?: Record<string, string>;
  /** `logicalDatabaseId` the app should open first. */
  defaultLaunchDatabaseId?: string;
  databases?: MindooDBAppDefinitionDatabase[];
}

export interface MindooDBAppDefinitionValidation {
  definition: MindooDBAppDefinition | null;
  errors: string[];
}

const LOGICAL_DATABASE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(raw: Record<string, unknown>, key: string, errors: string[]): string | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    errors.push(`App definition ${key} must be a string.`);
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readOptionalBoolean(raw: Record<string, unknown>, key: string, errors: string[]): boolean | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    errors.push(`App definition ${key} must be a boolean.`);
    return undefined;
  }
  return value || undefined;
}

function readStringRecord(
  raw: Record<string, unknown>,
  key: string,
  errors: string[],
): Record<string, string> | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isPlainObject(value)) {
    errors.push(`App definition ${key} must be an object of string values.`);
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "string") {
      errors.push(`App definition ${key}.${entryKey} must be a string.`);
      continue;
    }
    result[entryKey] = entryValue;
  }
  return Object.keys(result).length ? result : undefined;
}

function readPermissions(
  value: unknown,
  label: string,
  allowed: readonly string[],
  errors: string[],
): MindooDBAppDefinitionPermission[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array of permission names.`);
    return undefined;
  }
  const result: MindooDBAppDefinitionPermission[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !allowed.includes(entry)) {
      errors.push(`${label} contains the unknown permission ${JSON.stringify(entry)}.`);
      continue;
    }
    if (!result.includes(entry as MindooDBAppDefinitionPermission)) {
      result.push(entry as MindooDBAppDefinitionPermission);
    }
  }
  return result.length ? result : undefined;
}

function readNetworkAllowlist(value: unknown, errors: string[]): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.push("App definition networkAllowlist must be an array of origins.");
    return undefined;
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      errors.push(`App definition networkAllowlist contains the invalid entry ${JSON.stringify(entry)}.`);
      continue;
    }
    const trimmed = entry.trim();
    if (!result.includes(trimmed)) {
      result.push(trimmed);
    }
  }
  return result.length ? result : undefined;
}

function readDatabases(
  value: unknown,
  errors: string[],
): MindooDBAppDefinitionDatabase[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.push("App definition databases must be an array.");
    return undefined;
  }

  const result: MindooDBAppDefinitionDatabase[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      errors.push(`App definition database #${index} must be an object.`);
      return;
    }
    const logicalDatabaseId =
      typeof entry.logicalDatabaseId === "string" ? entry.logicalDatabaseId.trim() : "";
    if (!logicalDatabaseId) {
      errors.push(`App definition database #${index} is missing a non-empty logicalDatabaseId.`);
      return;
    }
    if (!LOGICAL_DATABASE_ID_PATTERN.test(logicalDatabaseId)) {
      errors.push(
        `App definition database "${logicalDatabaseId}" must match ${String(LOGICAL_DATABASE_ID_PATTERN)}.`,
      );
      return;
    }
    if (seen.has(logicalDatabaseId)) {
      errors.push(`App definition lists the database "${logicalDatabaseId}" more than once.`);
      return;
    }
    seen.add(logicalDatabaseId);

    const databaseId = typeof entry.databaseId === "string" ? entry.databaseId.trim() : "";
    if (entry.databaseId !== undefined && entry.databaseId !== null && !databaseId) {
      errors.push(`App definition database "${logicalDatabaseId}" has an empty databaseId.`);
    }

    result.push({
      logicalDatabaseId,
      label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : undefined,
      databaseId: databaseId || undefined,
      permissions: readPermissions(
        entry.permissions,
        `App definition database "${logicalDatabaseId}" permissions`,
        MINDOODB_APP_DEFINITION_PERMISSIONS.filter(
          (permission) =>
            !(MINDOODB_APP_DEFINITION_REGISTRATION_PERMISSIONS as readonly string[]).includes(permission),
        ),
        errors,
      ),
      create: entry.create === false ? false : undefined,
    });
  });

  return result.length ? result : undefined;
}

/**
 * Structural validation of a `haven-app.json` payload. Returns the normalized
 * definition, or `null` plus every problem found so a publisher can fix them in one
 * pass instead of one per reload.
 */
export function validateMindooDBAppDefinition(raw: unknown): MindooDBAppDefinitionValidation {
  const errors: string[] = [];

  if (!isPlainObject(raw)) {
    return { definition: null, errors: ["App definition must be a JSON object."] };
  }

  if (raw.format !== MINDOODB_APP_DEFINITION_FORMAT) {
    errors.push(
      `App definition format must be "${MINDOODB_APP_DEFINITION_FORMAT}", received ${JSON.stringify(raw.format)}.`,
    );
  }

  if (raw.formatVersion !== MINDOODB_APP_DEFINITION_VERSION) {
    errors.push(
      `Unsupported app definition version ${JSON.stringify(raw.formatVersion)}, expected ${MINDOODB_APP_DEFINITION_VERSION}.`,
    );
  }

  const appId = typeof raw.appId === "string" ? raw.appId.trim() : "";
  if (!appId) {
    errors.push("App definition is missing a non-empty appId.");
  }

  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!label) {
    errors.push("App definition is missing a non-empty label.");
  }

  const runtime = raw.runtime;
  if (runtime !== undefined && runtime !== "iframe" && runtime !== "window") {
    errors.push(`App definition runtime must be "iframe" or "window", received ${JSON.stringify(runtime)}.`);
  }

  const hosting = raw.hosting;
  if (hosting !== undefined && hosting !== "external" && hosting !== "hosted") {
    errors.push(
      `App definition hosting must be "external" or "hosted", received ${JSON.stringify(hosting)}.`,
    );
  }

  const description = readOptionalString(raw, "description", errors);
  const version = readOptionalString(raw, "version", errors);
  const defaultLaunchDatabaseId = readOptionalString(raw, "defaultLaunchDatabaseId", errors);
  const networkAllowlist = readNetworkAllowlist(raw.networkAllowlist, errors);
  const launchParameters = readStringRecord(raw, "launchParameters", errors);
  const databases = readDatabases(raw.databases, errors);
  const permissions = readPermissions(
    raw.permissions,
    "App definition permissions",
    MINDOODB_APP_DEFINITION_REGISTRATION_PERMISSIONS,
    errors,
  ) as MindooDBAppDefinitionRegistrationPermission[] | undefined;

  const allowPopups = readOptionalBoolean(raw, "allowPopups", errors);
  const allowCamera = readOptionalBoolean(raw, "allowCamera", errors);
  const allowMicrophone = readOptionalBoolean(raw, "allowMicrophone", errors);
  const allowGeolocation = readOptionalBoolean(raw, "allowGeolocation", errors);
  const allowWebRtc = readOptionalBoolean(raw, "allowWebRtc", errors);
  const allowWorkers = readOptionalBoolean(raw, "allowWorkers", errors);

  if (
    defaultLaunchDatabaseId
    && databases
    && !databases.some((database) => database.logicalDatabaseId === defaultLaunchDatabaseId)
  ) {
    errors.push(
      `App definition defaultLaunchDatabaseId "${defaultLaunchDatabaseId}" is not one of the declared databases.`,
    );
  }

  if (errors.length) {
    return { definition: null, errors };
  }

  return {
    definition: {
      format: MINDOODB_APP_DEFINITION_FORMAT,
      formatVersion: MINDOODB_APP_DEFINITION_VERSION,
      appId,
      label,
      description,
      version,
      runtime: runtime as MindooDBAppDefinition["runtime"],
      hosting: hosting as MindooDBAppDefinition["hosting"],
      networkAllowlist,
      allowPopups,
      allowCamera,
      allowMicrophone,
      allowGeolocation,
      allowWebRtc,
      allowWorkers,
      permissions,
      launchParameters,
      defaultLaunchDatabaseId,
      databases,
    },
    errors: [],
  };
}

/**
 * Turns an app origin into the fixed `haven-app.json` path next to `index.html`.
 * A URL that already points at the file is returned unchanged, so a pasted definition
 * URL works as well as a pasted app URL.
 */
export function resolveMindooDBAppDefinitionUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return "";
  }

  const suffix = `/${MINDOODB_APP_DEFINITION_FILE_NAME}`;
  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    url.search = "";
    url.hash = "";
    url.pathname = path.endsWith(suffix) || path === suffix ? path : `${path === "/" ? "" : path}${suffix}`;
    return url.toString();
  } catch {
    const withoutSlash = trimmed.replace(/\/+$/, "");
    return withoutSlash.toLowerCase().endsWith(suffix) ? withoutSlash : `${withoutSlash}${suffix}`;
  }
}
