# mindoodb-app-sdk

Build apps that run inside **MindooDB Haven** -- the browser-based workspace for end-to-end encrypted, local-first data.

`mindoodb-app-sdk` is the TypeScript SDK that connects your web application to Haven through a secure message bridge. Your app runs in a sandboxed iframe (or a separate browser window) and gains access to databases, documents, attachments, virtual views, and live host events -- all without ever touching encryption keys or raw sync state.

## What is a MindooDB App?

[MindooDB](https://mindoodb.com) is an **end-to-end encrypted, local-first sync database**. Data is encrypted on the client before it ever leaves the device. Under the hood it uses [Automerge](https://automerge.org/) CRDTs so multiple users can edit concurrently and conflicts resolve automatically.

**Haven** is the browser-based workspace that sits on top of MindooDB. Users organize databases, applications, notes, and media on a visual grid -- think of it as a customizable home screen for encrypted data that works offline and syncs in the background.

A **MindooDB App** is any web application that uses this SDK to communicate with Haven. When Haven launches your app, it opens it inside a sandboxed iframe (or a new browser tab) and establishes a `postMessage` + `MessagePort` bridge. Through this bridge your app can:

- read launch metadata (user, theme, viewport, mapped databases, configured views)
- perform CRUD operations on JSON documents with full change history
- upload, download, and preview file attachments
- query virtual views with categorization, sorting, and aggregation
- react to live theme and viewport events from Haven

**Security model:** Every app runs on a **separate origin** inside a sandboxed iframe. It cannot access Haven's storage, cookies, or other apps. Haven decides exactly which databases and permissions each app receives -- your app only sees data that was explicitly shared with it.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Haven (browser tab)                                    │
│                                                         │
│  ┌──────────────┐   ┌─────────────┐   ┌─────────────┐  │
│  │  Haven UI    │──▶│ Bridge Host │──▶│  MindooDB    │  │
│  │  (theme,     │   │  (RPC +     │   │  (encrypted  │  │
│  │   viewport)  │   │   streams)  │   │   databases) │  │
│  └──────────────┘   └──────┬──────┘   └─────────────┘  │
│                            │                            │
│              postMessage + MessagePort                  │
│                            │                            │
│  ┌─────────────────────────┼─────────────────────────┐  │
│  │  Your App (sandboxed iframe / window)             │  │
│  │                         │                         │  │
│  │              ┌──────────▼──────────┐              │  │
│  │              │  mindoodb-app-sdk   │              │  │
│  │              └─────────────────────┘              │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

The bridge carries RPC calls (documents, views, database info), binary attachment streams, and push events (theme changes, viewport resizes) over a single `MessagePort`.

## Install

```bash
pnpm add mindoodb-app-sdk
```

## Get started in 5 minutes

The fastest way to start building is to clone the **example app**, run it locally, and connect it to Haven:

```bash
git clone https://github.com/klehmann/mindoodb-app-example.git
cd mindoodb-app-example
pnpm install
pnpm dev:local
```

This spins up a local Vite dev server on `http://localhost:4200` with hot module reload.

Then, in Haven:

1. Go to **Application settings** and register a new app pointing to `http://localhost:4200`.
2. Map one or more databases (and optionally views) to the app.
3. Launch the app -- it connects via the SDK bridge and displays live data.

From here, **fork or duplicate** the example project to start building your own app while exploring the platform in a running Haven client.

The example app is also deployed at **https://app-example.mindoodb.com** so you can register it in Haven without running anything locally.

> See the [mindoodb-app-example README](https://github.com/klehmann/mindoodb-app-example) for the full project walkthrough.

## Quick start (from scratch)

If you prefer starting from an empty project:

```ts
import { createMindooDBAppBridge } from "mindoodb-app-sdk";

// 1. Create the bridge and connect to Haven
const bridge = createMindooDBAppBridge();
const session = await bridge.connect();

// 2. Read the launch context
const ctx = await session.getLaunchContext();
console.log("Runtime:", ctx.runtime); // "iframe" | "window"
console.log("Theme:", ctx.theme.mode); // "light" | "dark"
console.log(
  "Databases:",
  ctx.databases.map((db) => db.title),
);

// 3. Subscribe to live host events
session.onThemeChange((theme) => {
  document.documentElement.dataset.theme = theme.mode;
});

session.onViewportChange((viewport) => {
  console.log("Iframe resized:", viewport.width, viewport.height);
});

// 4. Open a database and list documents
const db = await session.openDatabase(ctx.databases[0]!.id);
const result = await db.documents.list({ limit: 25 });
console.log("Documents:", result.items);

// 5. Open a Haven-configured view
//
// A "view" is a pre-built, categorized query that a Haven administrator
// attaches to your app (think: a pivot table over one or more databases).
// `ctx.views` is the list of views that were made available at launch time.
// `openViewNavigator()` returns a stateful "cursor" over the view's rows
// that you can page through and navigate entry by entry.
if (ctx.views[0]) {
  const viewNav = await session.openViewNavigator(ctx.views[0].id);

  // Move the cursor to the first row and read a batch of visible entries.
  await viewNav.gotoFirst();
  const page = await viewNav.entriesForward({ limit: 50 });
  console.log("View rows:", page.entries);

  // Always dispose when you are done -- this frees the host-side navigator.
  await viewNav.dispose();
}
```

When Haven launches your app it injects a `mindoodbAppLaunchId` query parameter into the URL. `connect()` reads it automatically -- no manual wiring needed.

> New to views? They are optional. If your app only needs raw document access you can stop at step 4. The full navigator API (paging, category expand/collapse, selection, child lookups, dynamic app-defined views via `session.createViewNavigator()`) is documented in the [Virtual Views](#virtual-views) section below, and the [`mindoodb-app-example`](https://github.com/klehmann/mindoodb-app-example) repo shows an end-to-end UI built on top of it.

## Core concepts

### Launch context

After connecting, call `session.getLaunchContext()` to receive the initial host snapshot:

```ts
interface MindooDBAppLaunchContext {
  appId: string;
  appInstanceId: string;
  appVersion?: string;
  launchId: string;
  runtime: "iframe" | "window";
  theme: { mode: "light" | "dark"; preset: string };
  viewport: { width: number; height: number } | null;
  tenantId?: string;
  preferredDatabaseId?: string;
  user: { id: string; username: string };
  launchParameters: Record<string, string>;
  databases: MindooDBAppDatabaseInfo[];
  views: MindooDBAppResolvedViewDefinition[];
}
```

`viewport` is the iframe size at launch time. It is `null` when the app runs in `window` mode (separate browser tab). Later changes arrive through `onViewportChange()`.

You can use `runtime` to decide when a host-rendered overlay is necessary:

```ts
const ctx = await session.getLaunchContext();

if (ctx.runtime === "iframe") {
  // Prefer host-rendered menus when clipping outside the iframe matters.
} else {
  // A regular in-app menu is often fine in a separate window.
}
```

### Host-rendered menus

When your app runs inside an iframe, Haven can render a structured menu above the iframe chrome. This is useful for context menus, toolbar drop-downs, and simple pickers such as font-family or font-size lists.

```ts
const result = await session.menus.show({
  anchor: {
    type: "point",
    x: event.clientX,
    y: event.clientY,
  },
  kind: "context",
  items: [
    { id: "rename", label: "Rename" },
    { separator: true },
    { id: "delete", label: "Delete", destructive: true },
  ],
});

if (result.action === "selected") {
  console.log("Chosen action:", result.itemId);
}
```

Rect anchors work well for button-triggered menus:

```ts
const bounds = button.getBoundingClientRect();
const frameBounds = document.documentElement.getBoundingClientRect();

await session.menus.show({
  anchor: {
    type: "rect",
    rect: {
      left: bounds.left - frameBounds.left,
      top: bounds.top - frameBounds.top,
      width: bounds.width,
      height: bounds.height,
    },
  },
  kind: "dropdown",
  placement: "bottom-start",
  items: [
    { id: "sans", label: "Sans Serif", checked: true },
    { id: "serif", label: "Serif" },
  ],
});
```

Important constraints:

- Menus are host-rendered and data-only. Apps cannot pass HTML, CSS, or script.
- `show()` resolves to either `{ action: "selected", itemId }` or `{ action: "dismissed", reason }`.
- Call `session.menus.hide()` if your app needs to explicitly dismiss a pending host menu.
- Host-rendered menus are intended for `runtime === "iframe"`. Window-mode apps can usually show local menus instead.

### Databases and capabilities

Each database mapped to your app carries a set of **capabilities** that Haven controls. Your app should check capabilities before attempting operations and adapt its UI accordingly.

| Capability    | Allows                                                       |
| ------------- | ------------------------------------------------------------ |
| `read`        | List and read documents                                      |
| `create`      | Create new documents                                         |
| `update`      | Update existing documents                                    |
| `delete`      | Delete documents                                             |
| `history`     | Access document revision history and historical snapshots    |
| `attachments` | List, upload, download, remove, and preview file attachments |
| `views`       | Create app-defined virtual views for this database           |
| `sealedchannel` | Open an encrypted channel to a tenant-joined service       |

```ts
const db = ctx.databases[0]!;

if (db.capabilities.includes("history")) {
  // show history UI
}
if (!db.capabilities.includes("delete")) {
  // hide delete button
}
```

When the database is readable, `documents.list()` can also expose deleted document IDs by setting `status: "all"` or `status: "deleted"`. This is useful for app-side indexes and sync checkpoints.

### Sealed channels

Some services join the user's tenant as a member of their own and then talk to your app over HTTP — the MindooMail bridge is the first. A sealed channel is how you reach one without your app ever touching key material.

Haven does the key exchange with the user's identity key, keeps the resulting AES key host-side, and seals and opens every payload. Your app holds an opaque `channelId` and exchanges plain JSON.

```ts
const opened = await session.openSealedChannel({
  databaseId: db.id,
  baseUrl: "https://bridge.example.com",
});
if (!opened.ok) {
  // The user declined. Not an error — leave your UI intact.
  return;
}

const reply = await session.sealedChannelRequest<JmapResponse>({
  channelId: opened.channelId,
  path: "/jmap/api",
  payload: { using: [], methodCalls: [] },
});

await session.closeSealedChannel(opened.channelId);
```

Requirements and limits worth knowing before you design around this:

- The binding named by `databaseId` needs the `sealedchannel` capability.
- The user is asked to approve the origin the first time this app connects there. Haven stores that grant per identity, app, and origin, and does not ask again on later launches.
- `baseUrl` must be a bare `https:` origin (or `http:` on loopback for local development) with no path, query, or credentials, and `path` may not leave that origin.
- The service must allow Haven's origin in its CORS configuration — the request comes from the host, not from your app's iframe.

There is deliberately no API for decrypting arbitrary data with the user's key. That would be a decryption oracle: doc keys wrapped to the same key are publicly readable in the tenant directory, so an app able to unwrap chosen ciphertext could obtain keys for databases it was never granted.

### Theme and viewport events

Haven pushes two types of live events to your app:

**Theme changes** occur when the user switches between light/dark mode or changes the UI theme preset:

```ts
// Initial snapshot from launch context
const { mode, preset } = ctx.theme; // e.g. { mode: "dark", preset: "aura" }

// Live updates
const stopTheme = session.onThemeChange((theme) => {
  document.documentElement.dataset.theme = theme.mode;
  document.documentElement.dataset.themePreset = theme.preset;
});
```

**Viewport changes** fire when the iframe is resized inside Haven (e.g. the user resizes a chicklet on the workspace grid):

```ts
// Initial snapshot (null in window mode)
const viewport = ctx.viewport; // { width: 800, height: 600 }

// Live updates
const stopViewport = session.onViewportChange((viewport) => {
  console.log(viewport.width, viewport.height);
});
```

Both subscription functions return an unsubscribe callback. Call it during teardown.

### Documents

Open a database, then use the `documents` API for CRUD, history, and changefeed-backed document listing:

```ts
const db = await session.openDatabase(databaseId);

// List the first page of existing documents
const result = await db.documents.list({ limit: 50, fields: ["title"] });
console.log(result.items);
console.log(result.nextCursor); // opaque changefeed checkpoint or null

// Continue from the last checkpoint
const nextPage = result.nextCursor
  ? await db.documents.list({
      cursor: result.nextCursor,
      limit: 50,
      fields: ["title"],
    })
  : null;

// Fast metadata-only listing (IDs + deletion state only)
const ids = await db.documents.list({
  limit: 200,
  status: "all",
  metadataOnly: true,
});

// Skip N matching entries before returning results
const window = await db.documents.list({
  cursor: result.nextCursor,
  skip: 100,
  limit: 25,
  status: "existing",
});

// Read
const doc = await db.documents.get(docId);

// Create (MindooDB generates an ObjectId; optionally use a named document key)
const created = await db.documents.create({
  set: { title: "Meeting notes", content: "..." },
  decryptionKeyId: "team-key", // omit to use "default"
});

// Create with a caller-provided id (e.g. a known well-known document the app
// always loads on launch, or migrating an id from another system).
const settings = await db.documents.create({
  id: "appsettings",
  set: { theme: "dark" },
});
// Subsequent calls with the same id return the existing document and DO NOT
// overwrite `set`, so `documents.create({ id })` is safe to call on every app
// launch as a "create-if-missing" primitive. Custom ids must match
// /^[a-z][a-z0-9_]*$/ (lowercase only — ids become on-disk filenames, which are
// case-insensitive: first char must be a lowercase letter, subsequent chars may
// be lowercase letters, digits, or `_`). Documents created with the same custom
// id on different replicas merge correctly when synced.

// Update top-level fields
const updated = await db.documents.update(docId, {
  set: { title: "Updated title" },
  unset: ["legacyField"],
});

// Update with a granular text patch (see "Collaborative text editing" below).
// `baseHeads` is the document version this edit was authored against; Haven
// merges these splices with any concurrent changes since `baseHeads`.
const merged = await db.documents.update(docId, {
  text: [
    {
      path: ["body"],
      baseHeads: doc!.heads,
      edits: [
        { index: 0, deleteCount: 0, insert: "Hello, " },
        { index: 12, deleteCount: 5, insert: "team" },
      ],
    },
  ],
});

// Delete
await db.documents.delete(docId);

// Undelete (resurrect a deleted document)
await db.documents.undelete(docId);
```

Every `MindooDBAppDocument` snapshot also exposes a `heads?: string[]` field. Those heads identify the document's current Automerge version and are the value you pass to `baseHeads` when issuing the next text patch. After Haven applies and merges your patch, the returned document carries the new `heads` you should use for the following edit cycle.

`documents.list()` is backed by Haven's internal changefeed, not by a positional offset. The query object supports:

| Field                                       | Meaning                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `cursor?: string \| null`                   | Opaque changefeed checkpoint previously returned by `nextCursor`               |
| `limit?: number`                            | Maximum number of matching entries to return (default `50`)                    |
| `skip?: number`                             | Skip matching entries after the cursor without loading full document bodies    |
| `status?: "all" \| "existing" \| "deleted"` | Filter by deletion state (default `"existing"`)                                |
| `metadataOnly?: boolean`                    | Return only `{ id, isDeleted }` for speed                                      |
| `fields?: string[]`                         | Project specific JSON fields when `metadataOnly` is `false`                    |
| `filter?: Record<string, unknown>`          | Simple equality filter applied to document data when `metadataOnly` is `false` |

`nextCursor` is the latest checkpoint reached by the page. Persist it after each successful call when you are building your own index or sync loop. If there were no changes after the supplied cursor, `nextCursor` is `null`.

`documents.update()` accepts five independent kinds of operations on the same call, applied atomically to one new document revision:

- `set` -- assign top-level fields (shallow JSON merge).
- `unset` -- remove top-level fields entirely.
- `json` -- a **granular JSON patch** of `set` / `unset` / `listInsert` / `listDelete` operations applied at specific paths inside `document.data`, against a `baseHeads` version. See [Granular JSON edits](#granular-json-edits) below.
- `text` -- one or more **granular text patches** applied to specific string paths. Each patch carries the `baseHeads` version it was authored against and is merged on the Haven side with any concurrent changes that arrived since. This is the recommended way to edit collaborative text fields like a markdown body. See [Collaborative text editing](#collaborative-text-editing) below.
- `richText` -- one or more **rich-text span snapshots** for formatted-document fields (Word/.docx style). See [Collaborative rich-text editing](#collaborative-rich-text-editing) below.

Prefer sending small, intentional field-level changes instead of rewriting whole documents when only a few fields changed. This keeps MindooDB change tracking more meaningful and helps Automerge produce cleaner merge results.

When Haven can resolve the signing identity from the tenant directory, list items may also include `identityLabel` and `publicKeyFingerprint` for the latest visible change. Apps can use this to show who last touched a document without loading the full revision history first.

### Document history

When the `history` capability is granted, you can walk the document revision list and load historical snapshots. Prefer `revisionId` for follow-up reads: it is a stable, DAG-backed identifier for the exact document revision, while timestamps are mainly useful for display and backwards-compatible point-in-time lookups.

```ts
// List all revisions
const history = await db.documents.listHistory(docId);
// Each entry:
// {
//   revisionId,
//   timestamp,
//   heads?,
//   publicKey,
//   identityLabel?,
//   isDeleted,
//   isCurrent,
//   summary?,
//   dependencyIds?
// }

// Load the document state at an exact DAG revision
const snapshot = await db.documents.getAtRevision(
  docId,
  history[0]!.revisionId,
);
// {
//   id,
//   revisionId,
//   timestamp,
//   heads?,
//   state: "exists" | "deleted" | "missing",
//   data,
//   attachments?,
//   attachmentSnapshotRevisionId?
// }

// Timestamp lookup is still available when all you have is a timestamp.
const pointInTime = await db.documents.getAtTimestamp(
  docId,
  history[0]!.timestamp,
);
```

Historical snapshots include the document data payload as it existed at that revision. When the snapshot has attachments, `attachments` reflects the historical `_attachments` array for that same revision, including the attachment reference that Haven needs to stop at the correct historical `lastChunkId`.

#### What one revision changed

To show a diff, you need both sides of a revision. Pass `{ phase: "before" }` to read the state the revision was written against instead of the state it produced:

```ts
const after = await db.documents.getAtRevision(docId, revisionId);
const before = await db.documents.getAtRevision(docId, revisionId, {
  phase: "before",
});
```

`before` is always a single document, even when the revision merged concurrent branches: it is the merge of all its parents, which is exactly what its author had loaded. For the document's creation there is no prior state, so `before` reports `state: "missing"`.

The `dependencyIds` on each history entry are that revision's parents — the edges of the signed change graph. Since a timeline is only one linearization of that graph, use them to draw or walk the graph itself, and `getAtHeads` to materialize any point in it:

```ts
const merged = await db.documents.getAtHeads(docId, entry.dependencyIds ?? []);
```

An id in `dependencyIds` may name a revision the timeline does not list, because a change that left the document state untouched produces no timeline row. Draw only the edges whose endpoints you have; `getAtHeads` still resolves the full list.

### Granular JSON edits

When you need to edit nested objects or lists inside a document — not just top-level fields — describe the change as a **granular JSON patch** rather than rewriting the whole document. This is the model behind structured collaborative editing in apps like [`mindoodb-app-teamgrid`](https://github.com/klehmann/mindoodb-app-teamgrid), where two users can insert different rows into the same worksheet on different devices and the merge keeps both sides cleanly.

A JSON patch is a bag of four operation kinds applied at specific JSON paths inside `document.data`, all carried with the document version (`baseHeads`) the app was looking at when it composed them:

- `set` — assign or replace a value at a path
- `unset` — remove a key (or list entry, when the host accepts it) at a path
- `listInsert` — splice values into a list at a position
- `listDelete` — remove a contiguous run of entries from a list

```ts
interface MindooDBAppJsonSetPatch {
  path: Array<string | number>;
  value: unknown;
}

interface MindooDBAppJsonUnsetPatch {
  path: Array<string | number>;
}

interface MindooDBAppJsonListInsertPatch {
  path: Array<string | number>;
  index: number;
  values: unknown[];
}

interface MindooDBAppJsonListDeletePatch {
  path: Array<string | number>;
  index: number;
  deleteCount: number;
}

interface MindooDBAppJsonPatch {
  baseHeads?: string[];
  set?: MindooDBAppJsonSetPatch[];
  unset?: MindooDBAppJsonUnsetPatch[];
  listInsert?: MindooDBAppJsonListInsertPatch[];
  listDelete?: MindooDBAppJsonListDeletePatch[];
}
```

Send the patch through `documents.update({ json })`:

```ts
const doc = await db.documents.get(docId);

await db.documents.update(docId, {
  json: {
    baseHeads: doc!.heads,
    set: [
      { path: ["worksheets", "ws-1", "title"], value: "Q1 numbers" },
      {
        path: ["worksheets", "ws-1", "cellsByRowCol", "row-3:col-2", "value"],
        value: 42,
      },
    ],
    listInsert: [
      {
        path: ["worksheets", "ws-1", "rowOrder"],
        index: 5,
        values: ["row-new"],
      },
    ],
    listDelete: [
      {
        path: ["worksheets", "ws-1", "tombstoneRows"],
        index: 0,
        deleteCount: 1,
      },
    ],
  },
});
```

Haven applies the patch causally at `baseHeads` and merges it with any concurrent changes that arrived since, the same way the text and rich-text APIs do. List inserts authored against the same `baseHeads` interleave cleanly via Automerge's list CRDT instead of overwriting each other — which is exactly what makes two users inserting different rows on the same worksheet at the same time merge into a consistent grid rather than a last-writer-wins.

Patch flavors compose. `set`/`unset` (top-level fields), `json`, `text`, and `richText` can all appear in the same `documents.update()` call and are applied atomically to one new document revision. Prefer small, intentional operations over whole-document rewrites so MindooDB change tracking stays meaningful and Automerge produces cleaner merges.

### Collaborative text editing

MindooDB stores collaborative text fields as Automerge text CRDTs internally, but apps never touch Automerge directly -- the SDK bridge is JSON-only. Instead, your app describes text changes as **granular splice operations** against a known document version, and Haven applies and merges them on its side.

Two layers are available:

- **Low level**: raw text patches via `documents.update({ text: [...] })`.
- **High level**: `createMindooDBTextBuffer(...)` -- a small editor-friendly helper that tracks local edits and flushes them as one patch.

The end-to-end flow is the same in both cases:

```
            ┌────────────────────────────────────────────────────┐
  edit ───► │ App buffer (local string + pending splices)        │ ──► flush
            └─────────────────────────┬──────────────────────────┘
                                      │ documents.update({
                                      │   text: [{ path, baseHeads, edits }]
                                      │ })
                                      ▼
            ┌────────────────────────────────────────────────────┐
            │ Haven applies edits at `baseHeads` and merges with │
            │ concurrent changes via Automerge                   │
            └─────────────────────────┬──────────────────────────┘
                                      │ canonical merged document
                                      ▼
            ┌────────────────────────────────────────────────────┐
            │ App reconciles its editor with the canonical text  │
            └────────────────────────────────────────────────────┘
```

#### Text patch shape

```ts
interface MindooDBAppTextEdit {
  index: number; // 0-based position in the current string at baseHeads
  deleteCount: number; // number of characters to remove at `index`
  insert?: string; // text to insert at `index` after deletion
}

interface MindooDBAppTextPatch {
  path: Array<string | number>; // path inside `document.data`, e.g. ["body"]
  baseHeads?: string[]; // document version the edits were authored against
  edits: MindooDBAppTextEdit[]; // applied in order
}
```

Each edit is a JavaScript-style `splice(index, deleteCount, insert)`. Multiple patches in a single `update()` call are applied atomically.

#### Low-level: `documents.update({ text: [...] })`

If your editor already exposes raw text operations (e.g. ProseMirror or CodeMirror transactions), forward them directly:

```ts
const doc = await db.documents.get(docId);

// User typed "Hello, " at the beginning of the body.
const result = await db.documents.update(docId, {
  text: [
    {
      path: ["body"],
      baseHeads: doc!.heads,
      edits: [{ index: 0, deleteCount: 0, insert: "Hello, " }],
    },
  ],
});

// `result.data.body`  -- canonical merged text
// `result.heads`      -- new heads to use as `baseHeads` next time
```

When two app instances send patches concurrently against the same `baseHeads`, Haven merges both via Automerge and returns the canonical text. If the merged result differs from what your editor currently displays, replace the editor content with `result.data[path]`.

#### High-level: `createMindooDBTextBuffer`

For WYSIWYG editors that emit a full markdown / plain-text string after each transaction (Milkdown, TinyMCE, etc.), the SDK ships a small buffer helper that does the splice diffing and flush bookkeeping for you:

```ts
import { createMindooDBTextBuffer } from "mindoodb-app-sdk";

const doc = await db.documents.get(docId);
const buffer = createMindooDBTextBuffer({
  database: db,
  document: doc!,
  path: ["body"], // string field inside `document.data`
});

editor.value = buffer.value;

// Editor reports a new full markdown value -- the buffer turns it into one splice.
editor.on("update", (next: string) => {
  buffer.replaceText(next);
});

// On save (e.g. Cmd+S), flush all pending edits to Haven.
async function save() {
  const result = await buffer.flush();
  if (result.reconciled) {
    // Haven merged in concurrent changes; show the canonical merged text.
    editor.value = result.value;
  }
}

// Re-read the document without saving (e.g. a Refresh button).
async function refresh() {
  const fresh = await db.documents.get(docId);
  if (fresh && buffer.reconcile(fresh)) {
    editor.value = buffer.value;
  }
}
```

Buffer API at a glance:

| Member                                | Description                                                                |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `value` / `toString()`                | Current local text value                                                   |
| `dirty` / `pendingCount`              | Whether/how many local splices are buffered                                |
| `splice(index, deleteCount, insert?)` | Record an exact text operation                                             |
| `replaceText(next)`                   | Diff `value` against `next` and record one minimal splice                  |
| `reconcile(document)`                 | Adopt a fresh document snapshot, drop pending edits                        |
| `flush()`                             | Send pending edits to Haven; resolves to `{ document, value, reconciled }` |

`flush()` always sends the original `baseHeads` captured when the buffer was created (or last reconciled), so two windows editing the same document at the same heads will both produce a clean merge -- they will not overwrite each other.

#### Concurrent-edit walkthrough

1. Window A and window B both `documents.get(docId)` and create a buffer at the same `baseHeads`.
2. Window A inserts text at the top, window B deletes a paragraph in the middle.
3. Window A calls `buffer.flush()` first. Haven applies its patch, advances the document heads, and returns the canonical text to A.
4. Window B calls `buffer.flush()` next. Haven still applies B's patch causally at B's original `baseHeads`, then merges with A's already-stored change. B's `result.reconciled` is `true` and `result.value` contains both A's and B's edits.

#### End-to-end sample

The [`mindoodb-app-teamedit`](https://github.com/klehmann/mindoodb-app-teamedit) sample wires `MindooDBTextBuffer` to a Milkdown markdown editor with Save / Refresh / preview pane, and is the recommended starting point for building your own collaborative text app.

### Collaborative rich-text editing

For structured documents that need formatting — headings, bold/italic runs, lists, tables, fonts, colors — use the **rich-text patch API**. This is the surface behind the Word/.docx mode in [`mindoodb-app-teamedit`](https://github.com/klehmann/mindoodb-app-teamedit), where two users can edit the same document at the same time and Haven merges both formatting and structure on its side via Automerge's rich-text CRDT.

Rich-text fields are stored internally as Automerge rich-text, but apps never see Automerge directly. The bridge speaks JSON and represents a rich-text field as an ordered list of **spans** — text runs with marks for inline formatting, plus block markers for paragraphs, headings, lists, and tables:

```ts
interface MindooDBAppRichTextTextSpan {
  type: "text";
  value: string;
  // Inline marks: bold, italic, underline, font, color, link, ...
  marks?: Record<string, MindooDBAppRichTextMaterializeValue>;
}

interface MindooDBAppRichTextBlockSpan {
  type: "block";
  // Block markers: paragraph, heading, list item, table cell, ...
  value: Record<string, MindooDBAppRichTextMaterializeValue>;
}

type MindooDBAppRichTextSpan =
  | MindooDBAppRichTextTextSpan
  | MindooDBAppRichTextBlockSpan;
```

#### Reading the current spans

```ts
const snapshot = await db.documents.getRichText(docId, ["body"]);
// snapshot = { path: ["body"], heads: ["<commit>"], spans: [...] }

editor.loadFromSpans(snapshot.spans);
```

`getRichText(docId, path, options?)` also accepts `{ revisionId }` so you can load the rich-text spans of an exact historical document revision (handy for read-only revision pickers).

#### Writing back a span snapshot

The simplest write is a full snapshot — replace the field's spans with the editor's current state:

```ts
await db.documents.update(docId, {
  richText: [
    {
      path: ["body"],
      baseHeads: snapshot.heads,
      spans: editor.toSpans(),
    },
  ],
});
```

Haven applies the snapshot via Automerge's `updateSpans` and merges it with any concurrent rich-text changes that arrived since `baseHeads`. The optional `updateSpansConfig` field is forwarded to Automerge for editors that need to tune merge behavior at the span level.

#### High-level: `createMindooDBRichTextHandle`

For editors that emit a complete spans array after each transaction, the SDK ships a buffer helper that mirrors `MindooDBTextBuffer`:

```ts
import { createMindooDBRichTextHandle } from "mindoodb-app-sdk";

const doc = await db.documents.get(docId);
const initial = await db.documents.getRichText(doc!.id, ["body"]);

const handle = createMindooDBRichTextHandle({
  database: db,
  document: doc!,
  path: ["body"],
  spans: initial.spans,
});

editor.loadFromSpans(handle.spans);

// Editor reports a fresh spans array after every change.
editor.on("change", (spans) => {
  handle.replaceSpans(spans);
});

// On save (e.g. Cmd+S) flush the local snapshot to Haven.
async function save() {
  const result = await handle.flush();
  if (result.reconciled) {
    // Haven merged in concurrent rich-text edits; show the canonical merged spans.
    editor.loadFromSpans(result.snapshot.spans);
  }
}

// Optional: poll for remote changes while the editor is idle.
handle.startPolling(2000);
handle.on("change", (snapshot) => {
  if (!handle.dirty) editor.loadFromSpans(snapshot.spans);
});
```

Handle API at a glance:

| Member                               | Description                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `spans`                              | Current local span snapshot                                                   |
| `dirty`                              | Whether local edits are buffered                                              |
| `baseHeads`                          | Heads the local snapshot was authored against                                 |
| `replaceSpans(spans)`                | Replace the local spans buffer with a fresh snapshot                          |
| `refresh()`                          | Re-read `getRichText` and return the canonical snapshot                       |
| `pollOnce()`                         | Re-read and reconcile if the document advanced and there are no local edits  |
| `startPolling(ms)` / `stopPolling()` | Poll `pollOnce` on a timer                                                    |
| `flush(updateSpansConfig?)`          | Send pending spans to Haven; resolves to `{ document, snapshot, reconciled }` |
| `on/off("change", listener)`         | Subscribe to local or reconciled-change events                                |

Like the text buffer, the rich-text handle always sends the original `baseHeads` captured when it was created or last reconciled, so two windows editing the same document at the same heads merge correctly without overwriting each other.

#### End-to-end sample

The Word/.docx mode in [`mindoodb-app-teamedit`](https://github.com/klehmann/mindoodb-app-teamedit) is the **only supported in-repo use case** for the Automerge binary sync API below — it needs a local replica and binary flush because `set`/`unset` and the JSON patch APIs are not sufficient for that editor. For span-only rich-text apps, use `createMindooDBRichTextHandle` instead.

### Automerge binary sync (advanced)

> **Avoid these APIs unless you have no alternative.** For normal app editing, use `documents.update({ set })`, `documents.update({ unset })`, and the JSON patch operations (`text`, `richText`, `json`) documented above. `getAutomergeSnapshot` and `applyAutomergeChanges` were added as an **escape hatch** for the one case where those APIs are not enough: TeamEdit's Word/.docx mode, which hosts a local `@automerge/automerge` replica and flushes raw change bytes on save. Do not adopt binary sync for new features unless you have the same constraint — you take on an Automerge dependency, manual replica lifecycle, and a much harder integration path.

If you must use binary sync, Haven decrypts the canonical document, merges incoming change batches with `Automerge.applyChanges`, and persists the result. Your app never sends encrypted blobs or sync metadata; it only sends the same binary change format Automerge produces locally.

Typical flow:

```
            ┌────────────────────────────────────────────────────┐
  open  ──► │ getAutomergeSnapshot → load local replica          │
            └─────────────────────────┬──────────────────────────┘
                                      │
  edit  ──► │ Local Automerge doc (or span edits applied locally)  │
            └─────────────────────────┬──────────────────────────┘
                                      │ getChangesSince(baseHeads)
                                      ▼
            ┌────────────────────────────────────────────────────┐
  save  ──► │ applyAutomergeChanges({ baseHeads, replicaHeads,   │
            │                       changes })                   │
            └─────────────────────────┬──────────────────────────┘
                                      │ Haven merges + persists
                                      ▼
            ┌────────────────────────────────────────────────────┐
            │ Apply result.changesSince locally (or skip if empty) │
            └────────────────────────────────────────────────────┘
```

Bridge RPCs: `documents.automerge.getSnapshot` and `documents.automerge.applyChanges`.

#### `getAutomergeSnapshot`

Export the full internal Automerge document as a binary snapshot plus the current document heads:

```ts
const snapshot = await db.documents.getAutomergeSnapshot(docId);
// snapshot = { binary: Uint8Array, heads: string[] }

const localDoc = Automerge.load(snapshot.binary);
const baseHeads = [...snapshot.heads];
```

Options:

```ts
interface MindooDBAppAutomergeGetOptions {
  revisionId?: MindooDBAppDocumentRevisionId; // historical read via documents.listHistory()
}
```

Only call this when binary sync is unavoidable — e.g. opening a local replica, refreshing after `applyAutomergeChanges`, or read-only historical preview at a `revisionId`. For normal reads, use `getRichText` or `documents.get`.

#### `applyAutomergeChanges`

Merge a batch of raw Automerge change bytes into the canonical document on Haven:

```ts
const changes = Automerge.getChangesSince(localDoc, baseHeads as Automerge.Heads);
const replicaHeads = Automerge.getHeads(localDoc);

const result = await db.documents.applyAutomergeChanges(docId, {
  baseHeads, // optional metadata: heads when the local batch was authored
  replicaHeads, // local heads after authoring; enables incremental catch-up in the response
  changes: changes.map((change) => new Uint8Array(change)),
});

// result.document — updated MindooDBAppDocument snapshot (includes merged data + heads)
// result.heads     — new Automerge heads after the merge
// result.changesSince — incremental bytes to reconcile the local replica (when replicaHeads was sent)
if (result.changesSince?.changes.length) {
  [localDoc] = Automerge.applyChanges(
    localDoc,
    result.changesSince.changes.map((change) => new Uint8Array(change)),
  );
}
baseHeads = [...result.heads];
```

Patch and result types:

```ts
interface MindooDBAppAutomergeChangesPatch {
  baseHeads?: string[];   // correlation only; merge is not rejected when Haven moved on
  replicaHeads?: string[]; // local heads after authoring `changes`; enables `changesSince` in the response
  changes: Uint8Array[];  // from Automerge.getChangesSince (or equivalent)
}

interface MindooDBAppAutomergeChangesSince {
  sinceHeads: string[];   // echo of `replicaHeads`
  changes: Uint8Array[];  // apply locally with Automerge.applyChanges
}

interface MindooDBAppAutomergePatchResult {
  document: MindooDBAppDocument;
  heads: string[];
  changesSince?: MindooDBAppAutomergeChangesSince;
}
```

Haven applies `changes` with `Automerge.applyChanges` against its **current** document, so concurrent edits from other clients are merged by Automerge's CRDT logic rather than rejected. `baseHeads` is optional logging metadata — it does not gate the merge.

When you include `replicaHeads` (the local replica's heads after authoring your batch), the response includes `changesSince`: the incremental change bytes your replica still needs after the merge. Apply them locally with `Automerge.applyChanges` and set `baseHeads = result.heads`. When there was no concurrent edit, `changesSince.changes` is empty and your local doc is already up to date — no full snapshot download needed. Omit `replicaHeads` only if you plan to reload via `getAutomergeSnapshot` instead.

#### When to use binary sync vs JSON patches

| Approach | App sends | When to use |
| -------- | --------- | ----------- |
| `documents.update({ set })` / `{ unset }` | Field paths | **Default** for structured document data |
| `documents.update({ richText })` | JSON span snapshots | **Default** for rich-text fields |
| `documents.update({ text })` | Text splices | Plain markdown / string fields |
| `documents.update({ json })` | JSON Patch (RFC 6902) | Arbitrary nested JSON paths |
| `applyAutomergeChanges` | Binary change bytes | **Last resort only** — TeamEdit Word/.docx with a local Automerge replica |

Requires the `update` capability (same as other write operations). For historical reads, prefer `getRichText(..., { revisionId })`; only use `getAutomergeSnapshot(..., { revisionId })` when you truly need the full binary at a revision.

#### Reference implementation (not a template)

TeamEdit's Word/.docx mode is why these RPCs exist — see `wordAutomergeHandle.ts` in [`mindoodb-app-teamedit`](https://github.com/klehmann/mindoodb-app-teamedit). Treat it as a reference for an unsupported edge case, not as a pattern to copy into new apps.

### Queries & Live Queries

`documents.query()` runs ad-hoc queries against the database's **document summary buffer** on the host: declarative filtering, dynamic sorting, paging, and field projection — without materializing documents. This is the fastest way to find and order documents from an app and the right default for lists, search results, and dashboards.

```ts
import { createViewLanguage } from "mindoodb-app-sdk";

const v = createViewLanguage<{ type: string; total: number }>();

const result = await db.documents.query({
  filter: v.and(
    v.eq(v.field("type"), v.string("invoice")),
    v.gt(v.toNumber(v.field("total")), v.number(100)),
  ),
  sortBy: [{ field: "total", direction: "descending" }],
  limit: 50,
  offset: 0,
  fields: ["total", "customer"],
});

console.log(result.total); // matching docs before paging
console.log(result.coverage); // "full" | "rebuilding" | "full-scan"
for (const row of result.rows) {
  console.log(row.docId, row.fields, row.lastModified);
}
```

The `filter` also accepts formula source text, which the SDK parses locally before it crosses the bridge (only the JSON expression AST travels):

```ts
const invoices = await db.documents.query({
  filter: 'v.eq(v.field("type"), "invoice")',
});
```

Notes:

- The host caps `limit` (default 200, maximum 1000) so result payloads stay bounded. Page with `offset` for more rows.
- `coverage: "rebuilding"` means the summary buffer is still backfilling — results may be incomplete and will improve on their own.
- Queries that reference encrypted fields or fields outside the summary configuration are rejected with a `query-not-supported` bridge error. Use a view with `useFullDocuments` (see below) or `documents.list()` for those cases.
- Queries require the `read` capability and are not available in time-travel launches (the summary buffer reflects the live state only).

**Full-text search** — a query can additionally carry a `text` clause, evaluated against the database's client-side full-text index on the host and combined with `filter` as a logical AND:

```ts
const result = await db.documents.query({
  text: { query: "solar panels" },              // full-text match + relevance score
  filter: 'v.eq(v.field("type"), "article")',   // optional structured filter
});

for (const row of result.rows) {
  console.log(row.docId, row.textScore);        // higher score = better match
}
```

- Options: `fields` (restrict matching to specific index fields), `prefix` (default `true` — `"sol"` matches `"solar"`), `fuzzy` (edit-distance tolerance, default off), `combineWith` (`"AND"` default | `"OR"`).
- Rows gain a `textScore`; without an explicit `sortBy`, results come best score first. Sorting can reference the score explicitly with `sortBy: [{ special: "textScore", direction: "descending" }]`.
- Full-text indexing is **opt-in per database** (`fulltextSetup` in the `dbsetup` document). A `text` clause against a database without it is rejected with a `fulltext-not-enabled` bridge error — catch it and hide/disable the search UI.
- `liveQuery` supports `text` clauses unchanged; the host rounds scores in its result fingerprint so minor relevance drift does not spam your callback.

**Enabling full-text indexing** — apps turn indexing on themselves through the database handle. The configuration is stored in the synced `dbsetup` document, so it applies on every replica (each device builds its own local, encrypted index):

```ts
// Idempotent — safe to call on every app start (no write when unchanged).
// Requires the `update` capability.
await db.setFulltextSetup({
  enabled: true,
  attachments: true, // index text extracted from attachments (PDF, Office, …)
  language: "de",    // BCP-47 tag steering tokenization; omit for language-neutral
});

const setup = await db.getFulltextSetup(); // null when never configured
```

- Without `include`, every non-underscore top-level field with extractable text is indexed (auto mode). Pass `include: ["subject", "body"]` to pin the indexed fields, including nested/long-text fields outside the summary buffer.
- `attachments: true` indexes attachment text under the synthetic `_attachments` field using the host's extractors (Haven ships anydoc for Office/PDF/… plus plain-text extractors). Restrict a query to attachment content with `text: { query, fields: ["_attachments"] }`.
- Changing the configuration (including `language`) rebuilds the index in the background; queries during the rebuild report `coverage: "rebuilding"`.

**Extracting text from bytes you already have** (requires `attachments`):

```ts
const stream = await db.attachments.openReadStream(docId, fileName);
const chunks: Uint8Array[] = [];
for (;;) {
  const chunk = await stream.read();
  if (chunk === null) break;
  chunks.push(chunk);
}
await stream.close();
const bytes = concatUint8Arrays(chunks); // your helper

const { text, handled, format, engine } = await db.attachments.extractText({
  bytes,
  mimeType: "application/pdf",
  fileName,
  format: "markdown", // default — or "plainText"
});
if (handled) {
  console.log(engine, format, text.slice(0, 200));
}
```

**Live queries** keep a query result up to date. The callback receives the initial result and runs again whenever the result actually changed — the host coalesces bursts of writes and fingerprints results, so you only hear about real changes:

```ts
const subscription = await db.documents.liveQuery(
  { filter: 'v.eq(v.field("status"), "open")', limit: 100 },
  (result) => {
    renderList(result.rows);
  },
);

// Force a re-evaluation (delivers a result even when nothing changed):
await subscription.refresh();

// Always dispose when the consuming UI goes away:
await subscription.dispose();
```

Live query results are pushed from the host over the bridge port — no polling. Subscriptions are cleaned up automatically when the app disconnects, but dispose them explicitly when the UI that consumes them unmounts.

### Incremental sync

The changefeed-backed `documents.list()` API is also the right primitive for app-side indexes, search, and other derived caches. For plain "show me matching documents" use cases, prefer [`documents.query()`](#queries--live-queries); the changefeed shines when you need deletions and a durable resume checkpoint for derived state.

**Initial scan from the beginning:**

```ts
let cursor: string | null = null;

while (true) {
  const page = await db.documents.list({
    cursor,
    limit: 500,
    status: "all",
    metadataOnly: true,
  });

  for (const item of page.items) {
    if (!item.isDeleted) {
      const doc = await db.documents.get(item.id);
      // add or rebuild the derived index entry
    }
  }

  if (!page.nextCursor) {
    break;
  }
  cursor = page.nextCursor;
}

// Save `cursor` after the last non-empty page.
```

**Resume later from the saved checkpoint:**

```ts
const page = await db.documents.list({
  cursor: savedCursor,
  limit: 500,
  status: "all",
  metadataOnly: true,
});

let updated = 0;
let deleted = 0;

for (const item of page.items) {
  if (item.isDeleted) {
    deleted += 1;
    // remove from index
  } else {
    updated += 1;
    const doc = await db.documents.get(item.id);
    // update index
  }
}

console.log(`Updated index with ${updated} changes and ${deleted} deletions.`);
```

Use `status: "all"` for external indexes so deletions are visible and can be removed from your derived state.

### Attachments

When the `attachments` capability is granted, each document can carry file attachments. The SDK uses **chunked binary streams** over the bridge for uploads and downloads:

```ts
// List attachments for a document
const files = await db.attachments.list(docId);
// Each: { attachmentId, fileName, mimeType, size }

// Download (pull-based read stream)
const reader = await db.attachments.openReadStream(docId, "report.pdf");
const chunks: Uint8Array[] = [];
let chunk = await reader.read();
while (chunk !== null) {
  chunks.push(chunk);
  chunk = await reader.read();
}
await reader.close();

// Upload (push-based write stream)
const writer = await db.attachments.openWriteStream(
  docId,
  "photo.jpg",
  "image/jpeg",
);
await writer.write(fileBytes);
await writer.close();

// Host-provided document scanner
const scan = await db.attachments.scan(docId, {
  defaultFileName: "invoice.pdf",
  preset: "a4-portrait",
  mimeType: "application/pdf",
});
// scan = { ok: true, attachment: { attachmentId, fileName, mimeType, size } }
//   or { ok: false }                    if the user cancelled the scanner
//   or rejected with an error           if the host has no scanner UI

// Remove
await db.attachments.remove(docId, "old-file.txt");
```

`attachments.scan()` asks Haven to open its document scanner UI on top of your app. Haven handles camera or file selection, runs edge detection through a slim on-device OpenCV WebAssembly pipeline, lets the user fine-tune the corners, applies the perspective correction to the chosen output size, and writes the resulting bytes as a normal MindooDoc attachment via the same path `openWriteStream` would have taken. The user can add further pages; two or more pages always come back as one multi-page PDF. The scanner runs entirely locally — the picked image and the perspective-corrected result never leave the browser tab.

Options shape:

```ts
type MindooDBAppDocumentScanPreset =
  | "auto"            // free-form, keep the detected aspect ratio
  | "a4-portrait"
  | "a4-landscape"
  | "letter-portrait"
  | "letter-landscape";

interface MindooDBAppScanAttachmentOptions {
  defaultFileName?: string;                                  // suggested filename in the dialog
  preset?: MindooDBAppDocumentScanPreset;                    // output page geometry
  mimeType?: "image/jpeg" | "image/png" | "application/pdf"; // output format
}

interface MindooDBAppScanAttachmentResult {
  ok: boolean;
  attachment?: MindooDBAppAttachmentInfo | null;
}
```

Apps need both the `attachments` and `update` capabilities for this method, because the scanner writes the resulting bytes back to the document. Hosts that do not provide scanner UI may reject this method or return `{ ok: false }`.

The same scanner is also reachable as a top-level **Quick Scan** entry in Haven's sidebar. There it runs detached from any document — the user can download the resulting file or hand it to the operating system's share sheet, but the "Add to document" action is hidden because there is no document context. Apps do not need to do anything to support this; it is part of Haven, not the SDK.

For historical reads, pass the same `revisionId` you received from `documents.listHistory()` or from a `MindooDBAppHistoricalDocument`. This tells Haven to resolve the attachment from that revision's document payload instead of the latest document state:

```ts
const history = await db.documents.listHistory(docId);
const revisionId = history[0]!.revisionId;
const historical = await db.documents.getAtRevision(docId, revisionId);

const historicalFiles = await db.attachments.list(docId, {
  revisionId,
});

const historicalReader = await db.attachments.openReadStream(
  docId,
  historicalFiles[0]!.fileName,
  { revisionId },
);
```

Use `revisionId` instead of `timestamp` whenever possible. Attachment blobs can grow over time by appending chunks and changing the attachment's `lastChunkId` in newer document revisions; `revisionId` ensures Haven reads from the historical attachment reference and does not accidentally include chunks added later.

### Attachment previews

Haven includes a **built-in file viewer** that your app can open for common attachment formats. This is one of the most powerful SDK features -- it works with both online and offline data, and media formats support streaming playback with skip/seek.

**Supported preview formats:**

| Mode          | Formats                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `image`       | All common image formats (JPEG, PNG, GIF, WebP, SVG, ...)                                              |
| `pdf`         | PDF documents                                                                                          |
| `markdown`    | Markdown rendered to HTML (.md, .markdown, .mdown, .mkd, .mkdn)                                        |
| `text`        | Plain text, CSV, JSON, XML, YAML, SVG, log files                                                       |
| `docx`        | Microsoft Word (.docx)                                                                                 |
| `pptx`        | Microsoft PowerPoint (.pptx)                                                                           |
| `spreadsheet` | Microsoft Excel (.xls, .xlsx, .xlsm, .xlsb)                                                            |
| `video`       | Video files with embedded player, streaming + seek (.mp4, .m4v, .webm, .ogv, .ogg, plus any `video/*`) |
| `audio`       | Audio files with embedded player, streaming + seek (.mp3, .m4a, .wav, .aac, .oga, plus any `audio/*`)  |

**Open the Haven preview dialog:**

```ts
await db.attachments.openPreview(docId, "presentation.pptx");
```

You can also preview attachments from a **historical document snapshot**:

```ts
await db.attachments.openPreview(docId, "report.pdf", {
  revisionId: historyEntry.revisionId,
});
```

`timestamp` is still accepted in attachment options for compatibility, but `revisionId` is the preferred identifier because it targets an exact DAG revision.

**Check preview support locally** before showing a preview button:

```ts
import { canPreviewAttachment } from "mindoodb-app-sdk";

const mode = canPreviewAttachment("slides.pptx", "application/octet-stream");
// Returns "pptx" -- Haven can preview this file

const unsupported = canPreviewAttachment(
  "data.bin",
  "application/octet-stream",
);
// Returns null -- no built-in preview available
```

### Virtual Views

Views let you query documents with categorization, sorting, filtering, and aggregation -- similar to a spreadsheet pivot table. The SDK now exposes a **stateful navigator API** that mirrors the core `VirtualViewNavigator` closely.

There are two ways to open one:

**App-defined multi-database views** -- create a view definition programmatically and immediately open a navigator:

```ts
import { createViewLanguage } from "mindoodb-app-sdk";

const v = createViewLanguage<{ employee: string; hours: number }>();

const navigator = await session.createViewNavigator({
  databaseIds: ["main", "archive"],
  definition: {
    title: "Hours by employee",
    defaultExpand: "collapsed",
    filter: {
      mode: "expression",
      expression: v.gt(v.toNumber(v.field("hours")), v.number(0)),
    },
    columns: [
      {
        name: "employee",
        title: "Employee",
        role: "category",
        expression: v.field("employee"),
        sorting: "ascending",
      },
      {
        name: "hours",
        title: "Hours",
        role: "display",
        expression: v.toNumber(v.field("hours")),
      },
    ],
  },
});

const batch = await navigator.entriesForward({ limit: 100 });
console.log(batch.entries);

await navigator.dispose();
```

**Haven-configured views** -- open a view that Haven attached to the app registration:

```ts
const viewDefs = ctx.views; // from launch context

const navigator = await session.openViewNavigator(viewDefs[0]!.id, {
  includeCategories: true,
  includeDocuments: true,
  hideEmptyCategories: true,
});

await navigator.gotoFirst();
const current = await navigator.getCurrentEntry();
console.log(current);

await navigator.dispose();
```

#### Common navigator patterns

**Single-step traversal**:

```ts
await navigator.gotoFirst();

do {
  const entry = await navigator.getCurrentEntry();
  if (entry) {
    console.log(entry.kind, entry.categoryPath, entry.columnValues);
  }
} while (await navigator.gotoNext());
```

**Batch reads for UI rendering**:

```ts
const page1 = await navigator.entriesForward({ limit: 50 });
const page2 = page1.nextPosition
  ? await navigator.entriesForward({
      limit: 50,
      startPosition: page1.nextPosition,
    })
  : null;
```

**Category lookup plus child traversal**:

```ts
const category = await navigator.findCategoryEntryByParts(["Ada"]);
if (category) {
  const docs = await navigator.childDocuments(category.key);
  console.log(docs.map((entry) => entry.docId));
}
```

**Key lookup and key-range lookup**:

```ts
const category = await navigator.findCategoryEntryByParts(["Ada"]);
if (category) {
  const exact = await navigator.childDocumentsByKey(
    category.key,
    "2026-04-14",
    true,
  );
  const range = await navigator.childDocumentsBetween(category.key, {
    startKey: "2026-04-01",
    endKey: "2026-04-30",
  });
}
```

**Expansion and selection state**:

```ts
await navigator.expandAll();
await navigator.select("main", "doc-123");

const expansion = await navigator.getExpansionState();
const selection = await navigator.getSelectionState();

await navigator.setExpansionState(expansion);
await navigator.setSelectionState(selection);
```

**Live updates** -- the host keeps the view bound to its source databases' change feeds. Subscribe with `onDidUpdate` and re-read the visible page when it fires; there is no need to poll or call `refresh()`:

```ts
const unsubscribe = navigator.onDidUpdate(({ addedCount, removedCount }) => {
  console.log(`view changed: +${addedCount} / -${removedCount}`);
  void rerenderVisiblePage();
});

// later, when the consuming UI unmounts:
unsubscribe();
```

The expression language is fully declarative: apps define filter and column logic through a typed builder API that compiles to JSON-safe expression objects. No app-provided JavaScript runs inside the bridge host.

#### Performance notes

- Navigator views are built **summary-first**: whenever the view definition (filter + column expressions) can be answered from the database's document summary buffer, the host feeds the view from the summary without materializing a single document. Views fall back to the (slower) document path automatically when they need decrypted fields, JS value functions, or fields outside the summary configuration.
- Pass `useFullDocuments: true` in `createViewNavigator` input to force the document path explicitly — the escape hatch for views that deliberately need full document data.
- `goto*()` and `getCurrentEntry()` are lightweight stateful cursor operations. They may still produce many bridge round-trips if you call them for every rendered row.
- `entriesForward()` and `entriesBackward()` exist specifically to reduce those round-trips for UI rendering.
- `refresh()` performs an incremental catch-up on the host-side view (no pipeline rebuild). With `onDidUpdate` in place you rarely need it — the host pushes updates on its own.
- `session.listDocumentsSinceViewCursor(cursor)` remains available as a **legacy polling/delta-sync path**; prefer `onDidUpdate` pushes and `documents.liveQuery()` for keeping UI current.
- Child/key/range helpers operate on the same host-side navigator session. They do not create a separate query engine.

Available expression helpers:

- **Field access:** `field()`, `value()`, `origin()`
- **Literals and conversion:** `literal()`, `string()`, `number()`, `boolean()`, `toNumber()`, `toString()`, `toBoolean()`
- **Math and comparisons:** `add()`, `sub()`, `mul()`, `div()`, `mod()`, `eq()`, `neq()`, `gt()`, `gte()`, `lt()`, `lte()`
- **Boolean logic:** `and()`, `or()`, `not()`
- **String helpers:** `concat()`, `lower()`, `upper()`, `trim()`, `contains()`, `startsWith()`, `endsWith()`
- **Null/existence:** `coalesce()`, `exists()`, `notExists()`
- **Date/path:** `datePart()`, `pathJoin()`
- **Control flow:** `ifElse()`, `let()` — `ifElse()` accepts multiple condition/value pairs followed by a default, like Domino's `@If`: `v.ifElse(cond1, val1, cond2, val2, default)`

The full language guide lives in the `mindoodb-view-language` package. The SDK re-exports `createViewLanguage()` for convenience.

## Testing without Haven

You do **not** need a full Haven environment to test apps that use `mindoodb-app-sdk`.

The SDK ships a dedicated `mindoodb-app-sdk/testing` entrypoint with two levels of test helpers:

- **Level 1 -- app tests:** Returns a fake `MindooDBAppSession` and bridge for unit, composable, store, and component tests. No `postMessage` or `MessageChannel` involved. With the optional `mindoodb` peer, `createViewNavigator` evaluates view definitions against seeded documents (same VirtualView engine as Haven).
- **Level 2 -- bridge protocol tests:** A fake host harness that exercises the real `createMindooDBAppBridge()` handshake over `postMessage` and `MessageChannel`. Useful for integration-style tests.

Use Level 1 when you are testing app behavior. Use Level 2 when you want to validate the bridge transport itself.

See [`TESTING.md`](./TESTING.md) for setup instructions and Vitest examples.

## Deployment

MindooDB Apps are standard web applications -- deploy them anywhere you can serve static files.

**Cloudflare Pages / Workers** is one of the easiest options. The [example app](https://github.com/klehmann/mindoodb-app-example) is deployed this way at https://app-example.mindoodb.com using a simple `wrangler.jsonc` configuration:

```bash
pnpm build
wrangler deploy
```

Other static hosting options work just as well: Netlify, Vercel, any web server serving your `dist/` folder.

**Haven-hosted bundles** are an alternative: import your built app directly into Haven, where it is served by a service worker on an opaque origin. Haven-hosted apps load without a network connection and receive a stricter sandbox.

## Local development workflow

For interactive development with the full Haven host bridge:

1. Run Haven locally.
2. Run your app on its own dev server (e.g. `pnpm dev` with Vite).
3. Register the dev server URL in Haven's Application settings.
4. Map databases and optionally views to the app.
5. Launch from Haven -- you get hot reload, real bridge communication, and live theme/viewport events.

This is separate from the automated testing workflow above. Running Haven is useful for interactive development but not required for Level 1 or Level 2 tests.

## API reference

### MindooDBAppBridge

| Method              | Returns                       |
| ------------------- | ----------------------------- |
| `connect(options?)` | `Promise<MindooDBAppSession>` |

Connect options: `launchId?`, `targetOrigin?`, `connectTimeoutMs?`.

### MindooDBAppSession

| Method                                | Returns                              |
| ------------------------------------- | ------------------------------------ |
| `getLaunchContext()`                  | `Promise<MindooDBAppLaunchContext>`  |
| `listDatabases()`                     | `Promise<MindooDBAppDatabaseInfo[]>` |
| `openDatabase(databaseId)`            | `Promise<MindooDBAppDatabase>`       |
| `createViewNavigator(input)`          | `Promise<MindooDBAppViewNavigator>`  |
| `openViewNavigator(viewId, options?)` | `Promise<MindooDBAppViewNavigator>`  |
| `openSealedChannel(input)`            | `Promise<MindooDBAppSealedChannelOpenResult>` |
| `sealedChannelRequest(input)`         | `Promise<T>`                         |
| `closeSealedChannel(channelId)`       | `Promise<void>`                      |
| `menus.show(input)`                   | `Promise<MindooDBAppShowMenuResult>` |
| `menus.hide()`                        | `Promise<void>`                      |
| `onThemeChange(listener)`             | `() => void` (unsubscribe)           |
| `onViewportChange(listener)`          | `() => void` (unsubscribe)           |
| `disconnect()`                        | `Promise<void>`                      |

### MindooDBAppDatabase

| Property / Method            | Returns                                        |
| ---------------------------- | ---------------------------------------------- |
| `info()`                     | `Promise<MindooDBAppDatabaseInfo>`             |
| `documents`                  | `MindooDBAppDocumentApi`                       |
| `attachments`                | `MindooDBAppAttachmentApi`                     |
| `getFulltextSetup()`         | `Promise<MindooDBAppFulltextSetup \| null>`    |
| `setFulltextSetup(config)`   | `Promise<void>`                                |

### MindooDBAppDocumentApi

| Method                             | Returns                                      |
| ---------------------------------- | -------------------------------------------- |
| `query(query?)`                    | `Promise<MindooDBAppQueryResult>`            |
| `liveQuery(query, onResult)`       | `Promise<MindooDBAppLiveQuerySubscription>`  |
| `list(query?)`                     | `Promise<MindooDBAppDocumentListResult>`     |
| `listInaccessible(query?)`         | `Promise<MindooDBAppInaccessibleDocumentListResult>` |
| `get(docId)`                       | `Promise<MindooDBAppDocument \| null>`       |
| `getRichText(docId, path, opts?)`  | `Promise<MindooDBAppRichTextSnapshot>`       |
| `getAutomergeSnapshot(docId, opts?)` | `Promise<MindooDBAppAutomergeSnapshot>`   |
| `applyAutomergeChanges(docId, patch)` | `Promise<MindooDBAppAutomergePatchResult>` |
| `create(input)`                    | `Promise<MindooDBAppDocument>`               |
| `update(docId, patch)`             | `Promise<MindooDBAppDocument>`               |
| `addRecipients(docId, recipients)` | `Promise<MindooDBAppDocument>`               |
| `removeRecipients(docId, recipients)` | `Promise<MindooDBAppDocument>`            |
| `setRecipients(docId, recipients)` | `Promise<MindooDBAppDocument>`               |
| `delete(docId)`                    | `Promise<{ ok: true }>`                      |
| `undelete(docId)`                  | `Promise<{ ok: true }>`                      |
| `getDefaultCreateKeyId()`          | `Promise<string>`                            |
| `listCreateKeys()`                 | `Promise<MindooDBAppCreateKeyInfo[]>`        |
| `listHistory(docId)`               | `Promise<MindooDBAppDocumentHistoryEntry[]>` |
| `getAtTimestamp(docId, timestamp)` | `Promise<MindooDBAppHistoricalDocument>`     |
| `getAtRevision(docId, revisionId, opts?)` | `Promise<MindooDBAppHistoricalDocument>` |
| `getAtHeads(docId, headIds)`       | `Promise<MindooDBAppHistoricalDocument>`     |

`getAutomergeSnapshot` and `applyAutomergeChanges` are **discouraged** escape-hatch APIs for binary Automerge sync. Prefer `set`/`unset` and JSON patches (`text`, `richText`, `json`) instead. See [Automerge binary sync (advanced)](#automerge-binary-sync-advanced).

`list(query?)` accepts the changefeed query options documented above. The `cursor` value is an opaque checkpoint string managed by Haven and should be stored and passed back unchanged.

`listInaccessible(query?)` returns documents that exist locally but the current user cannot decrypt (not a recipient, or missing the document key). Those ids never appear in `list` / `get`. Each row is unsigned store metadata only (`id`, `createdAt`, `decryptionKeyId`, optional `authorLabel`) — the app does not get CAS access. Use it to distinguish an empty database from one sealed to someone else.

For `create(input)`, use `MindooDBAppCreateDocumentInput` with shape `{ set: Record<string, unknown>; decryptionKeyId?: string; recipients?: string[]; recipientOptions?: { includeSelf?: boolean }; id?: string }`. Omit both `decryptionKeyId` and `recipients` to use the database default shared key (`getDefaultCreateKeyId()` / `listCreateKeys()`). Pass `recipients` to encrypt the document for specific directory users (the launching user is included unless `recipientOptions.includeSelf` is `false`). Use `includeSelf: false` to write initial `set` values and hand the document to someone else — empty `recipients` with `includeSelf: false` is rejected. Changing that list later is `addRecipients` / `removeRecipients` / `setRecipients` — do not write `_encryptFor` via `update`. The optional `id` lets the app pick the document id instead of letting MindooDB generate an ObjectId; when provided it must match `/^[a-z][a-z0-9_]*$/` (lowercase only, since ids become on-disk filenames) and existing live documents with that id are returned as-is (idempotent create-if-missing). If an existing custom-id document is deleted, `create({ id })` undeletes it and preserves the previous document body. Documents created with the same custom id on different replicas converge correctly when synced.

`delete(docId)` writes a lifecycle tombstone; it does not erase the document body from the append-only history. Use `undelete(docId)` to make the latest document state live again. If you want to record a deletion reason, first call `update(docId, { set: { intendedDeletionReason: "..." } })`, then call `delete(docId)`.

For `update(docId, patch)`, use `MindooDBAppUpdateDocumentInput`:

```ts
interface MindooDBAppUpdateDocumentInput {
  set?: Record<string, unknown>; // shallow assign top-level fields
  unset?: string[]; // remove top-level fields entirely
  json?: MindooDBAppJsonPatch; // granular structured edits at JSON paths
  text?: MindooDBAppTextPatch[]; // granular collaborative text edits
  richText?: MindooDBAppRichTextPatch[]; // collaborative rich-text span snapshots
}
```

`set` and `unset` apply to top-level fields only. `json`, `text`, and `richText` patches operate at any JSON path inside `document.data` and are merged on the Haven side using the document's Automerge heads. See [Granular JSON edits](#granular-json-edits), [Collaborative text editing](#collaborative-text-editing), and [Collaborative rich-text editing](#collaborative-rich-text-editing).

### MindooDBAppAttachmentApi

| Method                                                   | Returns                                        |
| -------------------------------------------------------- | ---------------------------------------------- |
| `list(docId, options?)`                                  | `Promise<MindooDBAppAttachmentInfo[]>`         |
| `remove(docId, attachmentName)`                          | `Promise<{ ok: true }>`                        |
| `openReadStream(docId, attachmentName, options?)`        | `Promise<MindooDBAppReadableAttachmentStream>` |
| `openWriteStream(docId, attachmentName, contentType?)`   | `Promise<MindooDBAppWritableAttachmentStream>` |
| `scan(docId, options?)`                                  | `Promise<MindooDBAppScanAttachmentResult>`     |
| `preparePreviewSession(docId, attachmentName, options?)` | `Promise<MindooDBAppAttachmentPreviewSession>` |
| `openPreview(docId, attachmentName, options?)`           | `Promise<{ ok: true }>`                        |

`options` accepts `{ timestamp?: number; revisionId?: string }` for read-only historical attachment access. Mutation methods (`openWriteStream`, `remove`) always target the current document.

### MindooDBAppViewNavigator

| Method                                                     | Returns                                           |
| ---------------------------------------------------------- | ------------------------------------------------- |
| `getDefinition()`                                          | `Promise<MindooDBAppViewDefinition>`              |
| `refresh()`                                                | `Promise<string \| null>` (new view cursor)       |
| `onDidUpdate(listener)`                                    | `() => void` (unsubscribe)                        |
| `getViewCursor()`                                          | `Promise<string \| null>`                         |
| `getCurrentEntry()`                                        | `Promise<MindooDBAppViewEntry \| null>`           |
| `gotoFirst()` / `gotoLast()`                               | `Promise<boolean>`                                |
| `gotoNext()` / `gotoPrev()`                                | `Promise<boolean>`                                |
| `gotoNextSibling()` / `gotoPrevSibling()`                  | `Promise<boolean>`                                |
| `gotoParent()`                                             | `Promise<boolean>`                                |
| `gotoFirstChild()` / `gotoLastChild()`                     | `Promise<boolean>`                                |
| `gotoPos(position)`                                        | `Promise<boolean>`                                |
| `getPos(position)`                                         | `Promise<MindooDBAppViewEntry \| null>`           |
| `findCategoryEntryByParts(parts)`                          | `Promise<MindooDBAppViewEntry \| null>`           |
| `entriesForward(options?)`                                 | `Promise<MindooDBAppViewNavigatorPageResult>`     |
| `entriesBackward(options?)`                                | `Promise<MindooDBAppViewNavigatorPageResult>`     |
| `gotoNextSelected()` / `gotoPrevSelected()`                | `Promise<boolean>`                                |
| `select(origin, docId, selectParentCategories?)`           | `Promise<void>`                                   |
| `deselect(origin, docId)`                                  | `Promise<void>`                                   |
| `selectAllEntries()` / `deselectAllEntries()`              | `Promise<void>`                                   |
| `isSelected(origin, docId)`                                | `Promise<boolean>`                                |
| `getSelectionState()`                                      | `Promise<MindooDBAppViewNavigatorSelectionState>` |
| `setSelectionState(state)`                                 | `Promise<void>`                                   |
| `expand(origin, docId)` / `collapse(origin, docId)`        | `Promise<void>`                                   |
| `expandAll()` / `collapseAll()`                            | `Promise<void>`                                   |
| `expandToLevel(level)`                                     | `Promise<void>`                                   |
| `isExpanded(entryKey)`                                     | `Promise<boolean>`                                |
| `getExpansionState()`                                      | `Promise<MindooDBAppViewNavigatorExpansionState>` |
| `setExpansionState(state)`                                 | `Promise<void>`                                   |
| `childEntries(entryKey, descending?)`                      | `Promise<MindooDBAppViewEntry[]>`                 |
| `childCategories(entryKey, descending?)`                   | `Promise<MindooDBAppViewEntry[]>`                 |
| `childDocuments(entryKey, descending?)`                    | `Promise<MindooDBAppViewEntry[]>`                 |
| `childCategoriesByKey(entryKey, key, exact?, descending?)` | `Promise<MindooDBAppViewEntry[]>`                 |
| `childDocumentsByKey(entryKey, key, exact?, descending?)`  | `Promise<MindooDBAppViewEntry[]>`                 |
| `childCategoriesBetween(entryKey, range)`                  | `Promise<MindooDBAppViewEntry[]>`                 |
| `childDocumentsBetween(entryKey, range)`                   | `Promise<MindooDBAppViewEntry[]>`                 |
| `getSortedDocIds(descending?)`                             | `Promise<MindooDBAppScopedDocId[]>`               |
| `getSortedDocIdsScoped(entryKey, descending?)`             | `Promise<MindooDBAppScopedDocId[]>`               |
| `dispose()`                                                | `Promise<void>`                                   |

### Exported functions

| Function                                   | Description                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `createMindooDBAppBridge()`                | Create the bridge object used to connect to Haven                                           |
| `createMindooDBTextBuffer(options)`        | Create an editor-friendly buffer for granular collaborative text edits on a document field  |
| `createMindooDBRichTextHandle(options)`    | Create an editor-friendly handle for collaborative rich-text span snapshots on a document field |
| `canPreviewAttachment(fileName, mimeType)` | Check if Haven can preview a file (returns mode or `null`)                                  |
| `createViewLanguage<T>()`                  | Create a typed expression builder for view definitions                                      |
| `abbreviateCanonicalName(value)`           | Convert a canonical Notes-style name like `cn=Jane/ou=Dev/o=Mindoo` to `Jane/Dev/Mindoo`    |
| `expandAbbreviatedName(value)`             | Convert an abbreviated Notes-style name like `Jane/Dev/Mindoo` to `cn=Jane/ou=Dev/o=Mindoo` |

## Permissions and mappings

Apps never choose arbitrary database targets. Haven decides:

- which databases are visible to the app
- what capabilities each database has (`read`, `create`, `update`, `delete`, `history`, `attachments`, `views`)
- how each logical database maps to a concrete tenant and database target

Your app should always adapt to what Haven grants instead of assuming a fixed environment.

## When not to use this SDK

`mindoodb-app-sdk` is for web apps that integrate with the Haven host bridge.

If you are embedding generic third-party web content that does not speak the MindooDB bridge protocol, use a general iframe integration instead of this SDK.

## Current limitations

- The bridge expects a browser environment with `window`, `postMessage`, and `MessagePort`.
- Viewport updates are host-driven and only available when the app is launched by Haven.
- Your app is responsible for its own UI layout and responsive behavior after receiving host theme and viewport updates.
