/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";

import {
  capabilitiesForDefinitionPermissions,
  createBrowserTestHost,
  mockDatabasesFromDefinition,
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
});
