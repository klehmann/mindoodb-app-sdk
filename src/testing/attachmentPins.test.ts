import { afterEach, describe, expect, it } from "vitest";

import { describeAttachmentAvailability, formatAttachmentBytes } from "../attachmentAvailability";
import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import type {
  MindooDBAppAttachmentAvailability,
  MindooDBAppAttachmentInfo,
  MindooDBAppAttachmentStorage,
} from "../types";
import { createFakeBridgeHost } from "./index";

const FILES: MindooDBAppAttachmentInfo[] = [
  { attachmentId: "a1", fileName: "deck.pptx", mimeType: "application/vnd.ms-powerpoint", size: 4_000_000 },
  { attachmentId: "a2", fileName: "notes.txt", mimeType: "text/plain", size: 1_000 },
];

function hostWith(storage: MindooDBAppAttachmentStorage, overrides: Record<string, unknown> = {}) {
  return createFakeBridgeHost({
    databases: [
      {
        info: { id: "main", title: "Main", capabilities: ["read", "attachments"], attachmentStorage: storage },
        methods: {
          attachments: {
            async list() {
              return FILES;
            },
            ...overrides,
          },
        },
      },
    ],
  });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("attachment pins over the bridge", () => {
  let host: ReturnType<typeof createFakeBridgeHost> | null = null;
  afterEach(() => {
    host?.dispose();
    host = null;
  });

  it("reports attachmentStorage and pins a file with download progress", async () => {
    host = hostWith("onDemand");
    host.install();
    const session = await createMindooDBAppBridge().connect();
    const db = await session.openDatabase("main");
    expect((await db.info()).attachmentStorage).toBe("onDemand");

    expect(await db.attachments.availability([{ docId: "d1" }])).toEqual([
      { docId: "d1", attachmentId: "a1", state: "remote", bytesLocal: 0, size: 4_000_000, pinned: false },
      { docId: "d1", attachmentId: "a2", state: "remote", bytesLocal: 0, size: 1_000, pinned: false },
    ]);

    const events: MindooDBAppAttachmentAvailability[] = [];
    const subscription = await db.attachments.onAvailabilityChange((event) => events.push(event));

    await expect(db.attachments.pin("d1", "deck.pptx")).resolves.toEqual({ state: "queued", bytes: 4_000_000 });
    await tick();
    expect(events.map((event) => [event.attachmentId, event.state, event.bytesLocal])).toEqual([
      ["a1", "queued", 0],
      ["a1", "downloading", 2_000_000],
      ["a1", "local", 4_000_000],
    ]);
    expect(await db.attachments.listPins()).toEqual([
      { docId: "d1", attachmentId: "a1", pinnedAt: expect.any(String) },
    ]);
    expect(await db.attachments.availability([{ docId: "d1", attachmentName: "a1" }])).toEqual([
      { docId: "d1", attachmentId: "a1", state: "local", bytesLocal: 4_000_000, size: 4_000_000, pinned: true },
    ]);

    // Pinning again finds everything local.
    await expect(db.attachments.pin("d1", "a1")).resolves.toEqual({ state: "local", bytes: 4_000_000 });

    await db.attachments.unpin("d1", "a1");
    await tick();
    expect(events.at(-1)).toMatchObject({ attachmentId: "a1", state: "remote", pinned: false });
    expect(await db.attachments.listPins()).toEqual([]);

    await subscription.dispose();
    await db.attachments.pin("d1");
    await tick();
    expect(events.at(-1)).toMatchObject({ state: "remote" });
    expect(host.requests.some((request) => request.method === "attachments.availability.unsubscribe")).toBe(true);
  });

  it("pins a whole document", async () => {
    host = hostWith("onDemand");
    host.install();
    const db = await (await createMindooDBAppBridge().connect()).openDatabase("main");

    await expect(db.attachments.pin("d1")).resolves.toEqual({ state: "queued", bytes: 4_001_000 });
    await tick();
    expect((await db.attachments.availability([{ docId: "d1" }])).map((row) => [row.state, row.pinned])).toEqual([
      ["local", true],
      ["local", true],
    ]);
    expect(await db.attachments.listPins()).toEqual([{ docId: "d1", pinnedAt: expect.any(String) }]);
  });

  it("has everything local in a local database and refuses pins on a server database", async () => {
    host = hostWith("local");
    host.install();
    let db = await (await createMindooDBAppBridge().connect()).openDatabase("main");
    expect((await db.attachments.availability([{ docId: "d1" }])).every((row) => row.state === "local")).toBe(true);
    await expect(db.attachments.pin("d1", "a1")).resolves.toEqual({ state: "local", bytes: 4_000_000 });
    host.dispose();

    host = hostWith("remote");
    host.install();
    db = await (await createMindooDBAppBridge().connect()).openDatabase("main");
    await expect(db.attachments.pin("d1", "a1")).rejects.toMatchObject({ name: "unsupported" });
  });

  it("degrades on a host that predates pins", async () => {
    const methodNotFound = async () => {
      const error = new Error("Unknown method");
      error.name = "method-not-found";
      throw error;
    };
    host = hostWith("local", {
      pin: methodNotFound,
      unpin: methodNotFound,
      availability: methodNotFound,
      listPins: methodNotFound,
      onAvailabilityChange: methodNotFound,
    });
    host.install();
    const db = await (await createMindooDBAppBridge().connect()).openDatabase("main");

    await expect(db.attachments.pin("d1", "a1")).rejects.toMatchObject({ name: "unsupported" });
    await expect(db.attachments.unpin("d1", "a1")).resolves.toEqual({ ok: true });
    await expect(db.attachments.listPins()).resolves.toEqual([]);
    expect((await db.attachments.availability([{ docId: "d1", attachmentName: "notes.txt" }]))).toEqual([
      { docId: "d1", attachmentId: "a2", state: "local", bytesLocal: 1_000, size: 1_000, pinned: false },
    ]);
    const subscription = await db.attachments.onAvailabilityChange(() => {});
    await subscription.dispose();
  });
});

describe("describeAttachmentAvailability", () => {
  const row = (overrides: Partial<MindooDBAppAttachmentAvailability>): MindooDBAppAttachmentAvailability => ({
    docId: "d1",
    attachmentId: "a1",
    state: "local",
    bytesLocal: 0,
    size: 48 * 1024 * 1024,
    pinned: false,
    ...overrides,
  });

  it("marks remote, downloading, pinned and failed rows", () => {
    expect(describeAttachmentAvailability(row({ state: "remote" }), "onDemand", "de-AT")).toEqual({
      icon: "cloud",
      label: "Nur auf dem Server. Zum Öffnen ist eine Verbindung nötig.",
      progress: null,
      action: { kind: "pin", label: "Offline verfügbar machen" },
    });
    expect(
      describeAttachmentAvailability(
        row({ state: "downloading", bytesLocal: 12 * 1024 * 1024, pinned: true }),
        "onDemand",
        "de",
      ),
    ).toMatchObject({
      icon: "download",
      label: "Wird geladen: 12 MB von 48 MB",
      progress: 0.25,
      action: { kind: "unpin" },
    });
    expect(describeAttachmentAvailability(row({ pinned: true }), "onDemand", "fr")).toMatchObject({
      icon: "pin",
      action: { kind: "unpin", label: "Ne plus conserver hors ligne" },
    });
    expect(describeAttachmentAvailability(row({ state: "error" }), "onDemand", "fr").label).toBe(
      "Échec du téléchargement, nouvel essai à la prochaine synchronisation",
    );
  });

  it("shows nothing and offers no action where attachments are local anyway", () => {
    expect(describeAttachmentAvailability(row({ pinned: true }), "local", "xx")).toEqual({
      icon: null,
      label: "On this device",
      progress: null,
      action: null,
    });
    expect(describeAttachmentAvailability(row({ state: "remote" }), "remote", "nn").action).toBeNull();
  });

  it("formats sizes per language", () => {
    expect(formatAttachmentBytes(1536, "de")).toBe("1,5 KB");
    expect(formatAttachmentBytes(512, "en")).toBe("512 B");
  });
});
