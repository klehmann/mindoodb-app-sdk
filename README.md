# mindoodb-app-sdk

`mindoodb-app-sdk` is the browser-side SDK for building apps that run inside MindooDB Haven and talk to the Haven host bridge.

Use it when your app is launched by Haven in an iframe or in a separate window and needs:

- launch metadata such as user, runtime, theme, and current iframe viewport
- access to the databases Haven mapped into the app session
- document, history, attachment, and view operations through a stable bridge API
- host-driven UI events such as theme and viewport changes

## What the Haven host bridge provides

The Haven host bridge is a `postMessage` + `MessageChannel` / `MessagePort` connection between your app and Haven.

Once connected, Haven provides:

- a `MindooDBAppSession` for the current launch
- a `launchContext` snapshot with app id, user, runtime, theme, launch parameters, and current viewport
- database handles that are already permission-scoped and mapped by Haven
- live host events:
  - `onThemeChange()` when Haven switches between light and dark mode or theme presets
  - `onViewportChange()` when the iframe size changes inside Haven
- CRUD, history, attachments, and app-defined virtual views over the same bridge

Your app does not open arbitrary MindooDB databases directly. Haven decides which logical databases are visible and what permissions each one has.

## Install

```bash
npm install mindoodb-app-sdk
```

For local development against an unpublished workspace copy, prefer `npm link`:

```bash
# In the SDK package
npm link

# In your app project
npm link mindoodb-app-sdk
```

When you want to switch back to the published npm version, run `npm unlink mindoodb-app-sdk` in the app project and then `npm install`.

## Getting started

### 1. Register an app in Haven

Create an app registration in Haven that points to either:

- an external dev server or deployment URL, such as `http://localhost:4173`
- a hosted app bundle imported into Haven

Pick one runtime:

- `iframe`: the app is embedded in Haven
- `window`: the app opens in its own tab or popup

### 2. Let Haven launch the app

When Haven launches an app, it injects bridge launch parameters into the app URL:

- `mindoodbAppLaunchId`
- `mindoodbAppId`
- `mindoodbAppRuntime`

`createMindooDBAppBridge().connect()` reads `mindoodbAppLaunchId` from the current browser URL automatically.

### 3. Connect to the bridge

```ts
import { createMindooDBAppBridge } from "mindoodb-app-sdk";

const bridge = createMindooDBAppBridge();
const session = await bridge.connect();
const launchContext = await session.getLaunchContext();
```

If you need to override the launch id or target origin manually:

```ts
const session = await createMindooDBAppBridge().connect({
  launchId: "custom-launch-id",
  targetOrigin: "https://haven.example.com",
});
```

### 4. Read the launch context

The launch context is your initial snapshot of the Haven host state:

```ts
const launchContext = await session.getLaunchContext();

console.log(launchContext.runtime);      // "iframe" | "window"
console.log(launchContext.theme.mode);   // "light" | "dark"
console.log(launchContext.viewport);     // { width, height } | null
console.log(launchContext.user.username);
console.log(launchContext.launchParameters);
```

`launchContext.viewport` is especially useful for responsive layouts inside embedded iframes. It is the initial viewport snapshot; later changes arrive through `onViewportChange()`.

### 5. Subscribe to host-driven events

```ts
const stopThemeSync = session.onThemeChange((theme) => {
  console.log("Theme changed:", theme.mode, theme.preset);
});

const stopViewportSync = session.onViewportChange((viewport) => {
  console.log("Viewport changed:", viewport.width, viewport.height);
});

// Later, during teardown:
stopThemeSync();
stopViewportSync();
```

The intended pattern is:

- use `getLaunchContext()` for the initial host snapshot
- use `onThemeChange()` and `onViewportChange()` for live updates

### 6. Discover the databases Haven exposed

```ts
const databases = await session.listDatabases();

for (const database of databases) {
  console.log(database.id, database.title, database.capabilities);
}
```

Do not hard-code assumptions about available databases or permissions. Always discover them from the session.

### 7. Open a database and work with documents

```ts
const databases = await session.listDatabases();
const db = await session.openDatabase(databases[0]!.id);

const list = await db.documents.list({ limit: 25 });
const firstDoc = list.items[0] ? await db.documents.get(list.items[0].id) : null;

await db.documents.create({
  data: {
    employee: "Jane Doe",
    workDate: "2026-04-04",
    hours: 8,
  },
  decryptionKeyId: "payroll",
});
```

Omit `decryptionKeyId` to keep using the tenant's `"default"` document key.

Document operations:

- `documents.list()`
- `documents.get()`
- `documents.create()`
- `documents.update()`
- `documents.delete()`
- `documents.listHistory()`
- `documents.getAtTimestamp()`

When creating a document, apps can optionally pass `decryptionKeyId` to use a named document key instead of `"default"`.

Attachment operations:

- `attachments.list(docId)`
- `attachments.remove(docId, attachmentName)`
- `attachments.openReadStream(docId, attachmentName)`
- `attachments.openWriteStream(docId, attachmentName, contentType?)`

## Quick start example

```ts
import { createMindooDBAppBridge, createViewLanguage } from "mindoodb-app-sdk";

const bridge = createMindooDBAppBridge();
const session = await bridge.connect();

const launchContext = await session.getLaunchContext();
console.log("Connected runtime:", launchContext.runtime);
console.log("Initial viewport:", launchContext.viewport);

session.onThemeChange((theme) => {
  document.documentElement.dataset.theme = theme.mode;
});

session.onViewportChange((viewport) => {
  console.log("Resize:", viewport.width, viewport.height);
});

const databases = await session.listDatabases();
const db = await session.openDatabase(databases[0]!.id);

const list = await db.documents.list({ limit: 25 });
const firstDoc = list.items[0] ? await db.documents.get(list.items[0].id) : null;

const v = createViewLanguage<{ employee: string; hours: number; rate?: number }>();
const view = await db.views.create({
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
      name: "amount",
      title: "Amount",
      role: "display",
      expression: v.let(
        {
          hours: v.toNumber(v.field("hours")),
          rate: v.coalesce(v.toNumber(v.field("rate")), v.number(1)),
        },
        ({ hours, rate }) => v.mul(v.coalesce(hours, v.number(0)), v.coalesce(rate, v.number(0))),
      ),
    },
  ],
});

const page = await view.page({ pageSize: 100 });
console.log(page.rows);
await view.dispose();
```

