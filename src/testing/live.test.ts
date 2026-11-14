/** @vitest-environment jsdom */
/** `session.live` in both mocks: ephemeral messages between sessions of one database. */
import { describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import type { MindooDBAppLiveMessage, MindooDBAppLiveState } from "../types";
import { createFakeBridgeHost, createMockMindooDBAppSession } from "./index";

const room = (capabilities: Array<"read" | "live">) => [
  { info: { id: "room", title: "Room", capabilities }, documents: [] },
  { info: { id: "other", title: "Other", capabilities }, documents: [] },
];

describe("session.live", () => {
  it("connects the sessions of one database and never echoes (Level 1)", async () => {
    const anna = createMockMindooDBAppSession({ databases: room(["read", "live"]), launchContext: { tenantId: "t_live1", user: { id: "a", username: "CN=Anna/O=Acme" } } });
    const ben = createMockMindooDBAppSession({ databases: room(["read", "live"]), launchContext: { tenantId: "t_live1", user: { id: "b", username: "CN=Ben/O=Acme" } } });
    const annaSession = await anna.bridge.connect();
    const benSession = await ben.bridge.connect();

    const annaChannel = await annaSession.live.open({ databaseId: "room" });
    const benChannel = await benSession.live.open({ databaseId: "room" });
    const benOther = await benSession.live.open({ databaseId: "other" });
    const benGroup = await benSession.live.open({ databaseId: "room", groupKeyDocId: "group" });
    const atAnna: MindooDBAppLiveMessage[] = [];
    const atBen: MindooDBAppLiveMessage[] = [];
    const elsewhere: MindooDBAppLiveMessage[] = [];
    annaChannel.onMessage((message) => atAnna.push(message));
    benChannel.onMessage((message) => atBen.push(message));
    benOther.onMessage((message) => elsewhere.push(message));
    benGroup.onMessage((message) => elsewhere.push(message));

    await annaChannel.send("typing", { until: 5 });
    expect(atBen).toMatchObject([{ from: "CN=Anna/O=Acme", type: "typing", data: { until: 5 } }]);
    expect(atAnna).toEqual([]);
    expect(elsewhere).toEqual([]); // another database, another group key
    await benChannel.send("here");
    expect(atAnna).toMatchObject([{ from: "CN=Ben/O=Acme", type: "here", data: null }]);
    expect(anna.live.sent()).toEqual([{ databaseId: "room", type: "typing", data: { until: 5 } }]);
    expect(ben.live.openChannels().sort()).toEqual(["other", "room"]);

    // A message "from someone else", as a unit test of one app would inject it.
    ben.live.receive("room", { from: "CN=Carla/O=Acme", type: "typing" });
    expect(atBen[1]).toMatchObject({ from: "CN=Carla/O=Acme", type: "typing", data: null });

    // Offline or an older host: the app hears about it and send does nothing.
    const states: MindooDBAppLiveState[] = [];
    annaChannel.onState((state) => states.push(state));
    anna.live.setState("unavailable");
    expect(states).toEqual(["connected", "unavailable"]);
    await annaChannel.send("typing");
    expect(atBen).toHaveLength(2);

    await benChannel.close();
    anna.live.setState("connected");
    await annaChannel.send("typing");
    expect(atBen).toHaveLength(2);
    await expect(annaChannel.send("")).rejects.toThrow(/type/);
  });

  it("needs the live permission", async () => {
    const mock = createMockMindooDBAppSession({ databases: room(["read"]), launchContext: { tenantId: "t_live2" } });
    const session = await mock.bridge.connect();
    await expect(session.live.open({ databaseId: "room" })).rejects.toThrow(/"live" capability/);
    await expect(session.live.open({ databaseId: "nope" })).rejects.toThrow(/Unknown database/);
  });

  it("works over the bridge port (Level 2)", async () => {
    const peer = createMockMindooDBAppSession({ databases: room(["read", "live"]), launchContext: { tenantId: "t_live3", user: { id: "b", username: "CN=Ben/O=Acme" } } });
    const peerChannel = await (await peer.bridge.connect()).live.open({ databaseId: "room" });
    const atPeer: MindooDBAppLiveMessage[] = [];
    peerChannel.onMessage((message) => atPeer.push(message));

    const host = createFakeBridgeHost({ databases: room(["read", "live"]), launchContext: { tenantId: "t_live3", user: { id: "a", username: "CN=Anna/O=Acme" } } });
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      const channel = await session.live.open({ databaseId: "room" });
      expect(channel.state).toBe("connected");
      const received: MindooDBAppLiveMessage[] = [];
      const states: MindooDBAppLiveState[] = [];
      channel.onMessage((message) => received.push(message));
      channel.onState((state) => states.push(state));

      await channel.send("typing", { n: 1 });
      expect(atPeer).toMatchObject([{ from: "CN=Anna/O=Acme", type: "typing", data: { n: 1 } }]);
      await peerChannel.send("here");
      await expect.poll(() => received).toMatchObject([{ from: "CN=Ben/O=Acme", type: "here" }]);

      host.live.setState("connecting");
      await expect.poll(() => states).toEqual(["connected", "connecting"]);
      await channel.close();
      await peerChannel.send("here");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(received).toHaveLength(1);
    } finally {
      host.dispose();
    }
  });
});
