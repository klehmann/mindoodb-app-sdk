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
  /**
   * Motion and orientation sensors (Permissions-Policy `accelerometer`, `gyroscope`,
   * `magnetometer`): `devicemotion`/`deviceorientation` events, e.g. to tilt a game or
   * read the compass. iOS still asks the user (`DeviceOrientationEvent.requestPermission`).
   */
  allowMotion?: boolean;
  allowWebRtc?: boolean;
  allowWorkers?: boolean;
  /**
   * Prefix for the app's agent tools: `vega` turns `map_get` into `vega_map_get`.
   * Lowercase letters, digits and `_`, starting with a letter, at most 16 characters;
   * `haven` is reserved. Without it Haven derives a prefix from the app id or label.
   */
  agentToolPrefix?: string;
  /** Permissions that apply to the app itself rather than to one database. */
  permissions?: MindooDBAppDefinitionRegistrationPermission[];
  /** Static launch parameters the app expects in its launch context. */
  launchParameters?: Record<string, string>;
  /** `logicalDatabaseId` the app should open first. */
  defaultLaunchDatabaseId?: string;
  databases?: MindooDBAppDefinitionDatabase[];
  /**
   * What a person sees before installing: the app's landing page when its URL is
   * opened directly, and Haven's setup wizard when it arrives through a shared link.
   * Display-only; nothing in here affects what the app is granted.
   */
  listing?: MindooDBAppDefinitionListing;
}

/**
 * Text in one language, or a map from locale (`de`, `fr`, …) to text. A map must carry
 * `en`, the fallback for every locale it does not name.
 */
export type MindooDBAppLocalizedText = string | ({ en: string } & Record<string, string>);

export interface MindooDBAppDefinitionScreenshot {
  /** Image path relative to the app origin, or an absolute `https:` URL. */
  file: string;
  caption?: MindooDBAppLocalizedText;
}

export interface MindooDBAppDefinitionListing {
  /** One or two sentences: what the app is for. */
  summary?: MindooDBAppLocalizedText;
  /** Longer plain text. Blank lines separate paragraphs; no markup is rendered. */
  description?: MindooDBAppLocalizedText;
  /**
   * The same description with formatting: the Markdown subset of `listingMarkdown.ts`
   * (paragraphs, headings, lists, bold/italic, code, `https:`/`mailto:` links).
   * Readers that know this field show it instead of `description`; older ones ignore it
   * and keep showing `description`, so set both when older Haven versions matter.
   */
  descriptionMarkdown?: MindooDBAppLocalizedText;
  /** Square icon, path relative to the app origin or an absolute `https:` URL. */
  icon?: string;
  screenshots?: MindooDBAppDefinitionScreenshot[];
  /** Who publishes the app. Shown next to the app's origin, never instead of it. */
  publisher?: { name: string; url?: string };
}

export const MINDOODB_APP_LISTING_SUMMARY_MAX = 300;
export const MINDOODB_APP_LISTING_DESCRIPTION_MAX = 4000;
export const MINDOODB_APP_LISTING_MAX_SCREENSHOTS = 8;

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

function readLocalizedText(
  value: unknown,
  label: string,
  maxLength: number,
  errors: string[],
): MindooDBAppLocalizedText | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > maxLength) {
      errors.push(`${label} must not be longer than ${maxLength} characters.`);
      return undefined;
    }
    return trimmed || undefined;
  }
  if (!isPlainObject(value)) {
    errors.push(`${label} must be a string or an object of per-locale strings.`);
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [locale, text] of Object.entries(value)) {
    if (typeof text !== "string") {
      errors.push(`${label}.${locale} must be a string.`);
      continue;
    }
    const trimmed = text.trim();
    if (trimmed.length > maxLength) {
      errors.push(`${label}.${locale} must not be longer than ${maxLength} characters.`);
      continue;
    }
    if (trimmed) {
      result[locale] = trimmed;
    }
  }
  if (!Object.keys(result).length) {
    return undefined;
  }
  if (!result.en) {
    errors.push(`${label} must include an "en" entry as the fallback for other locales.`);
    return undefined;
  }
  return result as { en: string } & Record<string, string>;
}

