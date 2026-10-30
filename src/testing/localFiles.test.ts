// @vitest-environment jsdom
/**
 * `session.localFiles` in the mock session and over the real bridge port
 * (`createFakeBridgeHost`), which is what an app's code talks to in the test host.
 */
import { describe, expect, it } from "vitest";

import { validateMindooDBAppDefinition } from "../appDefinition";
import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import { localFileNameProblem } from "../localFiles";
import { createFakeBridgeHost, createMockMindooDBAppSession } from "./index";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const bytes = (value: string) => new TextEncoder().encode(value);

describe("local file names", () => {
  it("takes path segments of letters, digits, dot, underscore and dash", () => {
    expect(localFileNameProblem("areas/karlsruhe-1.pmtiles")).toBeNull();
    for (const bad of ["", "/a", "a//b", "a/../b", "./a", "a b", "ä", "a".repeat(201)]) {
      expect(localFileNameProblem(bad), bad).not.toBeNull();
    }
  });
});

describe("allowFiles in the app definition", () => {
  const base = { format: "mindoodb.haven.app", formatVersion: 1, appId: "test-app", label: "Test", runtime: "iframe" };
  it("accepts true and the object form", () => {
    expect(validateMindooDBAppDefinition({ ...base, allowFiles: true }).definition?.allowFiles).toBe(true);
    const parsed = validateMindooDBAppDefinition({ ...base, allowFiles: { purpose: { en: "Offline maps", de: "Offline-Karten" }, backup: "perFile" } });
    expect(parsed.definition?.allowFiles).toEqual({ purpose: { en: "Offline maps", de: "Offline-Karten" }, backup: "perFile" });
  });
  it("rejects other backup values", () => {
    expect(validateMindooDBAppDefinition({ ...base, allowFiles: { backup: "sometimes" } }).errors.join()).toMatch(/allowFiles.backup/);
  });
});

describe("mock session localFiles", () => {
  it("writes pieces at offsets, reads ranges, lists and removes", async () => {
    const mock = createMockMindooDBAppSession();
    const files = mock.session.localFiles;
    expect(await files.state()).toBe("available");
    const writer = await files.create("areas/a.bin", { size: 10, backup: true });
    await writer.write(bytes("world"), 5);
    await writer.write(bytes("hello"), 0);
    const info = await writer.close();
    expect(info).toMatchObject({ name: "areas/a.bin", size: 10, backup: true });
    const reader = await files.open("areas/a.bin");
    expect(text(await reader.read(0, 5))).toBe("hello");
    expect((await reader.readMany([[5, 5], [8, 10]])).map(text)).toEqual(["world", "ld"]);
    expect((await files.list("areas/")).map((file) => file.name)).toEqual(["areas/a.bin"]);
    expect(await files.estimate()).toMatchObject({ used: 10 });
    await files.remove("areas/a.bin");
    expect(await files.stat("areas/a.bin")).toBeNull();
    await expect(files.open("areas/a.bin")).rejects.toMatchObject({ code: "not-found" });
  });

  it("keeps an unfinished file invisible and refuses what does not fit", async () => {
    const mock = createMockMindooDBAppSession();
    const files = mock.session.localFiles;
    const writer = await files.create("x", { size: 4 });
    await writer.write(bytes("ab"), 0);
    expect(await files.stat("x")).toBeNull();
    await writer.abort();
    await expect(writer.write(bytes("c"), 2)).rejects.toMatchObject({ code: "closed" });
    mock.setLocalFilesAvailable(100);
    await expect(files.create("big", { size: 101 })).rejects.toMatchObject({ code: "no-space" });
    mock.setLocalFilesState("locked");
    expect(await files.state()).toBe("locked");
    await expect(files.list()).rejects.toMatchObject({ code: "locked" });
  });
});

describe("localFiles over the bridge", () => {
  it("round-trips writes and reads through handles", async () => {
    const host = createFakeBridgeHost();
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      const writer = await session.localFiles.create("maps/b.pmtiles", { size: 8 });
      await writer.write(new Uint8Array([1, 2, 3, 4]), 4);
      await writer.write(new Uint8Array([9, 9, 9, 9]).buffer, 0);
      await writer.close();
      const reader = await session.localFiles.open("maps/b.pmtiles");
      expect(reader.size).toBe(8);
      expect([...(await reader.read(2, 4))]).toEqual([9, 9, 1, 2]);
      await reader.close();
      await expect(reader.read(0, 1)).rejects.toMatchObject({ code: "closed" });
      await expect(session.localFiles.open("missing")).rejects.toMatchObject({ code: "not-found" });
      await expect(session.localFiles.create("../x", { size: 1 })).rejects.toMatchObject({ code: "invalid" });
    } finally {
      host.dispose();
    }
  });

  it("reports the state Haven starts in", async () => {
    const host = createFakeBridgeHost({ localFiles: { state: "not-allowed" } });
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      expect(await session.localFiles.state()).toBe("not-allowed");
      await expect(session.localFiles.list()).rejects.toMatchObject({ code: "not-allowed" });
    } finally {
      host.dispose();
    }
  });
});
