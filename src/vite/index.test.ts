import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MINDOODB_APP_BUNDLE_ARCHIVE_FILE_NAME,
  MINDOODB_APP_BUNDLE_MANIFEST_FILE_NAME,
} from "../appBundleManifest";
import { havenBundle, havenTestRedirect } from "./index";

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

  it("injects share tags from haven-app.json, using the dev server origin while serving", async () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "public"));
    writeFileSync(
      path.join(root, "public", "haven-app.json"),
      JSON.stringify({
        label: "Vega",
        publicUrl: "https://app-vega.mindoodb.com",
        listing: { summary: "Plan trips.", icon: "listing/icon.webp" },
      }),
    );
    const plugin = havenBundle();
    plugin.configResolved({ root, command: "serve", build: { outDir: "dist" }, server: { host: "127.0.0.1", port: 4210 } });
    const served = await plugin.transformIndexHtml("<head><title>Old</title></head>", {});
    expect(served).toContain('<meta name="twitter:card" content="summary">');
    expect(served).toContain("http://127.0.0.1:4210/listing/icon.webp");
    expect(served).not.toContain("app-vega.mindoodb.com/listing");

    plugin.configResolved({ root, command: "build", build: { outDir: "dist" } });
    const built = await plugin.transformIndexHtml("<head><title>Old</title></head>", {});
    expect(built).toContain("https://app-vega.mindoodb.com/listing/icon.webp");
  });
});

describe("havenTestRedirect", () => {
  it("sends the test URL without trailing slash to the test host page", () => {
    expect(havenTestRedirect("/__haven-test")).toBe("/__haven-test/");
    expect(havenTestRedirect("/__haven-test?enforce=1&locale=de-DE")).toBe("/__haven-test/?enforce=1&locale=de-DE");
    expect(havenTestRedirect("/base/__haven-test")).toBe("/base/__haven-test/");
  });

  it("leaves every other URL alone", () => {
    for (const url of ["/__haven-test/", "/__haven-test/index.html", "/", "/__haven-tests", undefined]) {
      expect(havenTestRedirect(url)).toBeNull();
    }
  });

  it("answers the dev server with a redirect", () => {
    type Res = { statusCode: number; setHeader: (n: string, v: string) => void; end: () => void };
    let handler: ((req: { url?: string }, res: Res, next: () => void) => void) | undefined;
    havenBundle().configureServer({ middlewares: { use: (h) => void (handler = h) } });
    const headers: Record<string, string> = {};
    const res: Res = { statusCode: 200, setHeader: (n: string, v: string) => void (headers[n] = v), end: () => {} };
    let passed = false;
    handler!({ url: "/__haven-test?x=1" }, res, () => (passed = true));
    expect(res.statusCode).toBe(302);
    expect(headers.Location).toBe("/__haven-test/?x=1");
    handler!({ url: "/" }, res, () => (passed = true));
    expect(passed).toBe(true);
  });
});
