/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";

import type { MindooDBAppDefinition } from "../appDefinition";

import {
  capabilitiesForDefinitionPermissions,
  createBrowserTestHost,
  mockDatabasesFromDefinition,
  mountHavenTestHost,
  previewJson,
  readTestHostUrlSettings,
  type BrowserTestHost,
} from "./browserTestHost";

const PROTOCOL = "mindoodb-app-bridge";

function connect(testHost: BrowserTestHost, frame: HTMLIFrameElement) {
  const channel = new MessageChannel();
  const connected = new Promise<void>((resolve) => {
    channel.port1.onmessage = (event) => {
      if ((event.data as { type?: string }).type === "mindoodb-app:connected") resolve();
    };
  });
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { protocol: PROTOCOL, type: "mindoodb-app:connect", launchId: testHost.host.launchId },
      source: frame.contentWindow,
      ports: [channel.port2],
    }),
  );
  return { port: channel.port1, connected };
}

function call(port: MessagePort, id: string, method: string, params: unknown) {
  return new Promise<{ kind: string; result?: unknown }>((resolve) => {
    const previous = port.onmessage;
    port.onmessage = (event) => {
      const data = event.data as { kind?: string; id?: string };
      if (data.id === id) {
        port.onmessage = previous;
        resolve(data as { kind: string; result?: unknown });
      }
    };
    port.postMessage({ protocol: PROTOCOL, kind: "request", id, method, params });
  });
}

