import { describe, expect, it } from "vitest";

import { validateMindooDBAppComponents } from "./appDefinition";
import {
  mindooDBAppExportPayload,
  normalizeMindooDBAppEmbedExportRequest,
  normalizeMindooDBAppEmbedVariables,
  resolveMindooDBAppVariables,
} from "./embedExchange";

describe("variables", () => {
  it("keeps valid keys once and shortens texts", () => {
    expect(
      normalizeMindooDBAppEmbedVariables([
        { key: "company.name", label: "Firma", value: "Müller GmbH", group: "Firma" },
        { key: "bad key", label: "x", value: "y" },
        { key: "count", label: "", value: 3 },
        { key: "company.name", label: "Firma", value: "Neu GmbH" },
        "nope",
      ]),
    ).toEqual([
      { key: "count", label: "count", value: "3" },
      { key: "company.name", label: "Firma", value: "Neu GmbH" },
    ]);
  });

  it("fills {{key}} placeholders and leaves the rest", () => {
    const variables = [
      { key: "name", label: "Name", value: "Anna" },
      { key: "empty", label: "Leer", value: "" },
    ];
    expect(resolveMindooDBAppVariables("Hallo {{ name }}, {{empty}} {{other}}", variables)).toBe("Hallo Anna, {{empty}} {{other}}");
    expect(resolveMindooDBAppVariables("[{{empty}}]", variables, { keepEmpty: true })).toBe("[]");
  });
});

describe("export", () => {
  it("validates requests", () => {
    expect(normalizeMindooDBAppEmbedExportRequest({ format: "PNG", maxWidth: 400.4, maxHeight: -1 })).toEqual({ format: "png", maxWidth: 400 });
    expect(() => normalizeMindooDBAppEmbedExportRequest({ format: "../x" })).toThrow(/format/);
  });

  it("turns provider results into payloads", async () => {
    const request = { format: "pdf" };
    const fromBlob = await mindooDBAppExportPayload(new Blob(["%PDF"], { type: "application/pdf" }), request, "Angebot");
    expect(fromBlob).toMatchObject({ name: "Angebot.pdf", mimeType: "application/pdf" });
    expect(new TextDecoder().decode(fromBlob.data)).toBe("%PDF");
    const fromBytes = await mindooDBAppExportPayload({ data: new Uint8Array([1, 2, 3]), name: "a.png" }, { format: "png" });
    expect(fromBytes).toMatchObject({ name: "a.png", mimeType: "image/png" });
    expect(fromBytes.data.byteLength).toBe(3);
  });

  it("accepts export and variables entries in supports", () => {
    const { components, errors } = validateMindooDBAppComponents([
      { id: "word", label: "Word", intents: ["edit"], match: { form: "w" }, supports: ["export:pdf", "variables", "template", "inspect:mindoo.inspect.document@1"] },
    ]);
    expect(errors).toEqual([]);
    expect(components?.[0]?.supports).toHaveLength(4);
  });
});
