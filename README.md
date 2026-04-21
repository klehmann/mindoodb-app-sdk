# mindoodb-app-sdk

Build apps that run inside **MindooDB Haven** -- the browser-based workspace for end-to-end encrypted, offline-first data.

`mindoodb-app-sdk` is the TypeScript SDK that connects your web application to Haven through a secure message bridge. Your app runs in a sandboxed iframe (or a separate browser window) and gains access to databases, documents, attachments, virtual views, and live host events -- all without ever touching encryption keys or raw sync state.

## What is a MindooDB App?

[MindooDB](https://mindoodb.com) is an **end-to-end encrypted, offline-first sync database**. Data is encrypted on the client before it ever leaves the device. Under the hood it uses [Automerge](https://automerge.org/) CRDTs so multiple users can edit concurrently and conflicts resolve automatically.

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
npm install mindoodb-app-sdk
```

## Get started in 5 minutes

The fastest way to start building is to clone the **example app**, run it locally, and connect it to Haven:

```bash
git clone https://github.com/klehmann/mindoodb-app-example.git
cd mindoodb-app-example
npm install
npm run dev:local
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
console.log("Runtime:", ctx.runtime);   // "iframe" | "window"
console.log("Theme:", ctx.theme.mode);  // "light" | "dark"
console.log("Databases:", ctx.databases.map((db) => db.title));

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

| Capability | Allows |
|---|---|
| `read` | List and read documents |
| `create` | Create new documents |
| `update` | Update existing documents |
| `delete` | Delete documents |
| `history` | Access document revision history and historical snapshots |
| `attachments` | List, upload, download, remove, and preview file attachments |
| `views` | Create app-defined virtual views for this database |

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
  ? await db.documents.list({ cursor: result.nextCursor, limit: 50, fields: ["title"] })
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

// Create (optionally with a named document key)
const created = await db.documents.create({
  set: { title: "Meeting notes", content: "..." },
  decryptionKeyId: "team-key",  // omit to use "default"
});

// Update
const updated = await db.documents.update(docId, {
  set: { title: "Updated title" },
  unset: ["legacyField"],
});

// Delete
await db.documents.delete(docId);
```

`documents.list()` is backed by Haven's internal changefeed, not by a positional offset. The query object supports:

| Field | Meaning |
|---|---|
| `cursor?: string \| null` | Opaque changefeed checkpoint previously returned by `nextCursor` |
| `limit?: number` | Maximum number of matching entries to return (default `50`) |
| `skip?: number` | Skip matching entries after the cursor without loading full document bodies |
| `status?: "all" \| "existing" \| "deleted"` | Filter by deletion state (default `"existing"`) |
| `metadataOnly?: boolean` | Return only `{ id, isDeleted }` for speed |
| `fields?: string[]` | Project specific JSON fields when `metadataOnly` is `false` |
| `filter?: Record<string, unknown>` | Simple equality filter applied to document data when `metadataOnly` is `false` |

`nextCursor` is the latest checkpoint reached by the page. Persist it after each successful call when you are building your own index or sync loop. If there were no changes after the supplied cursor, `nextCursor` is `null`.

`documents.update()` accepts top-level `set` and `unset` operations. Prefer sending small, intentional field-level changes instead of rewriting whole documents when only a few fields changed. This keeps MindooDB change tracking more meaningful and helps Automerge produce cleaner merge results.

When Haven can resolve the signing identity from the tenant directory, list items may also include `identityLabel` and `publicKeyFingerprint` for the latest visible change. Apps can use this to show who last touched a document without loading the full revision history first.

### Document history

When the `history` capability is granted, you can walk the full revision timeline of any document:

```ts
// List all revisions
const history = await db.documents.listHistory(docId);
// Each entry: { timestamp, publicKey, identityLabel?, isDeleted, isCurrent, summary? }

// Load the document state at a specific point in time
const snapshot = await db.documents.getAtTimestamp(docId, history[0]!.timestamp);
// { id, timestamp, state: "exists" | "deleted" | "missing", data }
```

### Incremental sync

The changefeed-backed `documents.list()` API is also the right primitive for app-side indexes, search, and other derived caches.

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
const writer = await db.attachments.openWriteStream(docId, "photo.jpg", "image/jpeg");
await writer.write(fileBytes);
await writer.close();

// Remove
await db.attachments.remove(docId, "old-file.txt");
```

### Attachment previews

Haven includes a **built-in file viewer** that your app can open for common attachment formats. This is one of the most powerful SDK features -- it works with both online and offline data, and media formats support streaming playback with skip/seek.

**Supported preview formats:**

| Mode | Formats |
|---|---|
| `image` | All common image formats (JPEG, PNG, GIF, WebP, SVG, ...) |
| `pdf` | PDF documents |
| `markdown` | Markdown rendered to HTML (.md, .markdown, .mdown, .mkd, .mkdn) |
| `text` | Plain text, CSV, JSON, XML, YAML, SVG, log files |
| `docx` | Microsoft Word (.docx) |
| `pptx` | Microsoft PowerPoint (.pptx) |
| `spreadsheet` | Microsoft Excel (.xls, .xlsx, .xlsm, .xlsb) |
| `video` | Video files with embedded player, streaming + seek (.mp4, .m4v, .webm, .ogv, .ogg, plus any `video/*`) |
| `audio` | Audio files with embedded player, streaming + seek (.mp3, .m4a, .wav, .aac, .oga, plus any `audio/*`) |

**Open the Haven preview dialog:**

```ts
await db.attachments.openPreview(docId, "presentation.pptx");
```

You can also preview attachments from a **historical document snapshot**:

```ts
await db.attachments.openPreview(docId, "report.pdf", {
  timestamp: historyEntry.timestamp,
});
```

**Check preview support locally** before showing a preview button:

```ts
import { canPreviewAttachment } from "mindoodb-app-sdk";

const mode = canPreviewAttachment("slides.pptx", "application/octet-stream");
// Returns "pptx" -- Haven can preview this file

const unsupported = canPreviewAttachment("data.bin", "application/octet-stream");
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
  ? await navigator.entriesForward({ limit: 50, startPosition: page1.nextPosition })
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
  const exact = await navigator.childDocumentsByKey(category.key, "2026-04-14", true);
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

The expression language is fully declarative: apps define filter and column logic through a typed builder API that compiles to JSON-safe expression objects. No app-provided JavaScript runs inside the bridge host.

#### Performance notes

- `goto*()` and `getCurrentEntry()` are lightweight stateful cursor operations. They may still produce many bridge round-trips if you call them for every rendered row.
- `entriesForward()` and `entriesBackward()` exist specifically to reduce those round-trips for UI rendering.
- `refresh()` rebuilds or invalidates the host-side navigator state and should be treated as an expensive operation compared to simple cursor movement.
- Child/key/range helpers operate on the same host-side navigator session. They do not create a separate query engine.

Available expression helpers:

- **Field access:** `field()`, `value()`, `origin()`
- **Literals and conversion:** `literal()`, `string()`, `number()`, `boolean()`, `toNumber()`, `toString()`, `toBoolean()`
- **Math and comparisons:** `add()`, `sub()`, `mul()`, `div()`, `mod()`, `eq()`, `neq()`, `gt()`, `gte()`, `lt()`, `lte()`
- **Boolean logic:** `and()`, `or()`, `not()`
- **String helpers:** `concat()`, `lower()`, `upper()`, `trim()`, `contains()`, `startsWith()`, `endsWith()`
- **Null/existence:** `coalesce()`, `exists()`, `notExists()`
- **Date/path:** `datePart()`, `pathJoin()`
- **Control flow:** `ifElse()`, `let()`

The full language guide lives in the `mindoodb-view-language` package. The SDK re-exports `createViewLanguage()` for convenience.

## Testing without Haven

You do **not** need a full Haven environment to test apps that use `mindoodb-app-sdk`.

The SDK ships a dedicated `mindoodb-app-sdk/testing` entrypoint with two levels of test helpers:

- **Level 1 -- app tests:** Returns a fake `MindooDBAppSession` and bridge for unit, composable, store, and component tests. No `postMessage` or `MessageChannel` involved.
- **Level 2 -- bridge protocol tests:** A fake host harness that exercises the real `createMindooDBAppBridge()` handshake over `postMessage` and `MessageChannel`. Useful for integration-style tests.

Use Level 1 when you are testing app behavior. Use Level 2 when you want to validate the bridge transport itself.

See [`TESTING.md`](./TESTING.md) for setup instructions and Vitest examples.

## Deployment

MindooDB Apps are standard web applications -- deploy them anywhere you can serve static files.

**Cloudflare Pages / Workers** is one of the easiest options. The [example app](https://github.com/klehmann/mindoodb-app-example) is deployed this way at https://app-example.mindoodb.com using a simple `wrangler.jsonc` configuration:

```bash
npm run build
wrangler deploy
```

Other static hosting options work just as well: Netlify, Vercel, any web server serving your `dist/` folder.

**Haven-hosted bundles** are an alternative: import your built app directly into Haven, where it is served by a service worker on an opaque origin. Haven-hosted apps load without a network connection and receive a stricter sandbox.

## Local development workflow

For interactive development with the full Haven host bridge:

1. Run Haven locally.
2. Run your app on its own dev server (e.g. `npm run dev` with Vite).
3. Register the dev server URL in Haven's Application settings.
4. Map databases and optionally views to the app.
5. Launch from Haven -- you get hot reload, real bridge communication, and live theme/viewport events.

This is separate from the automated testing workflow above. Running Haven is useful for interactive development but not required for Level 1 or Level 2 tests.

## API reference

### MindooDBAppBridge

| Method | Returns |
|---|---|
| `connect(options?)` | `Promise<MindooDBAppSession>` |

Connect options: `launchId?`, `targetOrigin?`, `connectTimeoutMs?`.

### MindooDBAppSession

| Method | Returns |
|---|---|
| `getLaunchContext()` | `Promise<MindooDBAppLaunchContext>` |
| `listDatabases()` | `Promise<MindooDBAppDatabaseInfo[]>` |
| `openDatabase(databaseId)` | `Promise<MindooDBAppDatabase>` |
| `createViewNavigator(input)` | `Promise<MindooDBAppViewNavigator>` |
| `openViewNavigator(viewId, options?)` | `Promise<MindooDBAppViewNavigator>` |
| `menus.show(input)` | `Promise<MindooDBAppShowMenuResult>` |
| `menus.hide()` | `Promise<void>` |
| `onThemeChange(listener)` | `() => void` (unsubscribe) |
| `onViewportChange(listener)` | `() => void` (unsubscribe) |
| `disconnect()` | `Promise<void>` |

### MindooDBAppDatabase

| Property / Method | Returns |
|---|---|
| `info()` | `Promise<MindooDBAppDatabaseInfo>` |
| `documents` | `MindooDBAppDocumentApi` |
| `attachments` | `MindooDBAppAttachmentApi` |

### MindooDBAppDocumentApi

| Method | Returns |
|---|---|
| `list(query?)` | `Promise<MindooDBAppDocumentListResult>` |
| `get(docId)` | `Promise<MindooDBAppDocument \| null>` |
| `create(input)` | `Promise<MindooDBAppDocument>` |
| `update(docId, patch)` | `Promise<MindooDBAppDocument>` |
| `delete(docId)` | `Promise<{ ok: true }>` |
| `listHistory(docId)` | `Promise<MindooDBAppDocumentHistoryEntry[]>` |
| `getAtTimestamp(docId, timestamp)` | `Promise<MindooDBAppHistoricalDocument>` |

`list(query?)` accepts the changefeed query options documented above. The `cursor` value is an opaque checkpoint string managed by Haven and should be stored and passed back unchanged.

For `update(docId, patch)`, use `{ set?: Record<string, unknown>; unset?: string[] }`. Both operations are shallow and apply to top-level document fields only.

### MindooDBAppAttachmentApi

| Method | Returns |
|---|---|
| `list(docId)` | `Promise<MindooDBAppAttachmentInfo[]>` |
| `remove(docId, attachmentName)` | `Promise<{ ok: true }>` |
| `openReadStream(docId, attachmentName)` | `Promise<MindooDBAppReadableAttachmentStream>` |
| `openWriteStream(docId, attachmentName, contentType?)` | `Promise<MindooDBAppWritableAttachmentStream>` |
| `openPreview(docId, attachmentName, options?)` | `Promise<{ ok: true }>` |

### MindooDBAppViewNavigator

| Method | Returns |
|---|---|
| `getDefinition()` | `Promise<MindooDBAppViewDefinition>` |
| `refresh()` | `Promise<void>` |
| `getCurrentEntry()` | `Promise<MindooDBAppViewEntry \| null>` |
| `gotoFirst()` / `gotoLast()` | `Promise<boolean>` |
| `gotoNext()` / `gotoPrev()` | `Promise<boolean>` |
| `gotoNextSibling()` / `gotoPrevSibling()` | `Promise<boolean>` |
| `gotoParent()` | `Promise<boolean>` |
| `gotoFirstChild()` / `gotoLastChild()` | `Promise<boolean>` |
| `gotoPos(position)` | `Promise<boolean>` |
| `getPos(position)` | `Promise<MindooDBAppViewEntry \| null>` |
| `findCategoryEntryByParts(parts)` | `Promise<MindooDBAppViewEntry \| null>` |
| `entriesForward(options?)` | `Promise<MindooDBAppViewNavigatorPageResult>` |
| `entriesBackward(options?)` | `Promise<MindooDBAppViewNavigatorPageResult>` |
| `gotoNextSelected()` / `gotoPrevSelected()` | `Promise<boolean>` |
| `select(origin, docId, selectParentCategories?)` | `Promise<void>` |
| `deselect(origin, docId)` | `Promise<void>` |
| `selectAllEntries()` / `deselectAllEntries()` | `Promise<void>` |
| `isSelected(origin, docId)` | `Promise<boolean>` |
| `getSelectionState()` | `Promise<MindooDBAppViewNavigatorSelectionState>` |
| `setSelectionState(state)` | `Promise<void>` |
| `expand(origin, docId)` / `collapse(origin, docId)` | `Promise<void>` |
| `expandAll()` / `collapseAll()` | `Promise<void>` |
| `expandToLevel(level)` | `Promise<void>` |
| `isExpanded(entryKey)` | `Promise<boolean>` |
| `getExpansionState()` | `Promise<MindooDBAppViewNavigatorExpansionState>` |
| `setExpansionState(state)` | `Promise<void>` |
| `childEntries(entryKey, descending?)` | `Promise<MindooDBAppViewEntry[]>` |
| `childCategories(entryKey, descending?)` | `Promise<MindooDBAppViewEntry[]>` |
| `childDocuments(entryKey, descending?)` | `Promise<MindooDBAppViewEntry[]>` |
| `childCategoriesByKey(entryKey, key, exact?, descending?)` | `Promise<MindooDBAppViewEntry[]>` |
| `childDocumentsByKey(entryKey, key, exact?, descending?)` | `Promise<MindooDBAppViewEntry[]>` |
| `childCategoriesBetween(entryKey, range)` | `Promise<MindooDBAppViewEntry[]>` |
| `childDocumentsBetween(entryKey, range)` | `Promise<MindooDBAppViewEntry[]>` |
| `getSortedDocIds(descending?)` | `Promise<MindooDBAppScopedDocId[]>` |
| `getSortedDocIdsScoped(entryKey, descending?)` | `Promise<MindooDBAppScopedDocId[]>` |
| `dispose()` | `Promise<void>` |

### Exported functions

| Function | Description |
|---|---|
| `createMindooDBAppBridge()` | Create the bridge object used to connect to Haven |
| `canPreviewAttachment(fileName, mimeType)` | Check if Haven can preview a file (returns mode or `null`) |
| `createViewLanguage<T>()` | Create a typed expression builder for view definitions |
| `abbreviateCanonicalName(value)` | Convert a canonical Notes-style name like `cn=Jane/ou=Dev/o=Mindoo` to `Jane/Dev/Mindoo` |
| `expandAbbreviatedName(value)` | Convert an abbreviated Notes-style name like `Jane/Dev/Mindoo` to `cn=Jane/ou=Dev/o=Mindoo` |

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
