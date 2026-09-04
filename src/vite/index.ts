import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  MINDOODB_APP_BUNDLE_ARCHIVE_FILE_NAME,
  MINDOODB_APP_BUNDLE_MANIFEST_FILE_NAME,
  MINDOODB_APP_BUNDLE_MANIFEST_FORMAT,
  MINDOODB_APP_BUNDLE_MANIFEST_VERSION,
  buildMindooDBAppBundleContentHashInput,
  type MindooDBAppBundleFileEntry,
  type MindooDBAppBundleManifest,
} from "../appBundleManifest";
import { createZipArchive } from "./zip";

export type { MindooDBAppBundleManifest } from "../appBundleManifest";

/**
 * Files that must never ship inside a hosted bundle. The host serves the bundle from its
 * own service worker, so an app-owned service worker would either fail to register in the
 * opaque-origin iframe or fight the host for control of the scope. `_headers` and
 * `_redirects` are instructions to the app's own static host and mean nothing once the
 * assets live in the host's cache.
 */
const DEFAULT_EXCLUDED_ROOT_FILES = new Set([
  "sw.js",
  "sw.js.map",
  "registerSW.js",
  "_headers",
  "_redirects",
  MINDOODB_APP_BUNDLE_MANIFEST_FILE_NAME,
  MINDOODB_APP_BUNDLE_ARCHIVE_FILE_NAME,
]);

const WORKBOX_RUNTIME_PATTERN = /^workbox-[a-z0-9]+\.js(\.map)?$/i;

export interface HavenBundleOptions {
  /**
   * Stable application identifier written to the manifest. Defaults to the `name` field
   * of the project's package.json.
   */
  appId?: string;
  /**
   * Human-readable version. Defaults to the `version` field of the project's
   * package.json. Informational only — the host keys updates off the content hash.
   */
  version?: string;
  /**
   * Entry HTML file relative to the build output directory. Auto-detected when omitted:
   * root `index.html`, else a nested `index.html`, else the first HTML file.
   */
  entry?: string;
  /**
   * Additional exclusion predicate, evaluated with the bundle-relative POSIX path. Return
   * `true` to keep the file out of the bundle.
   */
  exclude?: (relativePath: string) => boolean;
  /** Skip `.map` files. Defaults to `true` — source maps only bloat the download. */
  excludeSourcemaps?: boolean;
}

interface ResolvedViteConfig {
  root: string;
  build: { outDir: string };
}

/** Structural subset of Vite's `Plugin`, so the SDK does not need to depend on Vite. */
export interface HavenBundleVitePlugin {
  name: string;
  apply: "build";
  configResolved: (config: ResolvedViteConfig) => void;
  closeBundle: () => Promise<void>;
}

function sha256(data: Uint8Array | string) {
  return `sha256-${createHash("sha256").update(data).digest("hex")}`;
}

async function collectFiles(rootDir: string): Promise<string[]> {
  const collected: string[] = [];

  async function walk(currentDir: string, prefix: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(currentDir, entry.name), relativePath);
      } else if (entry.isFile()) {
        collected.push(relativePath);
      }
    }
  }

  await walk(rootDir, "");
  return collected.sort();
}

function isExcluded(relativePath: string, options: HavenBundleOptions) {
  const isRootLevel = !relativePath.includes("/");
  if (isRootLevel && DEFAULT_EXCLUDED_ROOT_FILES.has(relativePath)) {
    return true;
  }
  if (isRootLevel && WORKBOX_RUNTIME_PATTERN.test(relativePath)) {
    return true;
  }
  if (options.excludeSourcemaps !== false && relativePath.toLowerCase().endsWith(".map")) {
    return true;
  }
  return options.exclude?.(relativePath) === true;
}

