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
- `documents` — seed documents into the mock store (used by `list`/`query` and by evaluating VirtualViews). A seed's `decryptionKeyId` is reported back by `documents.get`, like a real host; documents created through the mock report `"default"` unless `create` named a key, and person-encrypted documents (`recipients`) report none.
- `methods.documents`
- `methods.views` for session-level `createView()` and `openView()` calls (overrides the default evaluating navigator)
- `methods.attachments`
- `fulltextSetup` — the initial config returned by `db.getFulltextSetup()`; `db.setFulltextSetup()` overwrites it for the lifetime of the handle. Use this to test your app's full-text bootstrap logic. Note the mock evaluates `text` query clauses regardless of this config.
- `summarySetup` — the initial config returned by `db.getSummarySetup()`; `db.setSummarySetup()` overwrites it for the lifetime of the handle. The mock's `query()` reads seeded documents directly and ignores this config; use it to test your app's summary bootstrap logic.
- `automerge: true` — back every document with a real Automerge document, as Haven does (off by default: plain JSON with `mock-head-N` heads). `create`/`update` then return real Automerge heads, `update` applies `set`/`unset`, `json` (with `Automerge.changeAt(json.baseHeads)` when given) and `text` patches as Automerge changes with Haven's rules (missing parents and lists are created, `unset` is idempotent, `counterIncrement` needs a counter, an empty `json` patch is rejected), and `get`/`list`/`query` return the plain projection (atomic strings as strings, counters as numbers, timestamps as ISO strings). `richText` patches run Automerge's `updateSpans` at their `baseHeads` and `richTextSteps` splice and mark at theirs, both validated and with MindooDB's recovery, and `getRichText` returns `Automerge.spans` — so values Automerge rejects (an `immutableString` as a mark value) fail here as they do in Haven. A `richText` snapshot written at older `baseHeads` is applied on a fork at those heads and merged back, as MindooDB does (Automerge 3.5's `updateSpans` inside `changeAt` indexes the current text), so a concurrent edit of the same text survives. Seeds are built with a fixed actor, so two mocks from the same seed have identical heads. `mockDatabasesFromDefinition(definition, seed, { automerge: true })` and the test host URL setting `automerge=1` turn it on, too.

#### Concurrent edits from another device

`applyRemoteUpdate(databaseId, docId, input, { actor? })` on the controller (`createMockMindooDBAppSession`, `createFakeBridgeHost`, the browser test host and `window.__havenTestHost`) writes `input` as another device and syncs it in; live queries update as after any write. With `automerge: true` the device holds the history up to `input.json.baseHeads` (plus its own earlier changes) and writes as its own Automerge actor, so its edit truly merges with an app save at the same heads:

```ts
const doc = await database.documents.get("sheet-1");          // heads H
await mock.applyRemoteUpdate("main", "sheet-1", {             // device B, at H
  json: { baseHeads: doc!.heads, listInsert: [{ path: ["rows"], index: 1, values: ["remote"] }] },
});
const saved = await database.documents.update("sheet-1", {   // the app, also at H
  json: { baseHeads: doc!.heads, listInsert: [{ path: ["rows"], index: 1, values: ["local"] }] },
});
// saved.data.rows keeps both entries; saved.heads has two heads
```

The relative order of concurrent inserts at the same index follows Automerge's op ids, as in Haven. Without `automerge`, `applyRemoteUpdate` is a plain update.

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

Nested lookups (`include`) work too, including slots that name another mocked
database by its id, and they mirror the host's rules — one parent equality per
slot, `cardinality: "one"` failing loudly when several documents match, per-slot
`sortBy`/`limit`, and nesting. A write to a joined database re-fires the live
queries that join it, so cross-database joins can be tested end to end:

```ts
const mock = createMockMindooDBAppBridge({
  databases: [
    {
      info: { id: "billing", title: "Billing", capabilities: ["read", "create"] },
      documents: [{ id: "inv_1", data: { type: "invoice", customerId: "cust_1" } }],
    },
    {
      info: { id: "customers", title: "Customers", capabilities: ["read"] },
      documents: [{ id: "cust_1", data: { name: "Acme" } }],
    },
  ],
});

const session = await mock.bridge.connect();
const billing = await session.openDatabase("billing");

const result = await billing.documents.query<{ customer: MindooDBAppQueryRow | null }>({
  filter: 'v.eq(v.field("type"), "invoice")',
  include: {
    customer: { databaseId: "customers", cardinality: "one", localKey: "customerId" },
  },
});
expect(result.rows[0].includes?.customer?.fields.name).toBe("Acme");
```

An include slot naming a database that was not seeded fails, the same way Haven
rejects a database the app is not mapped to.

### Host focus and notifications

