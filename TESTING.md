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

The testing entrypoint emulates document storage with real Automerge documents,
so `@automerge/automerge` is declared as an optional peer dependency. Add it to
your app's `devDependencies` when you import `mindoodb-app-sdk/testing`
(the runtime SDK entrypoint does not need it).

Evaluating VirtualViews also need the optional `mindoodb` peer (same core engine
Haven uses):

```bash
pnpm add -D @automerge/automerge mindoodb
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
- `documents` — seed documents into the mock store (used by `list`/`query` and by evaluating VirtualViews)
- `methods.documents`
- `methods.views` for session-level `createView()` and `openView()` calls (overrides the default evaluating navigator)
- `methods.attachments`
- `fulltextSetup` — the initial config returned by `db.getFulltextSetup()`; `db.setFulltextSetup()` overwrites it for the lifetime of the handle. Use this to test your app's full-text bootstrap logic. Note the mock evaluates `text` query clauses regardless of this config.

### Evaluating VirtualViews

With the optional `mindoodb` peer installed (`pnpm add -D mindoodb`),
`session.createViewNavigator({ definition, databaseIds })` evaluates the view
definition against seeded (and later created) documents using the same
VirtualView engine Haven uses. That means class-scoped filters,
`childDocumentsBetween`, and multi-database origins work in Vitest without a
full Haven host:

```ts
import { createViewLanguage } from "mindoodb-view-language";
import { createMockMindooDBAppSession } from "mindoodb-app-sdk/testing";

const v = createViewLanguage();
const mock = createMockMindooDBAppSession({
  databases: [{
    info: { id: "teacher_core", title: "Core", capabilities: ["read", "views"] },
    documents: [
      { id: "obs_a", data: { type: "observation", classGroupId: "cls_a" } },
      { id: "obs_b", data: { type: "observation", classGroupId: "cls_b" } },
    ],
  }],
});

const navigator = await mock.session.createViewNavigator({
  databaseIds: ["teacher_core"],
  definition: {
    id: "class-detail-v1",
    title: "Class",
    filter: {
      mode: "expression",
      expression: v.and(
        v.eq(v.field("type"), "observation"),
        v.eq(v.field("classGroupId"), "cls_a"),
      ),
    },
    columns: [
      { name: "type", role: "category", expression: v.field("type") },
      { name: "sourceType", role: "display", expression: v.field("type") },
    ],
  },
  options: { includeCategories: false, includeDocuments: true },
});

await navigator.expandAll();
const page = await navigator.entriesForward({ limit: 100 });
// page.entries → only obs_a
```

Without `mindoodb`, the testing entrypoint falls back to an empty navigator and
logs a warning — install the peer for realistic view tests.

The default in-memory document store also implements `documents.query()` and `documents.liveQuery()`: expression and formula-string filters are evaluated against the seeded documents, `sortBy`/`limit`/`offset` work as documented, and live query callbacks fire automatically after `create`/`update`/`delete`/`undelete` mutations. Full-text `text` clauses are supported with a deterministic mock implementation (token matching with prefix/AND semantics and an occurrence-count `textScore`) — assert on membership and relative ordering, not absolute scores, since real hosts use a BM25-style engine. That means app code built on queries and live queries is testable at Level 1 without any extra setup:

```ts
const session = await mock.bridge.connect();
const db = await session.openDatabase("main");

await db.documents.create({ set: { type: "invoice", total: 120 } });

const result = await db.documents.query({
  filter: 'v.eq(v.field("type"), "invoice")',
  sortBy: [{ field: "total", direction: "descending" }],
});
expect(result.rows).toHaveLength(1);

const updates: number[] = [];
const sub = await db.documents.liveQuery(
  { filter: 'v.eq(v.field("type"), "invoice")' },
  (r) => updates.push(r.total),
);
await db.documents.create({ set: { type: "invoice", total: 50 } });
await sub.dispose();
```

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
- `emitQueryResult()` — push a `query-result` message to live query subscribers
- `emitViewChanged()` — push a `view-changed` message to navigator `onDidUpdate` listeners
- `setRequestHandler()`
- `clearRequestHandler()`
- `postPortMessage()`

The built-in request handling also covers `documents.query` and the `documents.liveQuery.*` RPCs against the seeded documents, so `db.documents.query()` / `db.documents.liveQuery()` and `navigator.onDidUpdate()` work end-to-end over the real bridge transport in Level 2 tests.

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
