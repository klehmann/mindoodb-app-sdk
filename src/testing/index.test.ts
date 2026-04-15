import { afterEach, describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import {
  createFakeBridgeHost,
  createMockMindooDBAppBridge,
} from "./index";

describe("mindoodb-app-sdk/testing", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("creates a mock bridge and session for simple app tests", async () => {
    const mock = createMockMindooDBAppBridge({
      launchContext: {
        appId: "timerecords",
        launchParameters: {
          decryptionKeyId: "payroll",
        },
      },
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create"],
        },
      }],
    });

    const session = await mock.bridge.connect();
    await expect(session.getLaunchContext()).resolves.toMatchObject({
      appId: "timerecords",
      launchParameters: {
        decryptionKeyId: "payroll",
      },
    });
    await expect(session.listDatabases()).resolves.toEqual([{
      id: "main",
      title: "Main",
      capabilities: ["read", "create"],
    }]);
  });

  it("connects through the real bridge using the fake host harness", async () => {
    const host = createFakeBridgeHost({
      launchContext: {
        appId: "timerecords",
        launchId: "launch-sdk-testing",
      },
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read"],
        },
        methods: {
          documents: {
            async list() {
              return {
                items: [{ id: "doc-1" }],
                nextCursor: null,
              };
            },
            async get(docId) {
              return {
                id: docId,
                data: {
                  title: "Hello",
                },
              };
            },
          },
        },
      }],
    });

    host.install();
    const session = await createMindooDBAppBridge().connect();
    const database = await session.openDatabase("main");

    await expect(session.getLaunchContext()).resolves.toMatchObject({
      appId: "timerecords",
      launchId: "launch-sdk-testing",
    });
    await expect(database.documents.list()).resolves.toEqual({
      items: [{ id: "doc-1" }],
      nextCursor: null,
    });
    await expect(database.documents.get("doc-1")).resolves.toEqual({
      id: "doc-1",
      data: {
        title: "Hello",
      },
    });

    host.dispose();
  });

  it("supports structured host-rendered menus in the mock and fake bridge helpers", async () => {
    const mock = createMockMindooDBAppBridge();
    const mockSession = await mock.bridge.connect();
    const pendingSelection = mockSession.menus.show({
      anchor: {
        type: "point",
        x: 16,
        y: 24,
      },
      items: [{
        id: "rename",
        label: "Rename",
      }],
    });
    await mockSession.menus.hide();
    await expect(pendingSelection).resolves.toEqual({
      action: "dismissed",
      reason: "hide",
    });

    const host = createFakeBridgeHost({
      requestHandlers: {
        "menus.show": () => ({
          action: "selected",
          itemId: "properties",
        }),
      },
    });

    host.install();
    const session = await createMindooDBAppBridge().connect();
    await expect(session.menus.show({
      anchor: {
        type: "rect",
        rect: {
          left: 20,
          top: 30,
          width: 80,
          height: 24,
        },
      },
      kind: "dropdown",
      items: [{
        id: "properties",
        label: "Properties",
      }],
    })).resolves.toEqual({
      action: "selected",
      itemId: "properties",
    });
    host.dispose();
  });
});
