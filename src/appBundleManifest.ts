/**
 * Shared description of a built application bundle that a MindooDB host can install
 * and update from a URL.
 *
 * The build side (`mindoodb-app-sdk/vite`) writes the manifest, the host side reads and
 * validates it. Both import this module so the format has exactly one definition.
 */

export const MINDOODB_APP_BUNDLE_MANIFEST_FORMAT = "mindoodb.app.bundle";
export const MINDOODB_APP_BUNDLE_MANIFEST_VERSION = 1;

export const MINDOODB_APP_BUNDLE_MANIFEST_FILE_NAME = "haven-bundle.json";
export const MINDOODB_APP_BUNDLE_ARCHIVE_FILE_NAME = "haven-bundle.zip";

/** A `sha256-<64 lowercase hex chars>` digest string. */
export type MindooDBAppBundleHash = string;

export interface MindooDBAppBundleFileEntry {
  /** Bundle-relative POSIX path, e.g. `assets/index-a1b2c3.js`. */
  path: string;
  hash: MindooDBAppBundleHash;
  size: number;
}

export interface MindooDBAppBundleArchive {
  /** Path of the archive relative to the manifest URL. */
  path: string;
  hash: MindooDBAppBundleHash;
  size: number;
}

export interface MindooDBAppBundleManifest {
  format: typeof MINDOODB_APP_BUNDLE_MANIFEST_FORMAT;
  formatVersion: number;
  /** Stable identifier of the application, used to detect a swapped bundle source. */
  appId: string;
  /** Human-readable version. Informational only — updates key off `contentHash`. */
  version: string;
  /** Entry HTML file, always present in `files`. */
  entry: string;
  archive: MindooDBAppBundleArchive;
  /** Identity of the bundle: a digest over the sorted file list. */
  contentHash: MindooDBAppBundleHash;
  generatedAt: string;
  files: MindooDBAppBundleFileEntry[];
}

const SHA256_PATTERN = /^sha256-[0-9a-f]{64}$/;

export function isMindooDBAppBundleHash(value: unknown): value is MindooDBAppBundleHash {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function hasUnsafePathSegments(path: string) {
  return path.split("/").some((segment) => segment === ".." || segment === "." || segment.length === 0);
}

/**
 * Mirrors the host-side path rules: POSIX separators, no leading slash, no `.`/`..`
 * segments and no empty segments. Returns `null` for paths that must be rejected.
 */
export function normalizeMindooDBAppBundlePath(rawPath: unknown): string | null {
  if (typeof rawPath !== "string") {
    return null;
  }

  const normalized = rawPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || hasUnsafePathSegments(normalized)) {
    return null;
  }

  return normalized;
}

/**
 * Canonical byte input for `contentHash`. Both the build and the host derive the digest
 * from this exact string so a mismatch always means the content really differs.
 */
export function buildMindooDBAppBundleContentHashInput(
  files: readonly Pick<MindooDBAppBundleFileEntry, "path" | "hash">[],
): string {
  return [...files]
    .map((file) => `${file.path}\u0000${file.hash}`)
    .sort()
    .join("\n");
}