describe("browser test host", () => {
  let testHost: BrowserTestHost | null = null;

  afterEach(() => {
    testHost?.dispose();
    testHost = null;
    document.body.replaceChildren();
  });

  it("maps definition permissions onto the capabilities Haven grants", () => {
    expect(capabilitiesForDefinitionPermissions(["write", "attachments"])).toEqual([
      "read",
      "create",
      "update",
      "attachments",
    ]);
    expect(
      mockDatabasesFromDefinition({ databases: [{ logicalDatabaseId: "main", permissions: ["write"] }] })[0]?.info,
    ).toEqual({ id: "main", title: "main", capabilities: ["read", "create", "update"] });
  });

  it("frames the app with a launch id and answers its handshake", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    testHost = createBrowserTestHost({ frame, appUrl: "https://app.example.com/" });

    expect(frame.src).toBe(`https://app.example.com/?mindoodbAppLaunchId=${testHost.host.launchId}`);
    const { connected } = connect(testHost, frame);
    await connected;
  });

  it("ignores handshakes from other windows", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    testHost = createBrowserTestHost({ frame, appUrl: "https://app.example.com/" });
    const channel = new MessageChannel();
    let answered = false;
    channel.port1.onmessage = () => {
      answered = true;
    };
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { protocol: PROTOCOL, type: "mindoodb-app:connect", launchId: testHost.host.launchId },
        source: window,
        ports: [channel.port2],
      }),
    );
    expect(answered).toBe(false);
  });

  it("records notifications and scripts scans", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    testHost = createBrowserTestHost({
      frame,
      appUrl: "https://app.example.com/",
      databases: mockDatabasesFromDefinition({
        databases: [{ logicalDatabaseId: "main", permissions: ["write", "attachments"] }],
      }),
    });
    const { port, connected } = connect(testHost, frame);
    await connected;

    await call(port, "1", "notifications.show", { severity: "info", text: "Saved" });
    expect(testHost.log.notifications).toEqual([
      { id: undefined, severity: "info", text: "Saved", durationMs: undefined },
    ]);

    const cancelled = await call(port, "2", "attachments.scanAndWrite", { databaseId: "main", docId: "d1" });
    expect(cancelled.result).toEqual({ ok: false });

    testHost.setNextScan({ fileName: "receipt.pdf", mimeType: "application/pdf", size: 42 });
    const scanned = await call(port, "3", "attachments.scanAndWrite", { databaseId: "main", docId: "d1" });
    expect(scanned.result).toMatchObject({ ok: true, attachment: { fileName: "receipt.pdf", size: 42 } });
    expect(testHost.log.scans.map((scan) => scan.result)).toEqual(["cancelled", "scanned"]);
  });

  it("writes scanned bytes to the document and answers from the scan mode", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    testHost = createBrowserTestHost({
      frame,
      appUrl: "https://app.example.com/",
      scanMode: "sample",
      databases: mockDatabasesFromDefinition({
        databases: [{ logicalDatabaseId: "main", permissions: ["write", "attachments"] }],
      }),
    });
    const { port, connected } = connect(testHost, frame);
    await connected;

    testHost.setNextScan({ fileName: "page.png", mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) });
    const first = await call(port, "1", "attachments.scanAndWrite", { databaseId: "main", docId: "d1" });
    expect(first.result).toMatchObject({ ok: true, attachment: { fileName: "page.png", size: 3 } });
    // no pending scan: the sample page (a tiny PNG without a canvas), named as the app asked
    const second = await call(port, "2", "attachments.scanAndWrite", {
      databaseId: "main",
      docId: "d1",
      defaultFileName: "scan-1.jpg",
    });
    expect(second.result).toMatchObject({ ok: true, attachment: { fileName: "scan-1.jpg" } });
    const db = await testHost.host.session.openDatabase("main");
    expect((await db.attachments.list("d1")).map((a) => a.fileName)).toEqual(["page.png", "scan-1.jpg"]);
    expect(testHost.log.responses["1"]).toMatchObject({ ok: true });
  });

  it("refuses scans without attachments and update when capabilities are enforced", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    testHost = createBrowserTestHost({
      frame,
      appUrl: "https://app.example.com/",
      enforceCapabilities: true,
      scanMode: "sample",
      databases: mockDatabasesFromDefinition({ databases: [{ logicalDatabaseId: "main", permissions: ["attachments"] }] }),
    });
    const { port, connected } = connect(testHost, frame);
    await connected;
    const answer = await call(port, "1", "attachments.scanAndWrite", { databaseId: "main", docId: "d1" });
    expect(answer.kind).toBe("error");
    expect(testHost.log.responses["1"]).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("maps definitions with overrides", () => {
    const definition: Pick<MindooDBAppDefinition, "databases"> = {
      databases: [
        { logicalDatabaseId: "main", permissions: ["write"] },
        { logicalDatabaseId: "archive", permissions: ["write"] },
      ],
    };
    const mapped = mockDatabasesFromDefinition(definition, {}, {
      overrides: { main: { capabilities: ["read"], title: "Main" }, archive: { mapped: false } },
    });
    expect(mapped.map((d) => d.info)).toEqual([{ id: "main", title: "Main", capabilities: ["read"] }]);
  });

  it("reads scenarios from the URL", () => {
    expect(readTestHostUrlSettings("?db=main:read,attachments,bogus&db=archive:none&enforce=1&users=120&locale=de-DE&theme=dark")).toEqual({
      overrides: { main: { capabilities: ["read", "attachments"] }, archive: { mapped: false } },
      enforceCapabilities: true,
      directoryUserCount: 120,
      locale: "de-DE",
      theme: "dark",
    });
  });

  it("previews binary and long values in the request log", () => {
    const text = previewJson({ bytes: new Uint8Array(40), long: "x".repeat(500), list: Array.from({ length: 40 }, (_, i) => i) });
    expect(text).toContain("<40 bytes: 00 00");
    expect(text).toContain("(500 chars)");
    expect(text).toContain("… 10 more");
  });

  it("mounts the panel from URL settings and toggles capabilities", async () => {
    window.history.replaceState(null, "", "/__haven-test/?db=main:read&users=5&enforce=1");
    testHost = mountHavenTestHost({
      appUrl: "https://app.example.com/",
      databases: mockDatabasesFromDefinition({ databases: [{ logicalDatabaseId: "main", permissions: ["write"] }] }),
    });
    expect(testHost.host.listDatabases()[0]?.capabilities).toEqual(["read"]);
    expect(testHost.host.getEnforceCapabilities()).toBe(true);
    expect(testHost.host.getDirectoryUsers()).toHaveLength(5);

    const create = document.querySelector<HTMLInputElement>('[data-testid="haven-test-cap-main-create"]')!;
    create.checked = true;
    create.dispatchEvent(new Event("change"));
    expect(testHost.host.listDatabases()[0]?.capabilities).toEqual(["read", "create"]);
    expect(new URLSearchParams(window.location.search).getAll("db")).toEqual(["main:read,create"]);
    window.history.replaceState(null, "", "/");
  });
});
