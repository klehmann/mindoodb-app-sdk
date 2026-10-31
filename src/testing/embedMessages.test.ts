/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { validateMindooDBAppDefinition } from "../appDefinition";
import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import { normalizeMindooDBAppEmbedMessagePayload } from "../embedExchange";
import type { MindooDBAppCapability, MindooDBAppComponentInfo } from "../types";
import { createFakeBridgeHost, createMockMindooDBAppSession } from "./index";

const mailbox: MindooDBAppComponentInfo = {
  key: "mail/mailbox",
  appInstanceId: "mail",
  appId: "mindoodb-app-mindoomail",
  appLabel: "MindooMail",
  componentId: "mailbox",
  scope: "app",
  label: "Mailbox",
  intents: ["view"],
  match: {},
  createFields: {},
};

const crmDatabase = () => ({
  info: { id: "crm", title: "CRM", capabilities: ["read", "create", "update"] as MindooDBAppCapability[] },
  documents: [],
});

const fileMail = {
  type: "mindoo.file.document@1",
  data: { fields: { subject: "Angebot" } },
  files: [new File(["%PDF"], "angebot.pdf", { type: "application/pdf" })],
};

describe("components with scope app", () => {
  it("are declared without match and only for view", () => {
    const base = {
      format: "mindoodb.haven.app",
      formatVersion: 1,
      appId: "mindoodb-app-mindoomail",
      label: "Mail",
      version: "1.0.0",
      runtime: "iframe",
      hosting: "hosted",
      databases: [{ logicalDatabaseId: "pimdb", label: "Mail", databaseId: "pimdb", permissions: ["write"] }],
    };
    const ok = validateMindooDBAppDefinition({
      ...base,
      components: [{ id: "mailbox", scope: "app", label: "Mailbox", intents: ["view"], category: "mailbox" }],
    });
    expect(ok.errors).toEqual([]);
    expect(ok.definition?.components?.[0]).toMatchObject({ id: "mailbox", scope: "app", match: {}, intents: ["view"] });
    const withMatch = validateMindooDBAppDefinition({
      ...base,
      components: [{ id: "mailbox", scope: "app", label: "Mailbox", intents: ["view"], match: { form: "x" } }],
    });
    expect(withMatch.errors.join(" ")).toMatch(/must not declare match/);
    const edit = validateMindooDBAppDefinition({
      ...base,
      components: [{ id: "mailbox", scope: "app", label: "Mailbox", intents: ["edit"] }],
    });
    expect(edit.errors.join(" ")).toMatch(/only intent is "view"/);
  });

  it("open without a document and answer messages both ways in the mock", async () => {
    const mock = createMockMindooDBAppSession({
      components: [mailbox],
      databases: [crmDatabase()],
      embedMessages: (embed, message) => ({ draftId: `${embed.component.componentId}:${message.type}:${message.files?.length}` }),
    });
    const session = await mock.bridge.connect();
    const embed = await session.embeds.open({ componentKey: mailbox.key, rect: { left: 0, top: 0, width: 1, height: 1 } });
    expect(embed.docId).toBe("");
    await expect(embed.request({ type: "mindoo.mail.compose@1", data: { to: ["a@b.c"] }, files: fileMail.files })).resolves.toEqual({
      draftId: "mailbox:mindoo.mail.compose@1:1",
    });
    expect(mock.getEmbedRequests(embed.embedId)).toEqual([
      { request: "message", type: "mindoo.mail.compose@1", data: { to: ["a@b.c"] }, fileNames: ["angebot.pdf"] },
    ]);
    await expect(mock.sendFromEmbed(embed.embedId, fileMail)).rejects.toThrow(/unsupported/);
    embed.onRequest(async (message) => ({ filed: message.data, bytes: await message.files?.[0]?.text() }));
    await expect(mock.sendFromEmbed(embed.embedId, fileMail)).resolves.toEqual({
      filed: { fields: { subject: "Angebot" } },
      bytes: "%PDF",
    });
  });
});

describe("over the bridge port", () => {
  it("carries messages and files from a component to its host and back", async () => {
    const host = createFakeBridgeHost({
      components: [mailbox],
      databases: [crmDatabase()],
      embedMessages: (_embed, message) => ({ got: message.type }),
    });
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      const embed = await session.embeds.open({ componentKey: mailbox.key, rect: { left: 0, top: 0, width: 1, height: 1 } });
      await expect(embed.request({ type: "mindoo.mail.compose@1" })).resolves.toEqual({ got: "mindoo.mail.compose@1" });
      embed.onRequest((message) => {
        if (message.type !== "mindoo.file.document@1") throw new Error("unknown message");
        return { docId: "filed-1", files: message.files?.map((file) => `${file.name}:${file.size}`) };
      });
      await expect(host.sendFromEmbed(embed.embedId, fileMail)).resolves.toEqual({ docId: "filed-1", files: ["angebot.pdf:4"] });
      await expect(host.sendFromEmbed(embed.embedId, { type: "other" })).rejects.toThrow(/unknown message/);
    } finally {
      host.dispose();
    }
  });

  it("lets a component ask its host and answer the host's messages", async () => {
    const host = createFakeBridgeHost({
      databases: [crmDatabase()],
      embeddingMessages: (message) => ({ filedAs: (message.data as { fields: { subject: string } }).fields.subject }),
    });
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      await expect(session.embedding.request(fileMail)).resolves.toEqual({ filedAs: "Angebot" });
      expect(host.getEmbeddingMessages().map((message) => message.files?.[0]?.name)).toEqual(["angebot.pdf"]);
      await expect(host.requestEmbeddingMessage({ type: "mindoo.mail.compose@1" })).rejects.toThrow(/unsupported/);
      session.embedding.onRequest((message) => ({ draftId: "d1", subject: (message.data as { subject: string }).subject }));
      await expect(host.requestEmbeddingMessage({ type: "mindoo.mail.compose@1", data: { subject: "Hi" } })).resolves.toEqual({
        draftId: "d1",
        subject: "Hi",
      });
    } finally {
      host.dispose();
    }
  });
});

describe("message payloads", () => {
  it("reject bad types, non-JSON data and oversized files", () => {
    expect(() => normalizeMindooDBAppEmbedMessagePayload({ type: "" })).toThrow(/type/);
    expect(() => normalizeMindooDBAppEmbedMessagePayload({ type: "x", data: { f: () => 1 } })).not.toThrow();
    expect(() => normalizeMindooDBAppEmbedMessagePayload({ type: "x", files: [{ name: "a", data: "nope" }] })).toThrow(/ArrayBuffer/);
    const big = new ArrayBuffer(33 * 1024 * 1024);
    expect(() => normalizeMindooDBAppEmbedMessagePayload({ type: "x", files: [{ name: "a", data: big }] })).toThrow(/larger/);
  });
});
