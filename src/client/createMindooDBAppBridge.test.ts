import { afterEach, describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "./createMindooDBAppBridge";
import type { MindooDBAppBridgePortMessage } from "../types";
import { createViewLanguage } from "../viewLanguage";

describe("createMindooDBAppBridge attachment streaming", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("forwards optional document decryptionKeyId on create", async () => {
    let createInput: unknown = null;
    const host = {
      postMessage(_message: unknown, _targetOrigin?: string, transfer?: Transferable[]) {
        const port = transfer?.[0] as MessagePort | undefined;
        if (!port) {
          throw new Error("Expected bridge connection port transfer.");
        }

        port.addEventListener("message", (event: MessageEvent<MindooDBAppBridgePortMessage>) => {
          const message = event.data;
          if (message.kind !== "request") {
            return;
          }
          if (message.method === "session.openDatabase") {
            port.postMessage({
              protocol: "mindoodb-app-bridge",
              kind: "success",
              id: message.id,
              result: { ok: true },
            });
            return;
          }
          if (message.method === "documents.create") {
            createInput = (message.params as { input: unknown }).input;
            port.postMessage({
              protocol: "mindoodb-app-bridge",
              kind: "success",
              id: message.id,
              result: {
                id: "doc-1",
                data: {
                  title: "Secret",
                },
                attachments: [],
              },
            });
          }
        });
        port.start();
        port.postMessage({
          protocol: "mindoodb-app-bridge",
          type: "mindoodb-app:connected",
        });
      },
    };

    Object.defineProperty(globalThis, "window", {
      value: {
        parent: host,
        opener: null,
        location: {
          search: "?mindoodbAppLaunchId=launch-create",
        },
        setTimeout,
        clearTimeout,
      },
      configurable: true,
    });

    const session = await createMindooDBAppBridge().connect();
    const database = await session.openDatabase("main");
    await expect(database.documents.create({
      data: {
        title: "Secret",
      },
      decryptionKeyId: "payroll",
    })).resolves.toEqual({
      id: "doc-1",
      data: {
        title: "Secret",
      },
      attachments: [],
    });

    expect(createInput).toEqual({
      data: {
        title: "Secret",
      },
      decryptionKeyId: "payroll",
    });
  });

  it("streams attachment uploads and downloads over the bridge port", async () => {
    let writeChunk: Uint8Array | null = null;
    let readRequests = 0;
    let removedAttachmentName: string | null = null;

    const host = {
      postMessage(_message: unknown, _targetOrigin?: string, transfer?: Transferable[]) {
        const port = transfer?.[0] as MessagePort | undefined;
        if (!port) {
          throw new Error("Expected bridge connection port transfer.");
        }

        port.addEventListener("message", (event: MessageEvent<MindooDBAppBridgePortMessage>) => {
          const message = event.data;
          if (message.kind === "request") {
            if (message.method === "session.openDatabase") {
              port.postMessage({
                protocol: "mindoodb-app-bridge",
                kind: "success",
                id: message.id,
                result: { ok: true },
              });
              return;
            }
            if (message.method === "attachments.openWriteStream") {
              port.postMessage({
                protocol: "mindoodb-app-bridge",
                kind: "success",
                id: message.id,
                result: { streamId: "write-1" },
              });
              return;
            }
            if (message.method === "attachments.list") {
              port.postMessage({
                protocol: "mindoodb-app-bridge",
                kind: "success",
                id: message.id,
                result: [{
                  attachmentId: "attachment-1",
                  fileName: "hello.txt",
                  mimeType: "text/plain",
                  size: 3,
                }],
              });
              return;
            }
            if (message.method === "attachments.remove") {
              removedAttachmentName = (message.params as { attachmentName: string }).attachmentName;
              port.postMessage({
                protocol: "mindoodb-app-bridge",
                kind: "success",
                id: message.id,
                result: { ok: true },
              });
              return;
            }
            if (message.method === "attachments.openReadStream") {
              port.postMessage({
                protocol: "mindoodb-app-bridge",
                kind: "success",
                id: message.id,
                result: { streamId: "read-1" },
              });
              return;
            }
          }

          if (message.kind === "stream-write") {
            writeChunk = new Uint8Array(message.chunk);
            port.postMessage({
              protocol: "mindoodb-app-bridge",
              kind: "stream-ack",
              streamId: message.streamId,
            });
            return;
          }

          if (message.kind === "stream-close") {
            port.postMessage({
              protocol: "mindoodb-app-bridge",
              kind: "stream-ack",
              streamId: message.streamId,
            });
            return;
          }

          if (message.kind === "stream-read") {
            readRequests += 1;
            port.postMessage({
              protocol: "mindoodb-app-bridge",
              kind: "stream-chunk",
              streamId: message.streamId,
              chunk: readRequests === 1 ? Uint8Array.from([1, 2, 3]).buffer : undefined,
              done: readRequests !== 1,
            });
          }
        });
        port.start();
        port.postMessage({
          protocol: "mindoodb-app-bridge",
          type: "mindoodb-app:connected",
        });
      },
    };

    Object.defineProperty(globalThis, "window", {
      value: {
        parent: host,
        opener: null,
        location: {
          search: "?mindoodbAppLaunchId=launch-1",
        },
        setTimeout,
        clearTimeout,
      },
      configurable: true,
    });

    const session = await createMindooDBAppBridge().connect();
    const database = await session.openDatabase("main");

    const writable = await database.attachments.openWriteStream("doc-1", "hello.txt", "text/plain");
    await writable.write(Uint8Array.from([9, 8, 7]));
    await writable.close();

    expect(writeChunk).toEqual(Uint8Array.from([9, 8, 7]));

    await expect(database.attachments.list("doc-1")).resolves.toEqual([{
      attachmentId: "attachment-1",
      fileName: "hello.txt",
      mimeType: "text/plain",
      size: 3,
    }]);
    await expect(database.attachments.remove("doc-1", "hello.txt")).resolves.toEqual({ ok: true });
    expect(removedAttachmentName).toBe("hello.txt");

    const readable = await database.attachments.openReadStream("doc-1", "attachment-1");
    await expect(readable.read()).resolves.toEqual(Uint8Array.from([1, 2, 3]));
    await expect(readable.read()).resolves.toBeNull();
  });

  it("supports navigator-based view operations over the bridge port", async () => {
    const v = createViewLanguage<{ employee: string; hours: number; rate: number; workDate: string }>();
    const requests: string[] = [];
    const host = {
      postMessage(_message: unknown, _targetOrigin?: string, transfer?: Transferable[]) {
        const port = transfer?.[0] as MessagePort | undefined;
        if (!port) {
          throw new Error("Expected bridge connection port transfer.");
        }

        port.addEventListener("message", (event: MessageEvent<MindooDBAppBridgePortMessage>) => {
          const message = event.data;
          if (message.kind !== "request") {
            return;
          }
          requests.push(message.method);
          if (message.method === "session.createViewNavigator") {
            port.postMessage({
              protocol: "mindoodb-app-bridge",
              kind: "success",
              id: message.id,
              result: { navigatorId: "navigator-1" },
            });
            return;
          }
          if (message.method === "viewNavigators.entries.forward") {
            port.postMessage({
              protocol: "mindoodb-app-bridge",
              kind: "success",
              id: message.id,
              result: {
                entries: [{
                  key: "1",
                  kind: "category",
                  level: 0,
                  origin: "main",
                  docId: null,
                  parentKey: null,
                  categoryPath: ["Ada"],
                  columnValues: { employee: "Ada" },
                  descendantDocumentCount: 1,
                  childCategoryCount: 0,
                  childDocumentCount: 1,
                  position: "1",
                  expanded: true,
                  selected: false,
                  isVisible: true,
                }],
                nextPosition: null,
                hasMore: false,
              },
            });
            return;
          }
          if (message.method === "viewNavigators.current.get" || message.method === "viewNavigators.category.findByParts" || message.method === "viewNavigators.pos.get") {
            port.postMessage({
              protocol: "mindoodb-app-bridge",
              kind: "success",
              id: message.id,
              result: {
                key: "1",
                kind: "category",
                level: 0,
                origin: "main",
                docId: null,
                parentKey: null,
                categoryPath: ["Ada"],
                columnValues: { employee: "Ada" },
                descendantDocumentCount: 1,
                childCategoryCount: 0,
                childDocumentCount: 1,
                position: "1",
                expanded: true,
                selected: false,
                isVisible: true,
              },
            });
            return;
          }
          if (message.method === "viewNavigators.goto.first" || message.method === "viewNavigators.selection.isSelected") {
            port.postMessage({
              protocol: "mindoodb-app-bridge",
              kind: "success",
              id: message.id,
              result: message.method === "viewNavigators.goto.first" ? true : false,
            });
            return;
          }
          if (message.method === "viewNavigators.selection.get") {
            port.postMessage({
              protocol: "mindoodb-app-bridge",
              kind: "success",
              id: message.id,
              result: { selectAllByDefault: false, entryKeys: [] },
            });
            return;
          }
          if (message.method === "viewNavigators.expansion.get") {
            port.postMessage({
              protocol: "mindoodb-app-bridge",
              kind: "success",
              id: message.id,
              result: { expandAllByDefault: true, expandLevel: 0, entryKeys: [] },
            });
            return;
          }
          if (
            message.method === "viewNavigators.selection.select"
            || message.method === "viewNavigators.selection.set"
            || message.method === "viewNavigators.expansion.expandAll"
            || message.method === "viewNavigators.expansion.set"
            || message.method === "viewNavigators.dispose"
          ) {
            port.postMessage({
              protocol: "mindoodb-app-bridge",
              kind: "success",
              id: message.id,
              result: undefined,
            });
          }
        });
        port.start();
        port.postMessage({
          protocol: "mindoodb-app-bridge",
          type: "mindoodb-app:connected",
        });
      },
    };

    Object.defineProperty(globalThis, "window", {
      value: {
        parent: host,
        opener: null,
        location: {
          search: "?mindoodbAppLaunchId=launch-2",
        },
        setTimeout,
        clearTimeout,
      },
      configurable: true,
    });

    const session = await createMindooDBAppBridge().connect();
    const navigator = await session.createViewNavigator({
      databaseIds: ["main"],
      definition: {
        title: "Hours by employee",
        columns: [
          { name: "employee", title: "Employee", role: "category", expression: v.field("employee"), sorting: "ascending" },
          {
            name: "amount",
            title: "Amount",
            role: "display",
            expression: v.let(
              { hours: v.toNumber(v.field("hours")), rate: v.toNumber(v.field("rate")) },
              ({ hours, rate }) => v.mul(v.coalesce(hours, v.number(0)), v.coalesce(rate, v.number(0))),
            ),
            sorting: "descending",
          },
        ],
        filter: {
          mode: "expression",
          expression: v.gt(v.toNumber(v.field("hours")), v.number(0)),
        },
        defaultExpand: "expanded",
      },
    });

    const page = await navigator.entriesForward({ limit: 25 });
    const moved = await navigator.gotoFirst();
    const current = await navigator.getCurrentEntry();
    const category = await navigator.findCategoryEntryByParts(["Ada"]);
    const sameCategory = await navigator.getPos("1");
    await navigator.select("main", "doc-1");
    const selected = await navigator.isSelected("main", "doc-1");
    const selection = await navigator.getSelectionState();
    await navigator.setSelectionState({ selectAllByDefault: false, entryKeys: [] });
    const expansion = await navigator.getExpansionState();
    await navigator.expandAll();
    await navigator.setExpansionState({ expandAllByDefault: true, expandLevel: 0, entryKeys: [] });
    await navigator.dispose();

    expect(page.entries).toHaveLength(1);
    expect(moved).toBe(true);
    expect(current?.key).toBe("1");
    expect(category?.key).toBe("1");
    expect(sameCategory?.key).toBe("1");
    expect(selected).toBe(false);
    expect(selection).toEqual({ selectAllByDefault: false, entryKeys: [] });
    expect(expansion).toEqual({ expandAllByDefault: true, expandLevel: 0, entryKeys: [] });
    expect(requests).toEqual(expect.arrayContaining([
      "session.createViewNavigator",
      "viewNavigators.entries.forward",
      "viewNavigators.goto.first",
      "viewNavigators.current.get",
      "viewNavigators.category.findByParts",
      "viewNavigators.pos.get",
      "viewNavigators.selection.select",
      "viewNavigators.selection.isSelected",
      "viewNavigators.selection.get",
      "viewNavigators.selection.set",
      "viewNavigators.expansion.get",
      "viewNavigators.expansion.expandAll",
      "viewNavigators.expansion.set",
      "viewNavigators.dispose",
    ]));
  });

  it("exposes host theme and viewport snapshots with live update events", async () => {
    let bridgePort: MessagePort | null = null;
    const host = {
      postMessage(_message: unknown, _targetOrigin?: string, transfer?: Transferable[]) {
        const port = transfer?.[0] as MessagePort | undefined;
        if (!port) {
          throw new Error("Expected bridge connection port transfer.");
        }

        bridgePort = port;
        port.addEventListener("message", (event: MessageEvent<MindooDBAppBridgePortMessage>) => {
          const message = event.data;
          if (message.kind !== "request") {
            return;
          }

          if (message.method === "session.getLaunchContext") {
            port.postMessage({
              protocol: "mindoodb-app-bridge",
              kind: "success",
              id: message.id,
              result: {
                appId: "timerecords",
                appInstanceId: "app-1",
                launchId: "launch-theme",
                runtime: "iframe",
                theme: {
                  mode: "dark",
                  preset: "mindoo",
                },
                viewport: {
                  width: 960,
                  height: 640,
                },
                user: {
                  id: "user-1",
                  username: "Jane Doe",
                },
                launchParameters: {},
              },
            });
            return;
          }

          if (message.method === "session.disconnect") {
            port.postMessage({
              protocol: "mindoodb-app-bridge",
              kind: "success",
              id: message.id,
              result: { ok: true },
            });
          }
        });
        port.start();
        port.postMessage({
          protocol: "mindoodb-app-bridge",
          type: "mindoodb-app:connected",
        });
      },
    };

    Object.defineProperty(globalThis, "window", {
      value: {
        parent: host,
        opener: null,
        location: {
          search: "?mindoodbAppLaunchId=launch-theme",
        },
        setTimeout,
        clearTimeout,
      },
      configurable: true,
    });

    const session = await createMindooDBAppBridge().connect();
    const themeChanges: Array<{ mode: string; preset: string }> = [];
    const viewportChanges: Array<{ width: number; height: number }> = [];
    const unsubscribe = session.onThemeChange((theme) => {
      themeChanges.push(theme);
    });
    const unsubscribeViewport = session.onViewportChange((viewport) => {
      viewportChanges.push(viewport);
    });

    await expect(session.getLaunchContext()).resolves.toMatchObject({
      appId: "timerecords",
      theme: {
        mode: "dark",
        preset: "mindoo",
      },
      viewport: {
        width: 960,
        height: 640,
      },
    });

    if (!bridgePort) {
      throw new Error("Expected the host bridge port to be captured.");
    }

    const hostPort = bridgePort as MessagePort;

    hostPort.postMessage({
      protocol: "mindoodb-app-bridge",
      kind: "theme-changed",
      theme: {
        mode: "light",
        preset: "nora",
      },
    });
    hostPort.postMessage({
      protocol: "mindoodb-app-bridge",
      kind: "viewport-changed",
      viewport: {
        width: 720,
        height: 480,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(themeChanges).toEqual([{
      mode: "light",
      preset: "nora",
    }]);
    expect(viewportChanges).toEqual([{
      width: 720,
      height: 480,
    }]);

    unsubscribe();
    unsubscribeViewport();
    await session.disconnect();
  });
});