## Views and expression language

Views are app-defined and session-scoped. Create a definition, page through rows, inspect categories, manage expansion state, then dispose the handle when done.

```ts
import { createViewLanguage } from "mindoodb-app-sdk";

const v = createViewLanguage<{
  employee: string;
  workDate: string;
  hours: number;
  rate?: number;
  note?: string;
}>();

const view = await db.views.create({
  title: "By employee",
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
      name: "amount",
      title: "Amount",
      role: "display",
      expression: v.let(
        {
          hours: v.toNumber(v.field("hours")),
          rate: v.coalesce(v.toNumber(v.field("rate")), v.number(1)),
        },
        ({ hours, rate }) => v.mul(v.coalesce(hours, v.number(0)), v.coalesce(rate, v.number(0))),
      ),
      sorting: "descending",
    },
  ],
});

const page = await view.page({ pageSize: 100 });
const firstCategory = page.rows.find((row) => row.type === "category");

if (firstCategory) {
  await view.expand(firstCategory.key);
  const categoryRows = await view.pageCategory(firstCategory.key, { pageSize: 25 });
  const categoryDocumentIds = await view.listCategoryDocumentIds(firstCategory.key);
  const sameCategory = await view.getCategory({ path: firstCategory.categoryPath });
}

await view.dispose();
```

Available view-handle operations:

- `view.getDefinition()`
- `view.refresh()`
- `view.page({ pageSize, position, expansion, rootRowKey })`
- `view.getExpansionState()`
- `view.setExpansionState(state)`
- `view.expand(rowKey)`
- `view.collapse(rowKey)`
- `view.expandAll()`
- `view.collapseAll()`
- `view.getRow(rowKey)`
- `view.getCategory({ path })`
- `view.pageCategory(categoryKey, { pageSize, position })`
- `view.listCategoryDocumentIds(categoryKey)`
- `view.dispose()`

The expression language is fully declarative. Apps define filter and column logic through a typed builder API that compiles to JSON-safe expression objects. No app-provided JavaScript runs inside the bridge host.

Helpers currently include:

- field/value access: `field()`, `value()`, `origin()`
- literals and conversion: `literal()`, `string()`, `number()`, `boolean()`, `toNumber()`, `toString()`, `toBoolean()`
- math and comparisons: `add()`, `sub()`, `mul()`, `div()`, `mod()`, `eq()`, `neq()`, `gt()`, `gte()`, `lt()`, `lte()`
- boolean logic: `and()`, `or()`, `not()`
- string helpers: `concat()`, `lower()`, `upper()`, `trim()`, `contains()`, `startsWith()`, `endsWith()`
- null/existence helpers: `coalesce()`, `exists()`, `notExists()`
- date/path helpers: `datePart()`, `pathJoin()`
- control flow: `ifElse()`, `let()`

The dedicated language guide lives in the `mindoodb-view-language` package. The SDK re-exports `createViewLanguage()` for convenience.

## Testing without Haven

You do **not** need a full Haven environment to test apps that use `mindoodb-app-sdk`.

The SDK ships a dedicated `mindoodb-app-sdk/testing` entrypoint with two levels of test helpers:

- Level 1: simple app-test helpers that return a fake `MindooDBAppSession` and bridge object for unit, composable, store, and component tests
- Level 2: a fake bridge host harness for tests that should exercise the real `createMindooDBAppBridge()` handshake over `postMessage` and `MessageChannel`

Use Level 1 when you only need app behavior. Use Level 2 when you want to validate your bridge integration itself.

See [`TESTING.md`](./TESTING.md) for setup instructions and Vitest examples.

## Local development workflow

The recommended local setup is:

1. Run Haven locally.
2. Run your app on its own dev server, for example Vite on `http://localhost:4173`.
3. Register that URL in Haven as an external app.
4. Launch the app from Haven so it receives a real `mindoodbAppLaunchId`.

This gives you:

- normal browser dev-server behavior
- hot module reload
- the full Haven host bridge
- realistic iframe sizing and theme changes during development

The sample `mindoodb-timerecords` app in this workspace is a good reference for this setup.

This local development workflow is separate from the automated testing workflow above. Running Haven locally is useful for interactive development, but it is not required for Level 1 or Level 2 automated tests.

## Permissions and mappings

Apps never choose arbitrary database targets themselves. Haven decides:

- which logical database handles are visible to the app
- whether each handle can read, create, update, delete, inspect history, access attachments, or create views
- how each logical handle maps to a concrete tenant/database target

Your app should always react to what Haven grants instead of assuming a fixed environment.

## When not to use this SDK

`mindoodb-app-sdk` is for MindooDB apps that intentionally integrate with the Haven host bridge.

If you are embedding generic third-party web content that does not speak the MindooDB bridge protocol, use a general iframe integration such as `iframe-resizer` instead of this SDK.

## Current limitations

- the bridge currently expects a browser environment with `window`, `postMessage`, and `MessagePort`
- viewport updates are host-driven and only available when the app is actually launched by Haven
- your app is still responsible for its own UI layout and responsive behavior after receiving host theme and viewport updates
