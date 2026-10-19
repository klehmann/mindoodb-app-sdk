/** @vitest-environment jsdom */
/**
 * Inspection and save checks of embedded components through the mock host: in
 * process and over the bridge port, for host apps and for apps that are components.
 */
import { describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import {
  MINDOODB_INSPECT_DOCUMENT,
  MindooDBAppEmbedValidationError,
  defineDocumentRules,
  mindooDBAppInspectRules,
  readMindooDBAppInspectionSummary,
  type MindooDBAppDocumentInspection,
  type MindooDBAppIssue,
} from "../inspection";
import type { MindooDBAppCapability, MindooDBAppComponentInfo } from "../types";
import { createFakeBridgeHost, createMemoryAttachments, createMockMindooDBAppSession } from "./index";

const word: MindooDBAppComponentInfo = {
  key: "teamedit/word",
  appInstanceId: "teamedit",
  appId: "mindoodb-app-teamedit",
  appLabel: "TeamEdit",
  componentId: "word",
  label: "Word",
  intents: ["create", "edit", "view"],
  match: { form: "word" },
  createFields: { form: "word" },
  supports: ["inspect:mindoo.inspect.document@1", "validate", "issues", "reveal"],
};

const plain: MindooDBAppComponentInfo = {
  ...word,
  key: "notes/note",
  appInstanceId: "notes",
  appId: "notes",
  componentId: "note",
  match: { form: "note" },
  createFields: { form: "note" },
  supports: undefined,
};

const crmDatabase = () => ({
  info: { id: "crm", title: "CRM", capabilities: ["read", "create", "update"] as MindooDBAppCapability[] },
  documents: [
    { id: "letter", data: { form: "word", subject: "Offer" } },
    { id: "note", data: { form: "note", subject: "Note" } },
  ],
  methods: { attachments: createMemoryAttachments() },
});

let placeholders: MindooDBAppDocumentInspection["placeholders"] = [];
const describeLetter = (): MindooDBAppDocumentInspection => ({
  contract: MINDOODB_INSPECT_DOCUMENT,
  subject: "Offer",
  outline: [{ level: 1, text: "Intro", anchor: { kind: "heading", id: "h1" } }],
  placeholders,
  openComments: 0,
  openTrackedChanges: 1,
  wordCount: 3,
});

const rules = defineDocumentRules<MindooDBAppDocumentInspection>({
  contract: MINDOODB_INSPECT_DOCUMENT,
  rules: [mindooDBAppInspectRules.noOpenPlaceholders(), mindooDBAppInspectRules.noOpenTrackedChanges("warning")],
});

describe("host side, in process", () => {
  it("filters components by what they support", async () => {
    const mock = createMockMindooDBAppSession({ components: [word, plain] });
    const session = await mock.bridge.connect();
    await expect(session.components.list({ requires: ["inspect"] })).resolves.toMatchObject([{ key: word.key }]);
    await expect(session.components.list({ requires: ["inspect:mindoo.inspect.document@1", "reveal"] })).resolves.toHaveLength(1);
    await expect(session.components.list({ requires: ["inspect:mindoo.inspect.slides@1"] })).resolves.toEqual([]);
    await expect(session.components.list({})).resolves.toHaveLength(2);
  });

  it("inspects, checks saves, and reaches the component", async () => {
    placeholders = [{ name: "NAME", kind: "mergefield" }];
    let confirm = true;
    const mock = createMockMindooDBAppSession({
      components: [word, plain],
      databases: [crmDatabase()],
      embedInspection: () => describeLetter(),
      embedTools: (_embed, name, input) => ({ called: name, input }),
      confirmSaveWarnings: () => confirm,
    });
    const session = await mock.bridge.connect();
    const embed = await session.embeds.open({ componentKey: word.key, databaseId: "crm", docId: "letter" });
    expect(embed.supports).toEqual(word.supports);
    await expect(embed.inspect<MindooDBAppDocumentInspection>({ include: ["text"] })).resolves.toMatchObject({
      placeholders: [{ name: "NAME" }],
    });

    const roots: unknown[] = [];
    const stop = embed.onBeforeSave((input) => {
      roots.push(input.root);
      return rules.beforeSave(input);
    });
    const saved: string[] = [];
    embed.onAfterSave((event) => saved.push(event.embedId));
    await expect(embed.save()).rejects.toBeInstanceOf(MindooDBAppEmbedValidationError);
    expect(roots).toEqual([{ form: "word", subject: "Offer" }]);
    expect(saved).toEqual([]);

    placeholders = [];
    confirm = false;
    await expect(mock.validateEmbed(embed.embedId)).resolves.toMatchObject({ ok: false, issues: [{ code: "open-tracked-changes" }] });
    await expect(mock.validateEmbed(embed.embedId, { interactive: false })).resolves.toMatchObject({ ok: true });
    confirm = true;
    await embed.save();
    expect(saved).toEqual([embed.embedId]);

    stop();
    expect(mock.listEmbeds()[0]?.beforeSave).toBeNull();
    await expect(mock.validateEmbed(embed.embedId)).resolves.toEqual({ ok: true, issues: [] });

    const issue: MindooDBAppIssue = { severity: "error", message: "Fill in NAME", anchor: { kind: "heading", id: "h1" } };
    await embed.showIssues([issue]);
    await embed.reveal({ kind: "heading", id: "h1" });
    await expect(embed.callTool("teamedit_text_insert", { text: "Hi" })).resolves.toEqual({
      called: "text_insert",
      input: { text: "Hi" },
    });
    expect(mock.getEmbedRequests(embed.embedId).map((entry) => entry.request)).toEqual([
      "inspect",
      "showIssues",
      "reveal",
      "callTool",
    ]);

    const note = await session.embeds.open({ componentKey: plain.key, databaseId: "crm", docId: "note" });
    await expect(note.inspect()).rejects.toThrow(/cannot describe/);
    await expect(note.reveal({ kind: "slide", index: 0 })).rejects.toThrow(/cannot reveal/);
  });
});

describe("over the bridge port", () => {
  it("runs the host's save check through the app and pushes saved events", async () => {
    placeholders = [{ name: "NAME", kind: "placeholder" }];
    const host = createFakeBridgeHost({
      components: [word],
      databases: [crmDatabase()],
      embedInspection: () => describeLetter(),
      embedTools: (_embed, name) => ({ name }),
    });
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      const embed = await session.embeds.open({ componentKey: word.key, databaseId: "crm", docId: "letter", rect: { left: 0, top: 0, width: 1, height: 1 } });
      expect(embed.supports).toEqual(word.supports);
      await expect(embed.inspect()).resolves.toMatchObject({ contract: MINDOODB_INSPECT_DOCUMENT });
      rules.attach(embed);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(host.listEmbeds()[0]?.beforeSave).toEqual({ inspect: { contract: MINDOODB_INSPECT_DOCUMENT } });

      await expect(host.validateEmbed(embed.embedId)).resolves.toMatchObject({
        ok: false,
        issues: [{ severity: "error", code: "open-placeholders" }, { severity: "warning" }],
      });

      const saved = new Promise((resolve) => embed.onAfterSave(resolve));
      host.notifyEmbedSaved(embed.embedId);
      await expect(saved).resolves.toEqual({ embedId: embed.embedId });

      await expect(embed.callTool("text_insert", {})).resolves.toEqual({ name: "text_insert" });
      await embed.showIssues([{ severity: "info", message: "ok" }]);
      expect(host.getEmbedRequests(embed.embedId).at(-1)).toEqual({ request: "showIssues", issues: [{ severity: "info", message: "ok" }] });
    } finally {
      host.dispose();
    }
  });

  it("answers a failing check with a warning instead of losing the save", async () => {
    const host = createFakeBridgeHost({ components: [word], databases: [crmDatabase()] });
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      const embed = await session.embeds.open({ componentKey: word.key, databaseId: "crm", docId: "letter", rect: { left: 0, top: 0, width: 1, height: 1 } });
      embed.onBeforeSave(() => {
        throw new Error("boom");
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await expect(host.validateEmbed(embed.embedId, { interactive: false })).resolves.toEqual({
        ok: true,
        issues: [{ severity: "warning", message: "The check failed: boom", code: "check-failed" }],
      });
    } finally {
      host.dispose();
    }
  });
});

describe("component side", () => {
  it("answers inspections and saves only when the host's check lets it", async () => {
    let hostIssues: MindooDBAppIssue[] = [{ severity: "error", message: "Fill in NAME", code: "open-placeholders" }];
    const host = createFakeBridgeHost({
      databases: [crmDatabase()],
      embeddingValidation: () => ({ ok: !hostIssues.some((issue) => issue.severity === "error"), issues: hostIssues }),
    });
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      await expect(host.requestEmbeddingInspection()).rejects.toThrow("unsupported");
      placeholders = [];
      const requests: unknown[] = [];
      session.embedding.provideInspection((request) => {
        requests.push(request);
        return describeLetter();
      });
      const shown: MindooDBAppIssue[][] = [];
      session.embedding.onShowIssues((issues) => {
        shown.push(issues);
      });
      const revealed: unknown[] = [];
      session.embedding.onReveal((anchor) => {
        revealed.push(anchor);
      });

      await expect(host.requestEmbeddingInspection({ include: ["text"], maxTextLength: 10 })).resolves.toMatchObject({
        contract: MINDOODB_INSPECT_DOCUMENT,
      });
      expect(requests).toEqual([{ include: ["text"], maxTextLength: 10 }]);

      const flushed: unknown[] = [];
      const flush = (context: { inspection: unknown }) => {
        flushed.push(context.inspection);
      };
      await expect(session.embedding.save(flush)).rejects.toBeInstanceOf(MindooDBAppEmbedValidationError);
      expect(flushed).toEqual([]);
      expect(shown).toEqual([hostIssues]);

      hostIssues = [{ severity: "warning", message: "Unresolved changes" }];
      await expect(session.embedding.save(flush, { interactive: false })).resolves.toMatchObject({ ok: true, issues: hostIssues });
      expect(host.getEmbeddingValidations().map((entry) => entry.interactive)).toEqual([true, false]);
      expect(host.getEmbeddingSaveCount()).toBe(1);
      const summary = flushed[0] as { $mindoo: string; value: string };
      expect(readMindooDBAppInspectionSummary({ inspection: summary.value })).toMatchObject({ subject: "Offer", openTrackedChanges: 1 });

      await host.requestEmbeddingShowIssues(hostIssues);
      await host.requestEmbeddingReveal({ kind: "heading", id: "h1" });
      expect(shown.at(-1)).toEqual(hostIssues);
      expect(revealed).toEqual([{ kind: "heading", id: "h1" }]);
    } finally {
      host.dispose();
    }
  });

  it("saves standalone without checks", async () => {
    const mock = createMockMindooDBAppSession();
    const session = await mock.bridge.connect();
    let flushed = 0;
    await expect(session.embedding.save(() => void (flushed += 1))).resolves.toEqual({ ok: true, issues: [] });
    expect(flushed).toBe(1);
    expect(mock.getEmbeddingSaveCount()).toBe(1);
  });
});
