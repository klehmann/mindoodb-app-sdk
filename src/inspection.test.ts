import { describe, expect, it } from "vitest";

import { validateMindooDBAppComponents } from "./appDefinition";
import {
  MINDOODB_APP_INSPECTION_SUMMARY_MAX_BYTES,
  MINDOODB_INSPECT_DOCUMENT,
  MINDOODB_INSPECT_SPREADSHEET,
  defineDocumentRules,
  mindooDBAppComponentSupports,
  mindooDBAppInspectionSummaryValue,
  mindooDBAppInspectRules,
  normalizeMindooDBAppIssues,
  readMindooDBAppInspectionSummary,
  resolveMindooDBAppEmbedValidation,
  summarizeMindooDBAppInspection,
  type MindooDBAppDocumentInspection,
  type MindooDBAppSpreadsheetInspection,
} from "./inspection";

const letter = (overrides: Partial<MindooDBAppDocumentInspection> = {}): MindooDBAppDocumentInspection => ({
  contract: MINDOODB_INSPECT_DOCUMENT,
  subject: "Offer",
  outline: [{ level: 1, text: "Intro", anchor: { kind: "heading", id: "h1" } }],
  placeholders: [],
  openComments: 0,
  openTrackedChanges: 0,
  wordCount: 120,
  ...overrides,
});

const component = (supports: unknown) => [
  { id: "word", label: "Word", intents: ["edit"], match: { form: "word" }, supports },
];

describe("component supports", () => {
  it("validates and keeps the declared entries", () => {
    const { components, errors } = validateMindooDBAppComponents(
      component(["inspect:mindoo.inspect.document@1", "validate", "issues", "reveal", "validate"]),
    );
    expect(errors).toEqual([]);
    expect(components?.[0]?.supports).toEqual(["inspect:mindoo.inspect.document@1", "validate", "issues", "reveal"]);
  });

  it("rejects malformed entries", () => {
    for (const bad of [["Validate"], ["inspect:Bad"], ["inspect:a.b@1:x"], "validate", [1]]) {
      expect(validateMindooDBAppComponents(component(bad)).errors).toHaveLength(1);
    }
  });

  it("matches a capability with or without its contract", () => {
    const supports = ["inspect:mindoo.inspect.document@1", "validate"];
    expect(mindooDBAppComponentSupports(supports, "inspect")).toBe(true);
    expect(mindooDBAppComponentSupports(supports, "inspect:mindoo.inspect.document@1")).toBe(true);
    expect(mindooDBAppComponentSupports(supports, "inspect:mindoo.inspect.document@2")).toBe(false);
    expect(mindooDBAppComponentSupports(supports, "reveal")).toBe(false);
    expect(mindooDBAppComponentSupports(undefined, "validate")).toBe(false);
  });
});

describe("issues", () => {
  it("drops what is not an issue and shortens the rest", () => {
    expect(
      normalizeMindooDBAppIssues([
        { severity: "error", message: "x".repeat(600), code: "c", anchor: { kind: "cell", ref: "B3" } },
        { severity: "fatal", message: "no" },
        { severity: "info", message: "  " },
        { severity: "warning", message: "w", anchor: { kind: "slide", index: -1 } },
        "nope",
      ]),
    ).toEqual([
      { severity: "error", message: "x".repeat(500), code: "c", anchor: { kind: "cell", ref: "B3" } },
      { severity: "warning", message: "w" },
    ]);
  });

  it("resolves a check like Haven: errors stop, warnings ask unless not interactive", async () => {
    const error = { severity: "error" as const, message: "e" };
    const warning = { severity: "warning" as const, message: "w" };
    await expect(resolveMindooDBAppEmbedValidation([error, warning], true, () => true)).resolves.toMatchObject({ ok: false });
    await expect(resolveMindooDBAppEmbedValidation([warning], true, () => false)).resolves.toMatchObject({ ok: false });
    await expect(resolveMindooDBAppEmbedValidation([warning], true, () => true)).resolves.toMatchObject({ ok: true });
    let asked = false;
    await expect(
      resolveMindooDBAppEmbedValidation([warning], false, () => {
        asked = true;
        return false;
      }),
    ).resolves.toEqual({ ok: true, issues: [warning] });
    expect(asked).toBe(false);
  });
});