export interface MindooDBAppBundleManifestValidation {
  manifest: MindooDBAppBundleManifest | null;
  errors: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Structural validation only — it does not verify any digest. Callers still have to
 * compare `contentHash` and the per-file hashes against the bytes they downloaded.
 */
export function validateMindooDBAppBundleManifest(
  raw: unknown,
): MindooDBAppBundleManifestValidation {
  const errors: string[] = [];

  if (!isPlainObject(raw)) {
    return { manifest: null, errors: ["Bundle manifest must be a JSON object."] };
  }

  if (raw.format !== MINDOODB_APP_BUNDLE_MANIFEST_FORMAT) {
    errors.push(
      `Bundle manifest format must be "${MINDOODB_APP_BUNDLE_MANIFEST_FORMAT}", received ${JSON.stringify(raw.format)}.`,
    );
  }

  if (raw.formatVersion !== MINDOODB_APP_BUNDLE_MANIFEST_VERSION) {
    errors.push(
      `Unsupported bundle manifest version ${JSON.stringify(raw.formatVersion)}, expected ${MINDOODB_APP_BUNDLE_MANIFEST_VERSION}.`,
    );
  }

  if (typeof raw.appId !== "string" || !raw.appId.trim()) {
    errors.push("Bundle manifest is missing a non-empty appId.");
  }

  if (typeof raw.version !== "string" || !raw.version.trim()) {
    errors.push("Bundle manifest is missing a non-empty version.");
  }

  if (!isMindooDBAppBundleHash(raw.contentHash)) {
    errors.push("Bundle manifest contentHash must be a sha256-<hex> digest.");
  }

  if (typeof raw.generatedAt !== "string" || Number.isNaN(Date.parse(raw.generatedAt))) {
    errors.push("Bundle manifest generatedAt must be an ISO timestamp.");
  }

  const archive = raw.archive;
  if (!isPlainObject(archive)) {
    errors.push("Bundle manifest is missing an archive descriptor.");
  } else {
    if (!normalizeMindooDBAppBundlePath(archive.path)) {
      errors.push(`Bundle manifest archive path ${JSON.stringify(archive.path)} is not a safe relative path.`);
    }
    if (!isMindooDBAppBundleHash(archive.hash)) {
      errors.push("Bundle manifest archive hash must be a sha256-<hex> digest.");
    }
    if (!validateSize(archive.size)) {
      errors.push("Bundle manifest archive size must be a non-negative integer.");
    }
  }

  const files = raw.files;
  const normalizedFiles: MindooDBAppBundleFileEntry[] = [];
  if (!Array.isArray(files) || files.length === 0) {
    errors.push("Bundle manifest must list at least one file.");
  } else {
    const seen = new Set<string>();
    files.forEach((file, index) => {
      if (!isPlainObject(file)) {
        errors.push(`Bundle manifest file #${index} must be an object.`);
        return;
      }
      const path = normalizeMindooDBAppBundlePath(file.path);
      if (!path) {
        errors.push(`Bundle manifest file #${index} has an unsafe path ${JSON.stringify(file.path)}.`);
        return;
      }
      if (seen.has(path)) {
        errors.push(`Bundle manifest lists "${path}" more than once.`);
        return;
      }
      if (!isMindooDBAppBundleHash(file.hash)) {
        errors.push(`Bundle manifest file "${path}" must carry a sha256-<hex> digest.`);
        return;
      }
      if (!validateSize(file.size)) {
        errors.push(`Bundle manifest file "${path}" must carry a non-negative integer size.`);
        return;
      }
      seen.add(path);
      normalizedFiles.push({ path, hash: file.hash, size: file.size });
    });
  }

  const entry = normalizeMindooDBAppBundlePath(raw.entry);
  if (!entry) {
    errors.push(`Bundle manifest entry ${JSON.stringify(raw.entry)} is not a safe relative path.`);
  } else if (!entry.toLowerCase().endsWith(".html")) {
    errors.push(`Bundle manifest entry "${entry}" must be an HTML file.`);
  } else if (normalizedFiles.length && !normalizedFiles.some((file) => file.path === entry)) {
    errors.push(`Bundle manifest entry "${entry}" is not part of the file list.`);
  }

  if (errors.length) {
    return { manifest: null, errors };
  }

  const validated = raw as unknown as MindooDBAppBundleManifest;

  return {
    manifest: {
      format: MINDOODB_APP_BUNDLE_MANIFEST_FORMAT,
      formatVersion: MINDOODB_APP_BUNDLE_MANIFEST_VERSION,
      appId: validated.appId.trim(),
      version: validated.version.trim(),
      entry: entry as string,
      archive: {
        path: normalizeMindooDBAppBundlePath((archive as Record<string, unknown>).path) as string,
        hash: (archive as Record<string, unknown>).hash as string,
        size: (archive as Record<string, unknown>).size as number,
      },
      contentHash: validated.contentHash,
      generatedAt: validated.generatedAt,
      files: normalizedFiles,
    },
    errors: [],
  };
}
