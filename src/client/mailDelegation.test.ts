import { describe, expect, it } from "vitest";

import { createMockMindooDBAppSession } from "../testing";

describe("mail delegation (mock host)", () => {
  it("answers like a host without group keys and keeps delegations in memory", async () => {
    const mock = createMockMindooDBAppSession({
      databases: [{ info: { id: "pimdb", title: "Mail", capabilities: ["read", "create", "update", "maildelegation"] } }],
      enforceCapabilities: true,
    });
    const db = await (await mock.bridge.connect()).openDatabase("pimdb");
    expect(await db.mail.groups(["mindoomail"])).toEqual({ supported: false });
    await db.mail.setDelegation({ username: "CN=bob/O=t", accountId: "mindoomail", rights: { mail: "edit", calendar: "read" }, send: true });
    expect(await db.mail.delegations()).toEqual([
      expect.objectContaining({ username: "CN=bob/O=t", rights: { mmail_: "edit", mcal_: "read", mmailout_: "send" } }),
    ]);
    await db.mail.setDelegation({ username: "CN=bob/O=t", accountId: "mindoomail", rights: { mail: null, calendar: null }, send: false });
    expect(await db.mail.delegations()).toEqual([]);
    expect(await db.mail.sharedWithMe()).toEqual([]);
    expect(await db.mail.teams()).toEqual([]);
  });
});

describe("mail delegation needs its capability", () => {
  it("refuses without maildelegation", async () => {
    const mock = createMockMindooDBAppSession({
      databases: [{ info: { id: "pimdb", title: "Mail", capabilities: ["read"] } }],
      enforceCapabilities: true,
    });
    const db = await (await mock.bridge.connect()).openDatabase("pimdb");
    await expect(db.mail.delegations()).rejects.toThrow(/maildelegation/);
  });
});