A mock launch starts without host focus. `session.requestHostFocus()` sets it
and fires `onHostFocusChange` listeners; `mock.emitHostFocusChange(focused)`
simulates Haven moving focus to or away from the launch, so you can test code
that only notifies while the user is looking elsewhere. `session.notify()` shows
nothing and resolves with the passed `id`, or a fresh one when `id` is omitted:

```ts
const mock = createMockMindooDBAppSession();

const seen: boolean[] = [];
const stop = mock.session.onHostFocusChange((focused) => seen.push(focused));

await mock.session.requestHostFocus();
mock.emitHostFocusChange(false);
expect(await mock.session.hasHostFocus()).toBe(false);
expect(seen).toEqual([true, false]);
stop();

const { id } = await mock.session.notify({ id: "sync", severity: "info", text: "Sync finished" });
expect(id).toBe("sync");
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
- `emitHostFocusChange()` — set host focus and push a `host-focus-changed` message to `session.onHostFocusChange()` listeners
- `setRequestHandler()`
- `clearRequestHandler()`
- `postPortMessage()`

The built-in request handling also covers `documents.query` and the `documents.liveQuery.*` RPCs against the seeded documents, so `db.documents.query()` / `db.documents.liveQuery()` and `navigator.onDidUpdate()` work end-to-end over the real bridge transport in Level 2 tests.

## Browser test host

Level 1 and 2 run in Node/jsdom. To run the real app in a real browser — for Playwright, or to click through it yourself — mount the browser test host on a separate page. It frames the app exactly as Haven does (an iframe with `?mindoodbAppLaunchId=…`) and answers the bridge with the same mock state as the Vitest helpers:

```ts
// src/testHost/main.ts, loaded by /__haven-test/index.html
import { mockDatabasesFromDefinition, mountHavenTestHost } from "mindoodb-app-sdk/testing";
import definition from "../../public/haven-app.json";

mountHavenTestHost({
  appUrl: "/",
  title: definition.label,
  databases: mockDatabasesFromDefinition(definition, {
    main: [{ id: "welcome", data: { type: "note", title: "Seeded note" } }],
  }),
});
```

The page shows the app next to a control panel:

- **Host**: theme and host-focus toggles, reload the app frame.
- **Language**: switches the launch context's locale live (`onLocaleChange`), so you see the app re-render in every language without a reload.
- **Databases**: one checkbox per capability for every mapped database, plus **Enforce capabilities**. Changing a capability relaunches the app, as Haven does after a permission change. With enforcement on, the mock rejects every call the database was not granted with a `forbidden` error (and `documents.canCreate()` and friends answer `allowed: false`), so you can check the app's hints for missing rights.
- **Directory**: fills the tenant directory with 0 to 500 generated users (`CN=Test User 001/O=Test`, …) for recipient pickers and paging.
- **Scanner**: what `attachments.scan()` returns — cancel, a generated sample page, or a file you choose. The file is written to the document's attachments like Haven's scanner does, so the app can read it back.
- **Agent tools**: the tools the app declared with `session.agent.registerTools()` (with the prefix agents see, `read-only` and `asks first` tags, description and input schema), a form to call one with a JSON input as an agent would, and the result as the agent gets it (images in the result are shown). Tools marked `consequentialHint` go through a confirm, like Haven's consent dialog. A checkbox switches agent access off. **Agent files** imports files for the app (each gets a `fileRef` for `takeFile`) and lists the files the app handed over with `provideFile` for download. **Agent context** shows what the app last passed to `setContext`.
- A live log of notifications, attachment previews, scans and every RPC request. Click a request for its parameters, its result or error, and how long it took; binary values show as size plus a hex preview.

`mockDatabasesFromDefinition` gives every database an in-memory attachment store (`attachments: "none"` restores the stateless default) and takes overrides for testing other mappings than the definition requests:

```ts
mountHavenTestHost({
  appUrl: "/",
  databases: mockDatabasesFromDefinition(definition, seed, {
    overrides: {
      main: { capabilities: ["read"] },    // read-only mapping
      archive: { mapped: false },          // the user did not map this one
    },
  }),
  enforceCapabilities: true,
  directoryUsers: generateDirectoryUsers(120),
  scanMode: "sample",
});
```

The panel keeps its settings in the page URL, so a scenario can be linked or opened by Playwright directly: `/__haven-test/?db=main:read,attachments&db=archive:none&enforce=1&users=120&locale=de-DE&theme=dark` (`db=<id>:none` unmaps a database; `automerge=1` backs all databases with Automerge documents; URL settings win over the options). The same controls are scriptable as `window.__havenTestHost`:

```ts
await page.goto("/__haven-test/?enforce=1");
const app = page.frameLocator('[data-testid="haven-test-app-frame"]');
await page.evaluate(() => window.__havenTestHost!.setCapabilities("main", ["read"])); // relaunches the app
await expect(app.getByText("You can only view")).toBeVisible();

