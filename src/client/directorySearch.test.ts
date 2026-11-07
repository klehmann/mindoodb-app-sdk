import { afterEach, describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "./createMindooDBAppBridge";
import type { MindooDBAppBridgePortMessage } from "../types";
import { createMockMindooDBAppSession } from "../testing";

/** A host that answers the methods in `answers`; everything else is unknown to it, like an older Haven. */
let launchCounter = 0;

function connectToHost(answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const host = {
    postMessage(_message: unknown, _targetOrigin?: string, transfer?: Transferable[]) {
      const port = transfer?.[0] as MessagePort | undefined;
      if (!port) throw new Error("Expected bridge connection port transfer.");
      port.addEventListener("message", (event: MessageEvent<MindooDBAppBridgePortMessage>) => {
        const message = event.data;
        if (message.kind !== "request") return;
        const params = (message.params ?? {}) as Record<string, unknown>;
        calls.push({ method: message.method, params });
        const answer = message.method === "session.openDatabase" ? () => ({ ok: true }) : answers[message.method];
        port.postMessage(
          answer
            ? { protocol: "mindoodb-app-bridge", kind: "success", id: message.id, result: answer(params) }
            : {
                protocol: "mindoodb-app-bridge",
                kind: "error",
                id: message.id,
                error: { code: "method-not-found", message: "Unknown method." },
              },
        );
      });
      port.start();
      port.postMessage({ protocol: "mindoodb-app-bridge", type: "mindoodb-app:connected" });
    },
  };
  Object.defineProperty(globalThis, "window", {
    value: {
      parent: host,
      opener: null,
      location: { search: `?mindoodbAppLaunchId=launch-directory-search-${++launchCounter}` },
      setTimeout,
      clearTimeout,
    },
    configurable: true,
  });
  return { calls, open: async () => (await createMindooDBAppBridge().connect()).openDatabase("main") };
}

describe("directory.searchUsers and directory.mailGateways (bridge client)", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("asks the host and passes query and limit", async () => {
    const host = connectToHost({
      "directory.searchUsers": () => [{ username: "CN=kl/O=Mindoo", firstName: "Karsten", lastName: "Lehmann" }],
      "directory.mailGateways": () => [
        { gatewayUsername: "CN=mail-gateway/O=Mindoo", domains: ["mindoo.de"], ownAddresses: [], isDefault: true },
      ],
      "directory.mailAddressesFor": (params) =>
        (params.usernames as string[]).map((username) => ({ username, addresses: ["kl@mindoo.de"] })),
    });
    const db = await host.open();
    expect(await db.directory.searchUsers({ query: " karsten ", limit: 500 })).toEqual([
      { username: "CN=kl/O=Mindoo", firstName: "Karsten", lastName: "Lehmann" },
    ]);
    expect(host.calls.find((call) => call.method === "directory.searchUsers")?.params).toMatchObject({
      databaseId: "main",
      query: "karsten",
      limit: 100,
    });
    expect((await db.directory.mailGateways())[0]?.gatewayUsername).toBe("CN=mail-gateway/O=Mindoo");
    expect(await db.directory.mailAddressesFor(["CN=kl/O=Mindoo"])).toEqual([
      { username: "CN=kl/O=Mindoo", addresses: ["kl@mindoo.de"] },
    ]);
  });

  it("an empty query finds nobody without asking the host", async () => {
    const host = connectToHost({ "directory.searchUsers": () => [{ username: "CN=Ada/O=Acme" }] });
    const db = await host.open();
    expect(await db.directory.searchUsers({ query: "  " })).toEqual([]);
    expect(host.calls.some((call) => call.method === "directory.searchUsers")).toBe(false);
  });

  it("older hosts: listUsers + lookupUsers, ranked the same way; no gateways", async () => {
    const users = ["CN=Erika Karleh/O=Acme", "CN=Karsten Lehmann/O=Mindoo", "CN=Ada/O=Acme"];
    const host = connectToHost({
      "directory.listUsers": (params) =>
        users.filter((user) => user.toLowerCase().includes(String(params.query ?? "").toLowerCase())),
      "directory.lookupUsers": (params) =>
        (params.usernames as string[]).map((username) =>
          username.startsWith("CN=Karsten") ? { username, firstName: "Karsten", lastName: "Lehmann" } : { username },
        ),
    });
    const db = await host.open();
    expect((await db.directory.searchUsers({ query: "kar leh" })).map((person) => person.username)).toEqual([
      "CN=Karsten Lehmann/O=Mindoo",
      "CN=Erika Karleh/O=Acme",
    ]);
    expect(host.calls.find((call) => call.method === "directory.listUsers")?.params).toMatchObject({ query: "kar" });
    expect(await db.directory.mailGateways()).toEqual([]);
    expect(await db.directory.mailAddressesFor(["CN=Ada/O=Acme"])).toEqual([{ username: "CN=Ada/O=Acme", addresses: [] }]);
  });
});

describe("directory.searchUsers and directory.mailGateways (mock host)", () => {
  it("searches names and usernames of directoryPeople, and lookupUsers gives the names", async () => {
    const mock = createMockMindooDBAppSession({
      databases: [{ info: { id: "main", title: "Main", capabilities: ["read", "directory"] } }],
      directoryUsers: ["CN=Ada Lovelace/O=Acme"],
      directoryPeople: [{ username: "CN=kl/O=Mindoo", firstName: "Karsten", lastName: "Lehmann" }],
    });
    const db = await (await mock.bridge.connect()).openDatabase("main");
    expect(await db.directory.searchUsers({ query: "lehm" })).toEqual([
      { username: "CN=kl/O=Mindoo", firstName: "Karsten", lastName: "Lehmann" },
    ]);
    expect((await db.directory.searchUsers({ query: "ada" })).map((person) => person.username)).toEqual([
      "CN=Ada Lovelace/O=Acme",
    ]);
    expect(await db.directory.listUsers()).toEqual(["CN=Ada Lovelace/O=Acme", "CN=kl/O=Mindoo"]);
    expect(await db.directory.lookupUsers(["cn=kl/o=mindoo"])).toEqual([
      { username: "cn=kl/o=mindoo", firstName: "Karsten", lastName: "Lehmann" },
    ]);
    mock.setDirectoryPeople([]);
    expect(await db.directory.searchUsers({ query: "lehm" })).toEqual([]);
  });

  it("answers the gateway configurations for the launch user", async () => {
    const mock = createMockMindooDBAppSession({
      databases: [{ info: { id: "main", title: "Main", capabilities: ["read", "directory"] } }],
      launchContext: { user: { id: "u1", username: "CN=Alice/O=Acme" } },
      mailGateways: [
        {
          gatewayUsername: "mail-gateway/acme",
          domains: ["Mail.Acme.Example"],
          users: [{ username: "alice/acme", addresses: ["Alice@mail.acme.example"] }],
        },
      ],
    });
    const db = await (await mock.bridge.connect()).openDatabase("main");
    expect(await db.directory.mailGateways()).toEqual([
      {
        gatewayUsername: "cn=mail-gateway/o=acme",
        domains: ["mail.acme.example"],
        ownAddresses: ["alice@mail.acme.example"],
        isDefault: true,
      },
    ]);
    expect(await db.directory.mailAddressesFor(["alice/acme", "cn=bob/o=acme"])).toEqual([
      { username: "alice/acme", addresses: ["alice@mail.acme.example"] },
      { username: "cn=bob/o=acme", addresses: [] },
    ]);
    mock.setMailGateways([]);
    expect(await db.directory.mailGateways()).toEqual([]);
  });
});
