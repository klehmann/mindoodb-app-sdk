/** @vitest-environment jsdom */
/** `session.transfer` in both mocks: a file handed from one session to another. */
import { describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import { isMindooDBAppTransferDescriptor } from "../client/transfer";
import type { MindooDBAppTransferProgress } from "../types";
import { createFakeBridgeHost, createMockMindooDBAppSession } from "./index";

const ANNA = "CN=Anna/O=Acme";
const BEN = "CN=Ben/O=Acme";
const dbs = [{ info: { id: "room", title: "Room", capabilities: ["read" as const] }, documents: [] }];

async function text(file: Blob): Promise<string> {
  return await file.text();
}

describe("session.transfer", () => {
  it("hands a file to the named person (Level 1)", async () => {
    const anna = createMockMindooDBAppSession({ databases: dbs, launchContext: { tenantId: "t_x1", user: { id: "a", username: ANNA } } });
    const ben = createMockMindooDBAppSession({ databases: dbs, launchContext: { tenantId: "t_x1", user: { id: "b", username: BEN } } });
    anna.transfer.setPace(3, 1);
    const annaSession = await anna.bridge.connect();
    const benSession = await ben.bridge.connect();
    expect(await annaSession.transfer.available()).toBe(true);

    const outgoing = await annaSession.transfer.offer({ file: new File(["hello world"], "hi.txt", { type: "text/plain" }), to: BEN });
    expect(isMindooDBAppTransferDescriptor(outgoing.descriptor)).toBe(true);
    expect(outgoing.descriptor).toMatchObject({ name: "hi.txt", type: "text/plain", size: 11, tenantId: "t_x1" });
    const sent: MindooDBAppTransferProgress[] = [];
    outgoing.onProgress((p) => sent.push(p));
    expect(anna.transfer.offers()).toEqual([outgoing.descriptor.transferId]);

    const incoming = await benSession.transfer.receive(outgoing.descriptor, { from: ANNA });
    const got: MindooDBAppTransferProgress[] = [];
    incoming.onProgress((p) => got.push(p));
    const file = await incoming.file;
    expect(file.name).toBe("hi.txt");
    expect(await text(file)).toBe("hello world");
    expect(got.slice(-1)[0]).toMatchObject({ state: "done", bytes: 11, total: 11 });
    expect(sent.slice(-1)[0]).toMatchObject({ state: "done" });
  });

  it("refuses a wrong sender and stops when the offer is cancelled", async () => {
    const anna = createMockMindooDBAppSession({ databases: dbs, launchContext: { tenantId: "t_x2", user: { id: "a", username: ANNA } } });
    const ben = createMockMindooDBAppSession({ databases: dbs, launchContext: { tenantId: "t_x2", user: { id: "b", username: BEN } } });
    const annaSession = await anna.bridge.connect();
    const benSession = await ben.bridge.connect();
    const outgoing = await annaSession.transfer.offer({ file: new Blob(["x"]), name: "x.bin", to: BEN });
    const wrong = await benSession.transfer.receive(outgoing.descriptor, { from: "CN=Mallory/O=Acme" });
    await expect(wrong.file).rejects.toThrow(/no longer offering/);

    await outgoing.cancel();
    expect(anna.transfer.offers()).toEqual([]);
    const late = await benSession.transfer.receive(outgoing.descriptor, { from: ANNA });
    await expect(late.file).rejects.toThrow(/no longer offering/);
    await expect(benSession.transfer.receive({ v: 1 } as never, { from: ANNA })).rejects.toThrow(/descriptor/);
  });

  it("works over the bridge port (Level 2)", async () => {
    // jsdom's MessageChannel cannot clone Blobs (browsers can), so this checks the
    // calls and the progress pushes, not the bytes.
    const ben = createMockMindooDBAppSession({ databases: dbs, launchContext: { tenantId: "t_x3", user: { id: "b", username: BEN } } });
    const benSession = await ben.bridge.connect();
    const host = createFakeBridgeHost({ databases: dbs, launchContext: { tenantId: "t_x3", user: { id: "a", username: ANNA } } });
    host.install();
    try {
      host.transfer.setPace(2, 1);
      const session = await createMindooDBAppBridge().connect();
      expect(await session.transfer.available()).toBe(true);
      const offered = await benSession.transfer.offer({ file: new File(["xyz"], "b.txt"), to: ANNA });
      const received = await session.transfer.receive(offered.descriptor, { from: BEN });
      const states: string[] = [];
      received.onProgress((p) => states.push(p.state));
      await received.file;
      expect(states.slice(-1)[0]).toBe("done");
      expect(states[0]).not.toBe("done");

      host.transfer.setAvailable(false);
      expect(await session.transfer.available()).toBe(false);
    } finally {
      host.dispose();
    }
  });
});
