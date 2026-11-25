import { describe, expect, it } from "vitest";

import { directoryPersonMatchScore, mailAddressesFromConfigs, mailGatewaysFromConfigs, searchDirectoryPeople } from "./directorySearch";

const people = [
  { username: "CN=kl/O=Mindoo", firstName: "Karsten", lastName: "Lehmann" },
  { username: "CN=Erika Karleh/O=Acme" },
  { username: "CN=Ada Lovelace/O=Acme", displayName: "Countess Ada" },
  { username: "CN=Bob Builder/OU=Sales/O=Acme" },
];

describe("searchDirectoryPeople", () => {
  it("matches first, last, full, display name and username, case-insensitive", () => {
    const usernames = (query: string) => searchDirectoryPeople(people, { query }).map((person) => person.username);
    expect(usernames("lehmann")).toEqual(["CN=kl/O=Mindoo"]);
    expect(usernames("KARSTEN LEH")).toEqual(["CN=kl/O=Mindoo"]);
    expect(usernames("kl")).toEqual(["CN=kl/O=Mindoo"]);
    expect(usernames("countess")).toEqual(["CN=Ada Lovelace/O=Acme"]);
    expect(usernames("love")).toEqual(["CN=Ada Lovelace/O=Acme"]);
    expect(usernames("sales")).toEqual(["CN=Bob Builder/OU=Sales/O=Acme"]);
    expect(usernames("bob/sales")).toEqual(["CN=Bob Builder/OU=Sales/O=Acme"]);
    expect(usernames("nobody")).toEqual([]);
    expect(usernames("")).toEqual([]);
  });

  it("ranks word starts before substrings and the full name first", () => {
    // "kar": a word start of Karsten and of Karleh; "leh": start of Lehmann, inside Karleh
    expect(searchDirectoryPeople(people, { query: "kar leh" }).map((person) => person.username)).toEqual([
      "CN=kl/O=Mindoo",
      "CN=Erika Karleh/O=Acme",
    ]);
    expect(directoryPersonMatchScore(people[0]!, "karsten lehmann")!).toBeGreaterThan(
      directoryPersonMatchScore(people[0]!, "lehmann karsten")!,
    );
    // "acme": every Acme user; same score, then by the shown name (Ada shows as "Countess Ada")
    expect(searchDirectoryPeople(people, { query: "acme" }).map((person) => person.username)).toEqual([
      "CN=Bob Builder/OU=Sales/O=Acme",
      "CN=Ada Lovelace/O=Acme",
      "CN=Erika Karleh/O=Acme",
    ]);
  });

  it("limits the results (default 20, at most 100)", () => {
    const many = Array.from({ length: 150 }, (_, index) => ({ username: `CN=User ${index}/O=Acme` }));
    expect(searchDirectoryPeople(many, { query: "user" })).toHaveLength(20);
    expect(searchDirectoryPeople(many, { query: "user", limit: 2 })).toHaveLength(2);
    expect(searchDirectoryPeople(many, { query: "user", limit: 1000 })).toHaveLength(100);
  });
});

describe("mailGatewaysFromConfigs", () => {
  const config = {
    gatewayUsername: "mail-gateway/acme",
    domains: ["Mail.Acme.Example", ""],
    users: [
      { username: "alice/acme", addresses: ["Alice@mail.acme.example", "info@mail.acme.example", "alice@elsewhere.example"] },
      { username: "cn=bob/o=acme", addresses: ["bob@mail.acme.example", "info@mail.acme.example"] },
      { username: "carol/acme", addresses: [] },
    ],
  };

  it("applies the gateway's rules: canonical names, lower case, own domains, no conflicts; no other members", () => {
    expect(mailGatewaysFromConfigs([config], "CN=Alice/O=Acme")).toEqual([
      {
        gatewayUsername: "cn=mail-gateway/o=acme",
        domains: ["mail.acme.example"],
        ownAddresses: ["alice@mail.acme.example"],
        ownListAddresses: [],
        isDefault: true,
      },
    ]);
  });

  it("names the lists the user is a member of; list addresses claimed twice or outside the domains count for nobody", () => {
    const withLists = {
      ...config,
      users: [...config.users, { username: "dora/acme", addresses: ["sales@mail.acme.example"] }],
      lists: [
        { address: "Team@mail.acme.example", members: ["cn=alice/o=acme", "bob/acme"], group: "team" },
        { address: "all@mail.acme.example", members: ["alice/acme"] },
        { address: "sales@mail.acme.example", members: ["alice/acme"] },
        { address: "x@elsewhere.example", members: ["alice/acme"] },
      ],
    };
    const [alice] = mailGatewaysFromConfigs([withLists], "CN=Alice/O=Acme");
    expect(alice!.ownListAddresses).toEqual(["all@mail.acme.example", "team@mail.acme.example"]);
    const [bob] = mailGatewaysFromConfigs([withLists], "cn=bob/o=acme");
    expect(bob!.ownListAddresses).toEqual(["team@mail.acme.example"]);
    // Team mailboxes count like lists for sending.
    const [withTeam] = mailGatewaysFromConfigs(
      [{ ...withLists, teamMailboxes: [{ address: "help@mail.acme.example", mailboxId: "help0001", members: ["bob/acme"] }] }],
      "cn=bob/o=acme",
    );
    expect(withTeam!.ownListAddresses).toEqual(["help@mail.acme.example", "team@mail.acme.example"]);
    // The person's address that is also a list address is nobody's.
    expect(mailAddressesFromConfigs([withLists], ["dora/acme"])).toEqual([{ username: "dora/acme", addresses: [] }]);
  });

  it("mailAddressesFromConfigs: one entry per username asked, same rules, all gateways", () => {
    const other = { gatewayUsername: "cn=gw2/o=acme", domains: ["acme.example"], users: [{ username: "cn=alice/o=acme", addresses: ["a@acme.example"] }] };
    expect(mailAddressesFromConfigs([config, other], ["CN=Alice/O=Acme", "bob/acme", "carol/acme", "nobody/acme"])).toEqual([
      { username: "CN=Alice/O=Acme", addresses: ["alice@mail.acme.example", "a@acme.example"] },
      { username: "bob/acme", addresses: ["bob@mail.acme.example"] },
      { username: "carol/acme", addresses: [] },
      { username: "nobody/acme", addresses: [] },
    ]);
  });

  it("the default is the gateway with an address for the user, else the first", () => {
    const other = { gatewayUsername: "cn=gw2/o=acme", domains: ["acme.example"], users: [{ username: "dave/acme", addresses: ["dave@acme.example"] }] };
    const forDave = mailGatewaysFromConfigs([config, other], "dave/acme");
    expect(forDave.map((gateway) => [gateway.gatewayUsername, gateway.isDefault, gateway.ownAddresses])).toEqual([
      ["cn=mail-gateway/o=acme", false, []],
      ["cn=gw2/o=acme", true, ["dave@acme.example"]],
    ]);
    const forNobody = mailGatewaysFromConfigs([config, other], "cn=eve/o=acme");
    expect(forNobody.map((gateway) => gateway.isDefault)).toEqual([true, false]);
  });

  it("skips configurations without gateway or domains", () => {
    expect(mailGatewaysFromConfigs([{ ...config, gatewayUsername: " " }, { ...config, domains: [] }], "alice/acme")).toEqual([]);
  });
});
