/**
 * Capability enforcement, directory users with paging, and the bridge-level answers the
 * browser test host logs (see browserTestHost.test.ts for the page itself).
 */
import { afterEach, describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import { pageUsers } from "../directoryPaging";
import type { MindooDBAppCapability } from "../types";
import {
  createFakeBridgeHost,
  createMemoryAttachments,
  createMockMindooDBAppSession,
  generateDirectoryUsers,
  type FakeBridgeRpcResponse,
} from "./index";

const database = (capabilities: MindooDBAppCapability[]) => ({
  info: { id: "main", title: "Main", capabilities },
  documents: [],
  methods: { attachments: createMemoryAttachments() },
});

describe("enforceCapabilities", () => {
  it("is off by default: calls pass whatever was granted", async () => {
    const mock = createMockMindooDBAppSession({ databases: [database(["read"])] });
    const db = await (await mock.bridge.connect()).openDatabase("main");
    await expect(db.documents.create({ set: { title: "x" } })).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("rejects calls the database was not granted, with a forbidden error", async () => {
    const mock = createMockMindooDBAppSession({ enforceCapabilities: true, databases: [database(["read"])] });
    const db = await (await mock.bridge.connect()).openDatabase("main");
    await expect(db.documents.list({})).resolves.toBeTruthy();
    await expect(db.documents.create({ set: { title: "x" } })).rejects.toMatchObject({
      name: "forbidden",
      message: expect.stringContaining('"create"'),
    });
    await expect(db.attachments.list("d1")).rejects.toMatchObject({ name: "forbidden" });
    await expect(db.directory.listUsers()).rejects.toMatchObject({ name: "forbidden" });
    await expect(db.documents.canCreate()).resolves.toMatchObject({ allowed: false });
  });

  it("applies setCapabilities to the next call and the launch context", async () => {
    const mock = createMockMindooDBAppSession({ enforceCapabilities: true, databases: [database(["read"])] });
    const session = await mock.bridge.connect();
    const db = await session.openDatabase("main");
    mock.setCapabilities("main", ["read", "create", "attachments"]);
    await expect(db.documents.create({ set: { title: "x" } })).resolves.toBeTruthy();
    // writing an attachment also needs update
    await expect(db.attachments.openWriteStream("d1", "a.txt")).rejects.toMatchObject({
      message: expect.stringContaining('"update"'),
    });
    expect((await db.info()).capabilities).toEqual(["read", "create", "attachments"]);
    expect((await session.getLaunchContext()).databases[0]?.capabilities).toEqual(["read", "create", "attachments"]);
    mock.setEnforceCapabilities(false);
    await expect(db.attachments.openWriteStream("d1", "a.txt")).resolves.toBeTruthy();
  });
});

describe("directory users", () => {
  it("generates canonical test names", () => {
    expect(generateDirectoryUsers(3)).toEqual(["CN=Test User 1/O=Test", "CN=Test User 2/O=Test", "CN=Test User 3/O=Test"]);
    expect(generateDirectoryUsers(120)[7]).toBe("CN=Test User 008/O=Test");
    expect(generateDirectoryUsers(2, { prefix: "Anna", organization: "Mindoo" })[1]).toBe("CN=Anna 2/O=Mindoo");
  });

  it("pages and filters", () => {
    const users = generateDirectoryUsers(120);
    const first = pageUsers(users, { limit: 50 });
    expect(first.users).toHaveLength(50);
    const last = pageUsers(users, { limit: 50, cursor: pageUsers(users, { limit: 50, cursor: first.nextCursor }).nextCursor });
    expect(last).toEqual({ users: users.slice(100), nextCursor: null });
    // case-insensitive substring: "user 11" is 110–119
    expect(pageUsers(users, { query: "user 11" }).users).toEqual(users.slice(109, 119));
  });

  it("answers listUsers from directoryUsers, in full or paged", async () => {
    const users = generateDirectoryUsers(120);
    const mock = createMockMindooDBAppSession({ directoryUsers: users, databases: [database(["read", "directory"])] });
    const db = await (await mock.bridge.connect()).openDatabase("main");
    await expect(db.directory.listUsers()).resolves.toHaveLength(120);
    const page = await db.directory.listUsers({ limit: 25, query: "test user 0" });
    expect(page.users[0]).toBe("CN=Test User 001/O=Test");
    expect(page.nextCursor).toBe("25");
    mock.setDirectoryUsers([]);
    await expect(db.directory.listUsers()).resolves.toEqual([]);
  });
});

describe("over the bridge", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("pages listUsers and reports every answer with its duration", async () => {
    const responses: Array<[string, FakeBridgeRpcResponse]> = [];
    const mock = createFakeBridgeHost({
      directoryUsers: generateDirectoryUsers(60),
      enforceCapabilities: true,
      databases: [database(["read", "directory"])],
      onResponse: (request, response) => responses.push([request.method, response]),
    });
    mock.install();
    const db = await (await createMindooDBAppBridge().connect()).openDatabase("main");
    const page = await db.directory.listUsers({ limit: 50 });
    expect(page).toMatchObject({ nextCursor: "50" });
    expect(page.users).toHaveLength(50);
    await expect(db.documents.create({ set: {} })).rejects.toThrow(/"create"/);
    const [method, create] = responses.at(-1)!;
    expect(method).toBe("documents.create");
    expect(create).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(create.durationMs).toBeGreaterThanOrEqual(0);
    mock.dispose();
  });

  it("pages on the client when the host returns the full list (hosts without paging)", async () => {
    const mock = createFakeBridgeHost({
      databases: [database(["read", "directory"])],
      requestHandlers: { "directory.listUsers": () => ["CN=Anna/O=A", "CN=Ben/O=A", "CN=Bernd/O=A"] },
    });
    mock.install();
    const db = await (await createMindooDBAppBridge().connect()).openDatabase("main");
    await expect(db.directory.listUsers()).resolves.toHaveLength(3);
    await expect(db.directory.listUsers({ query: "be", limit: 1 })).resolves.toEqual({
      users: ["CN=Ben/O=A"],
      nextCursor: "1",
    });
    mock.dispose();
  });
});
