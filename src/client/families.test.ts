import { describe, expect, it } from "vitest";

import {
  mindoodbAppFamilyBindingId,
  parseMindooDBAppFamilyBindingId,
  resolveMindooDBAppFamilyDatabaseId,
  validateMindooDBAppDefinition,
} from "../index";
import { createMockMindooDBAppSession, mockDatabasesFromDefinition } from "../testing";

const definition = {
  format: "mindoodb.haven.app",
  formatVersion: 1,
  appId: "families-test",
  label: "Families",
  version: "1.0.0",
  databases: [
    { logicalDatabaseId: "rooms", databaseId: "mchat_${id}", family: true, permissions: ["write", "delete"] },
    { logicalDatabaseId: "index", databaseId: "mchatidx", permissions: ["write"] },
  ],
};

describe("database family definitions", () => {
  it("keeps family: true and needs ${id} exactly once", () => {
    const valid = validateMindooDBAppDefinition(definition);
    expect(valid.errors).toEqual([]);
    expect(valid.definition?.databases?.[0]).toMatchObject({ family: true, databaseId: "mchat_${id}" });

    const missing = validateMindooDBAppDefinition({
      ...definition,
      databases: [{ logicalDatabaseId: "rooms", databaseId: "mchat", family: true }],
    });
    expect(missing.errors.join(" ")).toContain("exactly once");

    const notFamily = validateMindooDBAppDefinition({
      ...definition,
      databases: [{ logicalDatabaseId: "rooms", databaseId: "mchat_${id}" }],
    });
    expect(notFamily.errors.join(" ")).toContain('"family": true');
  });

  it("builds and parses binding ids and physical ids", () => {
    expect(mindoodbAppFamilyBindingId("rooms", "abc")).toBe("rooms:abc");
    expect(parseMindooDBAppFamilyBindingId("rooms:abc")).toEqual({ family: "rooms", memberId: "abc" });
    expect(parseMindooDBAppFamilyBindingId("rooms")).toBeNull();
    expect(resolveMindooDBAppFamilyDatabaseId("mchat_${id}", "k3f9")).toBe("mchat_k3f9");
    expect(() => resolveMindooDBAppFamilyDatabaseId("mchat_${id}", "Bad-Id")).toThrow();
  });
});

describe("session.families (mock)", () => {
  function createSession() {
    const parsed = validateMindooDBAppDefinition(definition).definition!;
    return createMockMindooDBAppSession({
      databases: mockDatabasesFromDefinition(parsed, {
        index: [],
        "rooms:general": [{ id: "m_1", data: { text: "hello" } }],
      }),
    });
  }

  it("starts with seeded members subscribed and lists them in the launch context", async () => {
    const { session } = createSession();
    expect(await session.families.list("rooms")).toEqual([
      { family: "rooms", memberId: "general", databaseId: "rooms:general", subscribed: true },
    ]);
    const context = await session.getLaunchContext();
    expect(context.databases.find((info) => info.id === "rooms:general")).toMatchObject({
      family: "rooms",
      familyMemberId: "general",
    });
    const general = await session.openDatabase("rooms:general");
    expect((await general.documents.get("m_1"))?.data.text).toBe("hello");
  });

  it("opens new members, reports changes and leaves them", async () => {
    const { session } = createSession();
    const changes: string[][] = [];
    const stop = session.families.onChange((change) => {
      changes.push(change.databases.map((entry) => `${entry.memberId}:${entry.subscribed}`));
    });

    const lunch = await session.families.open("rooms", "lunch");
    await lunch.documents.create({ id: "m_2", set: { text: "pizza?" } });
    expect((await (await session.openDatabase("rooms:lunch")).documents.get("m_2"))?.data.text).toBe("pizza?");

    await session.families.unsubscribe("rooms", "lunch");
    expect((await session.families.list("rooms")).find((entry) => entry.memberId === "lunch")?.subscribed).toBe(false);

    await session.families.unsubscribe("rooms", "general", { removeLocalCopy: true });
    expect((await session.families.list("rooms")).map((entry) => entry.memberId)).toEqual(["lunch"]);
    await expect(session.openDatabase("rooms:general")).rejects.toThrow();

    stop();
    expect(changes).toEqual([
      ["general:true", "lunch:true"],
      ["general:true", "lunch:false"],
      ["lunch:false"],
    ]);
  });

  it("rejects unknown families and invalid member ids", async () => {
    const { session } = createSession();
    await expect(session.families.open("nope", "x")).rejects.toThrow();
    await expect(session.families.open("rooms", "Not Valid")).rejects.toThrow();
  });
});

describe("session.families over the bridge", () => {
  it("the fake bridge host opens members and pushes families-changed", async () => {
    const { createFakeBridgeHost } = await import("../testing");
    const { createMindooDBAppBridge } = await import("./createMindooDBAppBridge");
    const parsed = validateMindooDBAppDefinition(definition).definition!;
    const host = createFakeBridgeHost({ databases: mockDatabasesFromDefinition(parsed, { index: [] }) });
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      const changed = new Promise<string[]>((resolve) => {
        const stop = session.families.onChange((change) => {
          stop();
          resolve(change.databases.map((entry) => entry.databaseId));
        });
      });
      const room = await session.families.open("rooms", "k3f9");
      await room.documents.create({ id: "m_1", set: { text: "hi" } });
      expect(await changed).toEqual(["rooms:k3f9"]);
      expect((await session.families.list("rooms"))[0]?.subscribed).toBe(true);
      expect((await session.listDatabases()).some((info) => info.id === "rooms:k3f9")).toBe(true);
    } finally {
      host.dispose();
    }
  });
});

describe("groupKeyDocId (mock)", () => {
  it("creates documents with a group document's key and reports it", async () => {
    const parsed = validateMindooDBAppDefinition(definition).definition!;
    const { session } = createMockMindooDBAppSession({
      databases: mockDatabasesFromDefinition(parsed, { index: [] }),
    });
    const room = await session.families.open("rooms", "chat1");
    const group = await room.documents.create({ recipients: ["CN=Bob/O=Test"], set: { name: "Team" } });
    const message = await room.documents.create({
      id: "m_1",
      assumeUniqueId: true,
      groupKeyDocId: group.id,
      set: { text: "hi" },
    });
    expect(message.groupKeyDocId).toBe(group.id);
    expect(message.decryptionKeyId).toBeUndefined();
    expect((await room.documents.get("m_1"))?.groupKeyDocId).toBe(group.id);

    const plain = await room.documents.create({ set: { n: 1 } });
    await expect(room.documents.create({ groupKeyDocId: plain.id, set: {} })).rejects.toThrow(/recipients/);
    await expect(
      room.documents.create({ groupKeyDocId: group.id, decryptionKeyId: "default", set: {} }),
    ).rejects.toThrow(/mutually exclusive/);
  });
});
