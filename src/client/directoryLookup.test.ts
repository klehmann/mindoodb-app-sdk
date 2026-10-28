import { describe, expect, it } from "vitest";
import { createMockMindooDBAppSession } from "../testing";

describe("directory.lookupUsers", () => {
  it("answers one entry per username; a host without names gives the usernames alone", async () => {
    const mock = createMockMindooDBAppSession({
      databases: [{ info: { id: "main", title: "Main", capabilities: ["read", "directory"] } }],
    });
    const db = await (await mock.bridge.connect()).openDatabase("main");
    expect(await db.directory.lookupUsers(["CN=Karsten Lehmann/O=Mindoo", "CN=Ada/O=Acme"])).toEqual([
      { username: "CN=Karsten Lehmann/O=Mindoo" },
      { username: "CN=Ada/O=Acme" },
    ]);
  });
});
