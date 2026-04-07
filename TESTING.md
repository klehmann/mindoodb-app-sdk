# Testing `mindoodb-app-sdk` apps

You can test apps that use `mindoodb-app-sdk` without running a full Haven environment.

The SDK exposes a dedicated testing entrypoint:

```ts
import {
  createFakeBridgeHost,
  createMockMindooDBAppBridge,
  createMockMindooDBAppSession,
} from "mindoodb-app-sdk/testing";
```

## Pick a level

### Level 1: simple app tests

Use Level 1 for:

- composables
- hooks
- stores
- component tests
- logic that does not need to verify the transport layer

These helpers give you a fake `MindooDBAppSession` and bridge object without going through `postMessage` or `MessageChannel`.

### Level 2: bridge protocol tests

Use Level 2 when you want to exercise the real `createMindooDBAppBridge()` connection flow.

The fake host harness:

- installs a host window for the test
- accepts the `mindoodb-app:connect` handshake
- transfers a `MessagePort`
- responds to bridge RPC requests
- can emit theme and viewport change events

This is useful for integration-style tests that should prove your app works with the real SDK bridge behavior, but still without running Haven.

## Level 1 example

This pattern is a good fit when your app already depends on `createMindooDBAppBridge()` and you want to replace only that boundary in Vitest.

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("mindoodb-app-sdk", async () => {
  const actual = await vi.importActual<typeof import("mindoodb-app-sdk")>("mindoodb-app-sdk");
  const { createMockMindooDBAppBridge } = await import("mindoodb-app-sdk/testing");

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

  return {
    ...actual,
    createMindooDBAppBridge: () => mock.bridge,
  };
});
```

Available Level 1 helpers:

- `createMockMindooDBAppSession()`
- `createMockMindooDBAppBridge()`

Both accept the same options:

- `launchContext`
- `databases`
- `onDisconnect`

When you pass `databases`, the mock session also exposes them through `session.getLaunchContext().databases`.

Each database entry can provide:

- `info`
- `methods.documents`
- `methods.views` for session-level `createView()` and `openView()` calls
- `methods.attachments`

## Level 2 example

This pattern keeps the real `createMindooDBAppBridge()` code path and replaces only the host side.

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createMindooDBAppBridge } from "mindoodb-app-sdk";
import { createFakeBridgeHost } from "mindoodb-app-sdk/testing";

describe("bridge integration", () => {
  let host: ReturnType<typeof createFakeBridgeHost> | null = null;

  afterEach(() => {
    host?.dispose();
    host = null;
  });

  it("connects without Haven", async () => {
    host = createFakeBridgeHost({
      launchContext: {
        appId: "timerecords",
        launchId: "launch-1",
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
          },
        },
      }],
    });

    host.install();

    const session = await createMindooDBAppBridge().connect();
    const databases = await session.listDatabases();

    expect(databases[0]?.id).toBe("main");

    host.emitViewportChange({
      width: 720,
      height: 480,
    });
  });
});
```

Available Level 2 helpers:

- `createFakeBridgeHost()`

Useful Level 2 methods:

- `install()`
- `dispose()`
- `emitThemeChange()`
- `emitViewportChange()`
- `setRequestHandler()`
- `clearRequestHandler()`
- `postPortMessage()`

## When to use which level

Choose Level 1 when:

- you are testing app behavior, not the bridge transport
- you want the smallest and fastest mock setup
- you already mock `mindoodb-app-sdk` in Vitest

Choose Level 2 when:

- you want to keep the real `createMindooDBAppBridge()` code path
- you want to verify launch-id driven connection behavior
- you want to test host-driven theme or viewport events through the bridge
- you want an integration-style test without starting Haven

## Local development vs automated tests

These helpers are for automated tests.

For interactive local development, it is still recommended to run Haven locally and launch the app from Haven so the app receives a real launch session and the full host environment.
