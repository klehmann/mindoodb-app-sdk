# mindoodb-app-sdk

The `mindoodb-app-sdk` package is the browser-side entry point for MindooDB apps that run outside the MindooDB Administrator and connect back to it through the application bridge.

## What it gives you

- `createMindooDBAppBridge()` to connect from an embedded iframe or a launched popup/tab
- a stable `MindooDBAppSession` abstraction for launch context and allowed database handles
- CRUD access to documents without exposing whether data comes from a local replica or a remote server
- temporary, app-defined virtual views for Notes-like list rendering
- `createViewLanguage()` for strongly typed, declarative column and filter expressions

## Installation

```bash
npm install mindoodb-app-sdk
```

For local workspace development you can link it with a file dependency:

```json
{
  "dependencies": {
    "mindoodb-app-sdk": "file:../mindoodb-app-sdk"
  }
}
```

## Quick start

```ts
import { createMindooDBAppBridge, createViewLanguage } from "mindoodb-app-sdk";

const bridge = createMindooDBAppBridge();
const session = await bridge.connect();

const launchContext = await session.getLaunchContext();
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
await view.dispose();
```

## Launch contract

The Administrator injects the bridge launch information into the app URL:

- `mindoodbAppLaunchId`
- `mindoodbAppId`
- `mindoodbAppRuntime`

`bridge.connect()` automatically reads `mindoodbAppLaunchId` from the current URL. You can override it manually when needed:

```ts
const session = await createMindooDBAppBridge().connect({
  launchId: "custom-launch-id",
  targetOrigin: "https://admin.example.com",
});
```

## Available APIs

### Session

- `getLaunchContext()`
- `listDatabases()`
- `openDatabase(databaseId)`
- `disconnect()`

### Documents

- `documents.list()`
- `documents.get()`
- `documents.create()`
- `documents.update()`
- `documents.delete()`
- `documents.listHistory()`
- `documents.getAtTimestamp()`

### Attachments

- `attachments.list(docId)`
- `attachments.remove(docId, attachmentName)`
- `attachments.openReadStream(docId, attachmentName)`
- `attachments.openWriteStream(docId, attachmentName, contentType?)`

### Views

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

## Expression Language

The first iteration is fully declarative. Apps define column and filter logic through a typed builder API that compiles to JSON-safe expression objects. No app-provided JS is executed by the bridge.

```ts
import { createViewLanguage } from "mindoodb-app-sdk";

const v = createViewLanguage<{
  employee: string;
  workDate: string;
  hours: number;
  rate?: number;
  note?: string;
}>();

const amount = v.let(
  {
    hours: v.toNumber(v.field("hours")),
    rate: v.coalesce(v.toNumber(v.field("rate")), v.number(1)),
  },
  ({ hours, rate }) => v.mul(v.coalesce(hours, v.number(0)), v.coalesce(rate, v.number(0))),
);

const label = v.ifElse(
  v.exists(v.field("note")),
  v.concat(v.field("employee"), v.string(": "), v.field("note")),
  v.field("employee"),
);
```

Helpers currently include:

- field/value access: `field()`, `value()`, `origin()`
- literals and conversion: `literal()`, `string()`, `number()`, `boolean()`, `toNumber()`, `toString()`, `toBoolean()`
- math and comparisons: `add()`, `sub()`, `mul()`, `div()`, `mod()`, `eq()`, `neq()`, `gt()`, `gte()`, `lt()`, `lte()`
- boolean logic: `and()`, `or()`, `not()`
- string helpers: `concat()`, `lower()`, `upper()`, `trim()`, `contains()`, `startsWith()`, `endsWith()`
- null/existence helpers: `coalesce()`, `exists()`, `notExists()`
- date/path helpers: `datePart()`, `pathJoin()`
- control flow: `ifElse()`, `let()`

The dedicated language guide now lives in the `mindoodb-view-language` package at `docs/view-language.md`. The SDK continues to re-export `createViewLanguage()`.

## Permissions and mappings

Apps never open arbitrary MindooDB databases directly. The Administrator decides:

- which logical database handles are visible to the app
- whether each app may read, write, delete, inspect history, use attachments, or create views
- how each logical handle maps to a concrete tenant/database target

Your app should always discover what is available from `session.listDatabases()` instead of assuming hard-coded access.

## Current limitations

- the bridge currently expects a browser environment with `window`, `postMessage`, and `MessagePort`