await page.evaluate(() => window.__havenTestHost!.setLocale("de-DE"));
await page.evaluate(() => window.__havenTestHost!.setNextScan({ fileName: "receipt.pdf", mimeType: "application/pdf", size: 1024 }));
await app.getByRole("button", { name: "Scan" }).click();
expect(await page.evaluate(() => window.__havenTestHost!.log.scans)).toHaveLength(1);

// with ?automerge=1: another device edits the document the app has open
await page.evaluate(() => window.__havenTestHost!.applyRemoteUpdate("main", "sheet-1", { set: { title: "Renamed elsewhere" } }));
```

Agent tools are scriptable through `window.__havenTestHost.agent`, the same controller the Vitest helpers expose as `createFakeBridgeHost().agent`:

```ts
const agent = () => window.__havenTestHost!.agent;
const fileRef = await page.evaluate(() =>
  agent().importFile({ name: "logo.png", mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71]) }),
);
const added = await page.evaluate((ref) => agent().call("image_add", { fileRef: ref }), fileRef);
expect(added).toMatchObject({ ok: true });
const exported = await page.evaluate(() => agent().call("deck_export", { format: "pptx" }));
const file = await page.evaluate((ref) => agent().getFile(ref)?.name, (exported as any).result.files[0].fileRef);
```

`call()` takes the tool's own name or the prefixed one and never throws: failures come back as `{ ok: false, error: { code, message, requiredAction } }`, the codes an agent sees. The mock follows Haven: tool declarations are validated (name, at most 64 tools, 2000-character descriptions, an object `inputSchema`), the prefix is the definition's `agentToolPrefix` (pass it as the `agentToolPrefix` option) or derived from the app id, an app can only `takeFile()` what was imported for it, and file refs expire after ten minutes. `setConsent("allow" | "deny" | fn)` answers the consent step in scripts, `setEnabled(false)` switches access off, and `calls()` lists every call with its outcome.

`setNextScan()` decides only the next scan (pass `bytes` to attach real content); `setScanMode()` decides the ones after it. `setDirectoryUsers()` and `setEnforceCapabilities()` apply to the next call.

The Level 1 and 2 helpers take the same options: `createMockMindooDBAppSession({ enforceCapabilities: true, directoryUsers: generateDirectoryUsers(120) })`, with `setCapabilities()`, `setEnforceCapabilities()` and `setDirectoryUsers()` on the controller, and `createMemoryAttachments()` for a database's `methods.attachments`. `createFakeBridgeHost({ onResponse })` reports every answer with its duration.

Lower-level pieces, if you build your own page: `createBrowserTestHost({ frame, appUrl, ...mockOptions })` wires one iframe to a fake host, and `host.acceptConnection(message, ports)` answers a handshake you received yourself.

Keep the test page out of production builds. The starter template builds it only for `vite dev` and when `HAVEN_TEST_HOST=1` is set (for preview deployments), so the app's public URL keeps showing its landing page.

### Two users on two replicas

`/__haven-test/?twoUsers=1` (or `mountHavenTestHost({ twoUsers: true })`) shows the app twice, side by side, as two people on two devices: each frame is launched by its own mock Haven with its own replica of every database (`automerge: true`, distinct Automerge actors), so their edits really are concurrent. The bar on top:

- **Auto-sync every 2 s** (on by default) merges the replicas with `syncMockReplicas`, like Haven's sync. Turn it off to keep the two apart — two devices offline — edit on both sides, then press **Sync** and watch the merge.
- The status says "✓ in sync" or how many documents still differ.

Each app sees the other's changes the way it would in Haven (changefeed, live queries, or its own polling). Use it to try "one changes the text, the other the color", "both add a slide", "both format the same word" by hand. Playwright reaches both frames as `[data-testid="haven-two-users-frame-1"]` / `-2`, and `window.__havenTwoUsers` scripts the mode (`sync()`, `setAutoSync(on)`, `differences()`, `hosts`).

In Vitest, two mocks with distinct `automergeActor`s plus `syncMockReplicas(a, b)` do the same without a browser:

```ts
const a = createMockMindooDBAppSession({ databases: [def()], automergeActor: "a1".repeat(16) });
const b = createMockMindooDBAppSession({ databases: [def()], automergeActor: "b2".repeat(16) });
// … edit through each session, then:
await syncMockReplicas(a, b); // documents, deletions and attachments, both ways
expect(mockReplicaDifferences(a, b)).toBe(0);
```

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