/** Relative paths stay on the app origin; absolute URLs must be `https:`. */
function readListingAssetPath(value: unknown, label: string, errors: string[]): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label} must be a non-empty string.`);
    return undefined;
  }
  const trimmed = value.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme && scheme !== "https") {
    errors.push(`${label} must be a path on the app origin or an https: URL.`);
    return undefined;
  }
  if (trimmed.startsWith("//")) {
    errors.push(`${label} must be a path on the app origin or an https: URL.`);
    return undefined;
  }
  return trimmed;
}

function readListing(value: unknown, errors: string[]): MindooDBAppDefinitionListing | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isPlainObject(value)) {
    errors.push("App definition listing must be an object.");
    return undefined;
  }
  const listing: MindooDBAppDefinitionListing = {};
  const summary = readLocalizedText(
    value.summary,
    "App definition listing.summary",
    MINDOODB_APP_LISTING_SUMMARY_MAX,
    errors,
  );
  if (summary) listing.summary = summary;
  const description = readLocalizedText(
    value.description,
    "App definition listing.description",
    MINDOODB_APP_LISTING_DESCRIPTION_MAX,
    errors,
  );
  if (description) listing.description = description;
  const descriptionMarkdown = readLocalizedText(
    value.descriptionMarkdown,
    "App definition listing.descriptionMarkdown",
    MINDOODB_APP_LISTING_DESCRIPTION_MAX,
    errors,
  );
  if (descriptionMarkdown) listing.descriptionMarkdown = descriptionMarkdown;
  const icon = readListingAssetPath(value.icon, "App definition listing.icon", errors);
  if (icon) listing.icon = icon;

  if (value.screenshots !== undefined && value.screenshots !== null) {
    if (!Array.isArray(value.screenshots)) {
      errors.push("App definition listing.screenshots must be an array.");
    } else if (value.screenshots.length > MINDOODB_APP_LISTING_MAX_SCREENSHOTS) {
      errors.push(
        `App definition listing.screenshots must not list more than ${MINDOODB_APP_LISTING_MAX_SCREENSHOTS} images.`,
      );
    } else {
      const screenshots: MindooDBAppDefinitionScreenshot[] = [];
      value.screenshots.forEach((entry, index) => {
        const label = `App definition listing.screenshots[${index}]`;
        const raw = typeof entry === "string" ? { file: entry } : entry;
        if (!isPlainObject(raw)) {
          errors.push(`${label} must be a path or an object with a file.`);
          return;
        }
        const file = readListingAssetPath(raw.file, `${label}.file`, errors);
        if (!file) {
          return;
        }
        const caption = readLocalizedText(raw.caption, `${label}.caption`, MINDOODB_APP_LISTING_SUMMARY_MAX, errors);
        screenshots.push(caption ? { file, caption } : { file });
      });
      if (screenshots.length) listing.screenshots = screenshots;
    }
  }

  if (value.publisher !== undefined && value.publisher !== null) {
    const publisher = isPlainObject(value.publisher) ? value.publisher : {};
    const name = typeof publisher.name === "string" ? publisher.name.trim() : "";
    if (!name) {
      errors.push("App definition listing.publisher must be an object with a non-empty name.");
    } else {
      const url = readListingAssetPath(publisher.url, "App definition listing.publisher.url", errors);
      if (url && !/^https:\/\//i.test(url)) {
        errors.push("App definition listing.publisher.url must be an absolute https: URL.");
      } else {
        listing.publisher = url ? { name, url } : { name };
      }
    }
  }

  return Object.keys(listing).length ? listing : undefined;
}

/**
 * Picks the text for `locale` out of a localized value: the exact locale, then its
 * language (`de` for `de-CH`), then `en`.
 */
export function resolveMindooDBAppLocalizedText(
  text: MindooDBAppLocalizedText | undefined,
  locale: string,
): string {
  if (text === undefined) {
    return "";
  }
  if (typeof text === "string") {
    return text;
  }
  const normalized = locale.trim();
  const language = normalized.split(/[-_]/)[0]?.toLowerCase() ?? "";
  return text[normalized] ?? text[normalized.toLowerCase()] ?? (language ? text[language] : undefined) ?? text.en;
}

/**
 * Resolves a listing asset (icon, screenshot) against the app origin. Returns `null`
 * for anything that would leave `https:` or the origin's own scheme.
 */
export function resolveMindooDBAppListingAssetUrl(path: string, originUrl: string): string | null {
  try {
    const base = new URL(originUrl.endsWith("/") ? originUrl : `${originUrl}/`);
    const resolved = new URL(path, base);
    if (resolved.protocol !== "https:" && resolved.protocol !== base.protocol) {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
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
  const allowMotion = readOptionalBoolean(raw, "allowMotion", errors);
  const allowWebRtc = readOptionalBoolean(raw, "allowWebRtc", errors);
  const allowWorkers = readOptionalBoolean(raw, "allowWorkers", errors);
  const listing = readListing(raw.listing, errors);
  const agentToolPrefix = readOptionalString(raw, "agentToolPrefix", errors);
  if (
    agentToolPrefix !== undefined
    && (!/^[a-z][a-z0-9_]{0,15}$/.test(agentToolPrefix) || agentToolPrefix.endsWith("_") || /^haven(?:_|$)/.test(agentToolPrefix))
  ) {
    errors.push(
      `App definition agentToolPrefix must be 1-16 lowercase letters, digits or "_", start with a letter and not be "haven", received ${JSON.stringify(agentToolPrefix)}.`,
    );
  }

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
      allowMotion,
      allowWebRtc,
      allowWorkers,
      agentToolPrefix,
      permissions,
      launchParameters,
      defaultLaunchDatabaseId,
      databases,
      listing,
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