function resolveEntryPath(paths: string[], configured?: string) {
  if (configured) {
    const normalized = configured.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!paths.includes(normalized)) {
      throw new Error(`[haven-bundle] Configured entry "${configured}" is not part of the build output.`);
    }
    return normalized;
  }

  const preferred = paths.find((candidate) => candidate.toLowerCase() === "index.html");
  if (preferred) {
    return preferred;
  }
  const nested = paths.find((candidate) => candidate.toLowerCase().endsWith("/index.html"));
  if (nested) {
    return nested;
  }
  const firstHtml = paths.find((candidate) => candidate.toLowerCase().endsWith(".html"));
  if (firstHtml) {
    return firstHtml;
  }

  throw new Error("[haven-bundle] The build output does not contain an HTML entry file.");
}

async function readPackageMetadata(root: string) {
  try {
    const raw = await readFile(path.join(root, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
    };
  } catch {
    return { name: undefined, version: undefined };
  }
}

/**
 * Emits `haven-bundle.json` and `haven-bundle.zip` next to the build output so a MindooDB
 * host can install and update the app from a URL.
 */
export function havenBundle(options: HavenBundleOptions = {}): HavenBundleVitePlugin {
  let resolvedConfig: ResolvedViteConfig | null = null;

  return {
    name: "haven-bundle",
    apply: "build",
    configResolved(config) {
      resolvedConfig = config;
    },
    async closeBundle() {
      if (!resolvedConfig) {
        throw new Error("[haven-bundle] Plugin ran without a resolved Vite config.");
      }

      const outDir = path.resolve(resolvedConfig.root, resolvedConfig.build.outDir);
      const allPaths = await collectFiles(outDir);
      const bundlePaths = allPaths.filter((candidate) => !isExcluded(candidate, options));

      if (!bundlePaths.length) {
        throw new Error(`[haven-bundle] No bundle files found in "${outDir}".`);
      }

      const entry = resolveEntryPath(bundlePaths, options.entry);
      const packageMetadata = await readPackageMetadata(resolvedConfig.root);
      const appId = options.appId ?? packageMetadata.name;
      const version = options.version ?? packageMetadata.version;

      if (!appId) {
        throw new Error("[haven-bundle] Unable to determine appId — pass it explicitly.");
      }
      if (!version) {
        throw new Error("[haven-bundle] Unable to determine version — pass it explicitly.");
      }

      const files: MindooDBAppBundleFileEntry[] = [];
      const archiveEntries: { path: string; data: Uint8Array }[] = [];

      for (const relativePath of bundlePaths) {
        const data = await readFile(path.join(outDir, relativePath));
        files.push({ path: relativePath, hash: sha256(data), size: data.byteLength });
        archiveEntries.push({ path: relativePath, data });
      }

      const archive = createZipArchive(archiveEntries);
      const manifest: MindooDBAppBundleManifest = {
        format: MINDOODB_APP_BUNDLE_MANIFEST_FORMAT,
        formatVersion: MINDOODB_APP_BUNDLE_MANIFEST_VERSION,
        appId,
        version,
        entry,
        archive: {
          path: MINDOODB_APP_BUNDLE_ARCHIVE_FILE_NAME,
          hash: sha256(archive),
          size: archive.byteLength,
        },
        contentHash: sha256(buildMindooDBAppBundleContentHashInput(files)),
        generatedAt: new Date().toISOString(),
        files,
      };

      await writeFile(path.join(outDir, MINDOODB_APP_BUNDLE_ARCHIVE_FILE_NAME), archive);
      await writeFile(
        path.join(outDir, MINDOODB_APP_BUNDLE_MANIFEST_FILE_NAME),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );

      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      console.log(
        `[haven-bundle] ${files.length} files (${(totalBytes / 1024 / 1024).toFixed(2)} MB) → ` +
          `${MINDOODB_APP_BUNDLE_ARCHIVE_FILE_NAME} (${(archive.byteLength / 1024 / 1024).toFixed(2)} MB), ` +
          `contentHash ${manifest.contentHash.slice(7, 19)}`,
      );
    },
  };
}
