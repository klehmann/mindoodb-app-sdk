import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MINDOODB_APP_BUNDLE_ARCHIVE_FILE_NAME,
  MINDOODB_APP_BUNDLE_MANIFEST_FILE_NAME,
} from "../appBundleManifest";
import { havenBundle } from "./index";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "haven-bundle-"));
  roots.push(root);
  return root;
}

describe("havenBundle", () => {
  it("does not throw when closeBundle runs before outDir exists", async () => {
    const plugin = havenBundle({ appId: "demo", version: "1.0.0" });
    plugin.configResolved({
      root: tempRoot(),
      build: { outDir: "dist" },
    });
    await expect(plugin.closeBundle()).resolves.toBeUndefined();
  });

  it("writes the manifest and zip from writeBundle once outDir exists", async () => {
    const root = tempRoot();
    const outDir = path.join(root, "dist");
    mkdirSync(outDir);
    writeFileSync(path.join(outDir, "index.html"), "<!doctype html><title>demo</title>");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "demo-app", version: "1.2.3" }),
    );

    const plugin = havenBundle();
    plugin.configResolved({ root, build: { outDir: "dist" } });
    await plugin.writeBundle();
    await plugin.closeBundle();

    const manifest = JSON.parse(
      readFileSync(path.join(outDir, MINDOODB_APP_BUNDLE_MANIFEST_FILE_NAME), "utf8"),
    ) as { appId: string; version: string; entry: string };
    expect(manifest).toMatchObject({
      appId: "demo-app",
      version: "1.2.3",
      entry: "index.html",
    });
    expect(readFileSync(path.join(outDir, MINDOODB_APP_BUNDLE_ARCHIVE_FILE_NAME)).byteLength).toBeGreaterThan(0);
  });
});
