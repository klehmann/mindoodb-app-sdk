import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createZipArchive, isPrecompressedPath } from "./zip";

const workDir = mkdtempSync(path.join(tmpdir(), "haven-bundle-zip-"));

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeArchive(name: string, archive: Buffer) {
  const archivePath = path.join(workDir, name);
  writeFileSync(archivePath, archive);
  return archivePath;
}

describe("createZipArchive", () => {
  it("produces an archive that a standard reader accepts", () => {
    const compressible = "x".repeat(4096);
    const archive = createZipArchive([
      { path: "index.html", data: Buffer.from("<!doctype html><title>a</title>", "utf8") },
      { path: "assets/app.js", data: Buffer.from(compressible, "utf8") },
      { path: "node-icons/circle.svg", data: Buffer.from("<svg />", "utf8") },
    ]);

    const archivePath = writeArchive("basic.zip", archive);
    expect(() => execFileSync("unzip", ["-t", archivePath])).not.toThrow();

    const extracted = execFileSync("unzip", ["-p", archivePath, "assets/app.js"]).toString("utf8");
    expect(extracted).toBe(compressible);

    const listing = execFileSync("unzip", ["-Z", "-1", archivePath]).toString("utf8").trim().split("\n");
    expect(listing.sort()).toEqual(["assets/app.js", "index.html", "node-icons/circle.svg"]);
  });

  it("round-trips binary payloads byte for byte", () => {
    const binary = Buffer.from(Array.from({ length: 1024 }, (_unused, index) => index % 256));
    const archive = createZipArchive([{ path: "assets/logo.png", data: binary }]);
    const archivePath = writeArchive("binary.zip", archive);

    const extracted = execFileSync("unzip", ["-p", archivePath, "assets/logo.png"]);
    expect(Buffer.compare(extracted, binary)).toBe(0);
  });

  it("is byte-stable across runs so the archive hash only changes with content", () => {
    const entries = [{ path: "index.html", data: Buffer.from("<!doctype html>", "utf8") }];
    expect(Buffer.compare(createZipArchive(entries), createZipArchive(entries))).toBe(0);
  });

  it("stores already-compressed payloads instead of deflating them", () => {
    expect(isPrecompressedPath("assets/logo.png")).toBe(true);
    expect(isPrecompressedPath("assets/font.woff2")).toBe(true);
    expect(isPrecompressedPath("assets/app.js")).toBe(false);
    expect(isPrecompressedPath("LICENSE")).toBe(false);
  });
});
