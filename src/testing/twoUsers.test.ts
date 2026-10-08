/** @vitest-environment jsdom */
/**
 * Two mocks as two devices: `syncMockReplicas` merges documents, deletions and
 * attachments both ways; the test host's two-user mode wires two app frames to it.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createMemoryAttachments,
  createMockMindooDBAppSession,
  mockReplicaDifferences,
  mountHavenTestHost,
  syncMockReplicas,
  type MockMindooDBAppDatabaseDefinition,
} from "./index";

const definition = (): MockMindooDBAppDatabaseDefinition => ({
  info: { id: "main", title: "Main", capabilities: ["read", "create", "update", "delete", "attachments"] },
  automerge: true,
  documents: [{ id: "note", data: { title: "Note" } }],
  methods: { attachments: createMemoryAttachments() },
});

async function device(actor: string) {
  const mock = createMockMindooDBAppSession({ databases: [definition()], automergeActor: actor });
  const db = await (await mock.bridge.connect()).openDatabase("main");
  return { mock, db };
}

describe("syncMockReplicas", () => {
  it("brings new documents and attachments over and merges concurrent edits", async () => {
    const a = await device("a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1");
    const b = await device("b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2");
    expect(mockReplicaDifferences(a.mock, b.mock)).toBe(0);

    const created = await a.db.documents.create({ set: { title: "From A" } });
    const writer = await a.db.attachments.openWriteStream(created.id, "file.txt", "text/plain");
    await writer.write(new TextEncoder().encode("hello"));
    await writer.close();
    expect(mockReplicaDifferences(a.mock, b.mock)).toBe(1);
    await syncMockReplicas(a.mock, b.mock);
    expect(mockReplicaDifferences(a.mock, b.mock)).toBe(0);
    expect((await b.db.documents.get(created.id))?.data.title).toBe("From A");
    expect((await b.db.attachments.list(created.id)).map((f) => f.fileName)).toEqual(["file.txt"]);

    // both edit the same text at the same heads, then sync
    const base = await a.db.documents.update("note", { text: [{ path: ["title"], edits: [{ index: 4, deleteCount: 0, insert: "!" }] }] });
    await syncMockReplicas(a.mock, b.mock);
    await a.db.documents.update("note", { text: [{ path: ["title"], baseHeads: base.heads, edits: [{ index: 0, deleteCount: 0, insert: "A: " }] }] });
    await b.db.documents.update("note", { text: [{ path: ["title"], baseHeads: base.heads, edits: [{ index: 5, deleteCount: 0, insert: "?" }] }] });
    expect(await syncMockReplicas(a.mock, b.mock)).toBe(1);
    const left = await a.db.documents.get("note");
    const right = await b.db.documents.get("note");
    expect(left?.data.title).toBe("A: Note!?");
    expect(right?.data).toEqual(left?.data);
  });

  it("spreads deletions", async () => {
    const a = await device("a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1");
    const b = await device("b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2");
    await b.db.documents.delete("note");
    await syncMockReplicas(a.mock, b.mock);
    expect(await a.db.documents.get("note").catch(() => null)).toBeNull();
  });
});

describe("two-user test host", () => {
  afterEach(() => {
    document.body.replaceChildren();
    window.history.replaceState(null, "", "/");
  });

  it("mounts two frames on two replicas with sync controls", async () => {
    window.history.replaceState(null, "", "/__haven-test/?twoUsers=1");
    const host = mountHavenTestHost({ appUrl: "https://app.example.com/", databases: [definition()] });
    const frames = document.querySelectorAll('[data-testid^="haven-two-users-frame-"]');
    expect(frames).toHaveLength(2);
    expect(window.__havenTwoUsers?.hosts[0]).toBe(host);
    expect((document.querySelector('[data-testid="haven-two-users-autosync"]') as HTMLInputElement).checked).toBe(true);
    window.__havenTwoUsers!.setAutoSync(false);

    const [a, b] = window.__havenTwoUsers!.hosts;
    const dbA = await a.host.session.openDatabase("main");
    await dbA.documents.create({ set: { title: "Left" } });
    expect(window.__havenTwoUsers!.differences()).toBe(1);
    await window.__havenTwoUsers!.sync();
    const dbB = await b.host.session.openDatabase("main");
    expect((await dbB.documents.list({})).items.map((d) => d.data?.title)).toContain("Left");
    expect((await a.host.session.getLaunchContext()).user.username).not.toBe(
      (await b.host.session.getLaunchContext()).user.username,
    );
  });
});
