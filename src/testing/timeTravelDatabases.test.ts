import { afterEach, describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import { createFakeBridgeHost, createMockMindooDBAppSession } from "./index";

const databases = [
  {
    info: { id: "main", title: "Main", capabilities: ["read", "create", "update", "delete", "history", "attachments"] as const },
    documents: [{ id: "a", data: { type: "page", title: "First" }, updatedAt: "2026-01-01T10:00:00.000Z" }],
  },
];

async function seedTimeline(db: Awaited<ReturnType<ReturnType<typeof createMockMindooDBAppSession>["session"]["openDatabase"]>>) {
  const between = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await db.documents.update("a", { set: { title: "Second" } });
  await db.documents.create({ set: { type: "page", title: "Later" } });
  return between;
}

describe("openDatabase with timeTravelDate", () => {
  let dispose: (() => void) | null = null;
  afterEach(() => dispose?.());

  it("serves a read-only snapshot next to the live database (mock session)", async () => {
    const { session } = createMockMindooDBAppSession({ databases: databases.map((d) => ({ ...d, info: { ...d.info, capabilities: [...d.info.capabilities] } })) });
    const live = await session.openDatabase("main");
    const cutoff = await seedTimeline(live);

    const past = await session.openDatabase("main", { timeTravelDate: cutoff });
    expect((await past.info()).timeTravelDate).toBe(cutoff);
    expect((await past.documents.get("a"))?.data.title).toBe("First");
    const rows = await past.documents.query({ fields: ["title"] });
    expect(rows.rows.map((row) => row.fields.title)).toEqual(["First"]);
    await expect(past.documents.update("a", { set: { title: "x" } })).rejects.toThrow(/update/);
    // the live database is untouched
    expect((await live.documents.query({ fields: ["title"] })).total).toBe(2);
  });

  it("goes through the bridge with a snapshot binding id", async () => {
    const mock = createFakeBridgeHost({ databases: databases.map((d) => ({ ...d, info: { ...d.info, capabilities: [...d.info.capabilities] } })) });
    mock.install();
    dispose = () => mock.dispose();
    const session = await createMindooDBAppBridge().connect();
    const live = await session.openDatabase("main");
    const cutoff = await seedTimeline(live);

    const past = await session.openDatabase("main", { timeTravelDate: new Date(cutoff) });
    expect((await past.documents.get("a"))?.data.title).toBe("First");
    const open = mock.requests.find((request) => request.method === "session.openDatabase" && (request.params as { timeTravelDate?: number }).timeTravelDate);
    expect(open?.params).toMatchObject({ databaseId: "main", timeTravelDate: cutoff });
    expect(mock.requests.at(-1)?.params).toMatchObject({ databaseId: `main@tt:${cutoff}` });
  });

  it("rejects a cutoff after the date of a time-travel launch", async () => {
    const { session } = createMockMindooDBAppSession({
      launchContext: { timeTravelDate: Date.parse("2026-02-01T00:00:00Z") },
      databases: databases.map((d) => ({ ...d, info: { ...d.info, capabilities: [...d.info.capabilities] } })),
    });
    await expect(session.openDatabase("main", { timeTravelDate: Date.parse("2026-03-01T00:00:00Z") })).rejects.toThrow(/later date/);
  });
});