describe("root summary", () => {
  it("fits the limit, keeps counts and marks what it shortened", () => {
    const big = letter({
      text: "word ".repeat(20_000),
      outline: Array.from({ length: 400 }, (_, index) => ({
        level: 2,
        text: `Heading ${index} ${"long ".repeat(30)}`,
        anchor: { kind: "heading" as const, id: `h${index}` },
      })),
      placeholders: Array.from({ length: 300 }, (_, index) => ({ name: `FIELD_${index}`, kind: "mergefield" as const })),
      openComments: 7,
    });
    const summary = summarizeMindooDBAppInspection(big);
    expect(JSON.stringify(summary).length).toBeLessThanOrEqual(MINDOODB_APP_INSPECTION_SUMMARY_MAX_BYTES);
    expect(summary).toMatchObject({ contract: MINDOODB_INSPECT_DOCUMENT, subject: "Offer", openComments: 7, truncated: true });
    expect(summary.placeholders.length).toBeGreaterThan(0);
  });

  it("leaves requested cells out and round-trips through the root field", () => {
    const sheet: MindooDBAppSpreadsheetInspection = {
      contract: MINDOODB_INSPECT_SPREADSHEET,
      sheets: [{ name: "Sheet1" }],
      namedRanges: [],
      cells: { B3: { value: 1 } },
      formulaErrors: [{ ref: "Sheet1!C2", error: "#REF!" }],
    };
    const value = mindooDBAppInspectionSummaryValue(sheet);
    expect(value.$mindoo).toBe("atomic");
    const read = readMindooDBAppInspectionSummary<MindooDBAppSpreadsheetInspection>({ inspection: value.value });
    expect(read).toEqual({ contract: MINDOODB_INSPECT_SPREADSHEET, sheets: [{ name: "Sheet1" }], namedRanges: [], formulaErrors: sheet.formulaErrors });
    expect(readMindooDBAppInspectionSummary({ inspection: "{not json" })).toBeNull();
    expect(readMindooDBAppInspectionSummary({})).toBeNull();
  });
});

describe("defineDocumentRules", () => {
  const rules = defineDocumentRules<MindooDBAppDocumentInspection>({
    contract: MINDOODB_INSPECT_DOCUMENT,
    include: ["text"],
    rules: [
      mindooDBAppInspectRules.noOpenPlaceholders(),
      mindooDBAppInspectRules.noOpenTrackedChanges(),
      { code: "short", severity: "info", check: (inspection) => (inspection.wordCount < 50 ? "Very short." : null) },
      {
        code: "broken",
        check: () => {
          throw new Error("boom");
        },
      },
    ],
  });

  it("checks a full inspection and the root summary alike", () => {
    const inspection = letter({ placeholders: [{ name: "NAME", kind: "mergefield" }], openTrackedChanges: 2, wordCount: 10 });
    const expected = [
      { severity: "error", code: "open-placeholders", message: "1 placeholder is not filled in: NAME" },
      { severity: "warning", code: "open-tracked-changes", message: "2 tracked changes are not accepted or rejected." },
      { severity: "info", code: "short", message: "Very short." },
      { severity: "warning", code: "broken", message: 'Check "broken" failed: boom' },
    ];
    expect(rules.check(inspection)).toEqual(expected);
    expect(rules.checkRoot({ inspection: mindooDBAppInspectionSummaryValue(inspection).value })).toEqual(expected);
    expect(rules.request).toEqual({ contract: MINDOODB_INSPECT_DOCUMENT, include: ["text"] });
  });

  it("ignores other contracts and missing summaries", () => {
    expect(rules.check({ contract: MINDOODB_INSPECT_SPREADSHEET })).toEqual([]);
    expect(rules.checkRoot({ form: "word" })).toEqual([]);
    expect(rules.beforeSave({ inspection: null })).toEqual({ issues: [] });
  });

  it("anchors spreadsheet and slide findings", () => {
    const sheetRules = defineDocumentRules<MindooDBAppSpreadsheetInspection>({ rules: [mindooDBAppInspectRules.noFormulaErrors()] });
    expect(
      sheetRules.check({
        contract: MINDOODB_INSPECT_SPREADSHEET,
        sheets: [],
        namedRanges: [],
        formulaErrors: [{ ref: "Sheet1!C2", error: "#REF!" }],
      } as MindooDBAppSpreadsheetInspection),
    ).toEqual([{ severity: "error", code: "formula-errors", message: "Sheet1!C2: #REF!", anchor: { kind: "cell", ref: "Sheet1!C2" } }]);
  });
});
