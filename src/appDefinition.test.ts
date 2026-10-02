import { describe, expect, it } from "vitest";

import {
  MINDOODB_APP_DEFINITION_FORMAT,
  MINDOODB_APP_DEFINITION_VERSION,
  resolveMindooDBAppDefinitionUrl,
  resolveMindooDBAppListingAssetUrl,
  resolveMindooDBAppLocalizedText,
  validateMindooDBAppDefinition,
} from "./appDefinition";

function baseDefinition(overrides: Record<string, unknown> = {}) {
  return {
    format: MINDOODB_APP_DEFINITION_FORMAT,
    formatVersion: MINDOODB_APP_DEFINITION_VERSION,
    appId: "my-app",
    label: "My App",
    ...overrides,
  };
}

describe("validateMindooDBAppDefinition", () => {
  it("accepts a minimal definition", () => {
    const { definition, errors } = validateMindooDBAppDefinition(baseDefinition());
    expect(errors).toEqual([]);
    expect(definition).toMatchObject({ appId: "my-app", label: "My App" });
  });

  it("trims and de-duplicates database permissions", () => {
    const { definition, errors } = validateMindooDBAppDefinition(
      baseDefinition({
        databases: [
          { logicalDatabaseId: " notes ", label: " Notes ", permissions: ["write", "write"] },
        ],
      }),
    );
    expect(errors).toEqual([]);
    expect(definition?.databases).toEqual([
      { logicalDatabaseId: "notes", label: "Notes", databaseId: undefined, permissions: ["write"], create: undefined },
    ]);
  });

  it("rejects a database declared twice", () => {
    const { definition, errors } = validateMindooDBAppDefinition(
      baseDefinition({
        databases: [{ logicalDatabaseId: "notes" }, { logicalDatabaseId: "notes" }],
      }),
    );
    expect(errors).toEqual(['App definition lists the database "notes" more than once.']);
    expect(definition).toBeNull();
  });

  it("keeps create opt-out and treats a missing create as the default", () => {
    const { definition } = validateMindooDBAppDefinition(
      baseDefinition({
        databases: [
          { logicalDatabaseId: "notes", create: false },
          { logicalDatabaseId: "tasks" },
        ],
      }),
    );
    expect(definition?.databases?.map((database) => database.create)).toEqual([false, undefined]);
  });

  it("keeps registration-level permissions out of database permissions", () => {
    const { definition, errors } = validateMindooDBAppDefinition(
      baseDefinition({
        databases: [{ logicalDatabaseId: "notes", permissions: ["proposeapps"] }],
      }),
    );
    expect(definition).toBeNull();
    expect(errors).toEqual([
      'App definition database "notes" permissions contains the unknown permission "proposeapps".',
    ]);
  });

  it("accepts proposeapps as a registration-level permission", () => {
    const { definition, errors } = validateMindooDBAppDefinition(
      baseDefinition({ permissions: ["proposeapps"] }),
    );
    expect(errors).toEqual([]);
    expect(definition?.permissions).toEqual(["proposeapps"]);
  });

  it("reports every problem in one pass", () => {
    const { definition, errors } = validateMindooDBAppDefinition({
      format: "something-else",
      formatVersion: 99,
      runtime: "tab",
    });
    expect(definition).toBeNull();
    expect(errors).toEqual([
      'App definition format must be "mindoodb.haven.app", received "something-else".',
      "Unsupported app definition version 99, expected 1.",
      "App definition is missing a non-empty appId.",
      "App definition is missing a non-empty label.",
      'App definition runtime must be "iframe" or "window", received "tab".',
    ]);
  });

  it("rejects a default launch database that is not declared", () => {
    const { errors } = validateMindooDBAppDefinition(
      baseDefinition({
        databases: [{ logicalDatabaseId: "notes" }],
        defaultLaunchDatabaseId: "tasks",
      }),
    );
    expect(errors).toEqual([
      'App definition defaultLaunchDatabaseId "tasks" is not one of the declared databases.',
    ]);
  });

  it("keeps a valid agentToolPrefix and rejects a reserved or malformed one", () => {
    expect(validateMindooDBAppDefinition(baseDefinition({ agentToolPrefix: "vega" })).definition?.agentToolPrefix).toBe(
      "vega",
    );
    for (const agentToolPrefix of ["haven", "Vega", "vega-app", "vega_", "a_very_long_prefix_x"]) {
      expect(validateMindooDBAppDefinition(baseDefinition({ agentToolPrefix })).errors).toHaveLength(1);
    }
  });

  it("rejects a non-object payload", () => {
    expect(validateMindooDBAppDefinition("nope").errors).toEqual([
      "App definition must be a JSON object.",
    ]);
  });
});

describe("resolveMindooDBAppDefinitionUrl", () => {
  it("appends the file name to an app origin", () => {
    expect(resolveMindooDBAppDefinitionUrl("https://app.example.com")).toBe(
      "https://app.example.com/haven-app.json",
    );
    expect(resolveMindooDBAppDefinitionUrl("https://app.example.com/sub/")).toBe(
      "https://app.example.com/sub/haven-app.json",
    );
  });

  it("leaves a definition URL untouched and drops query plus hash", () => {
    expect(resolveMindooDBAppDefinitionUrl("https://app.example.com/haven-app.json?v=2#x")).toBe(
      "https://app.example.com/haven-app.json",
    );
  });

  it("handles a loopback host", () => {
    expect(resolveMindooDBAppDefinitionUrl("http://127.0.0.1:4201")).toBe(
      "http://127.0.0.1:4201/haven-app.json",
    );
  });

  it("returns an empty string for blank input", () => {
    expect(resolveMindooDBAppDefinitionUrl("   ")).toBe("");
  });
});

describe("app definition listing", () => {
  it("normalizes a full listing", () => {
    const { definition, errors } = validateMindooDBAppDefinition(
      baseDefinition({
        listing: {
          summary: { en: " Plans trips. ", de: "Plant Reisen." },
          description: "First paragraph.\n\nSecond paragraph.",
          icon: "icon.svg",
          screenshots: ["shots/1.webp", { file: "https://cdn.example.com/2.webp", caption: "Board" }],
          publisher: { name: " Mindoo ", url: "https://mindoo.de" },
        },
      }),
    );
    expect(errors).toEqual([]);
    expect(definition?.listing).toEqual({
      summary: { en: "Plans trips.", de: "Plant Reisen." },
      description: "First paragraph.\n\nSecond paragraph.",
      icon: "icon.svg",
      screenshots: [{ file: "shots/1.webp" }, { file: "https://cdn.example.com/2.webp", caption: "Board" }],
      publisher: { name: "Mindoo", url: "https://mindoo.de" },
    });
  });

  it("rejects unsafe asset URLs and localized maps without en", () => {
    const { definition, errors } = validateMindooDBAppDefinition(
      baseDefinition({
        listing: {
          summary: { de: "Nur Deutsch" },
          icon: "javascript:alert(1)",
          screenshots: [{ file: "//evil.example.com/x.png" }, { file: "data:image/png;base64,AA" }],
          publisher: { name: "X", url: "http://insecure.example.com" },
        },
      }),
    );
    expect(definition).toBeNull();
    expect(errors).toHaveLength(5);
  });

  it("caps the number of screenshots", () => {
    const { errors } = validateMindooDBAppDefinition(
      baseDefinition({ listing: { screenshots: Array.from({ length: 9 }, (_, i) => `s${i}.png`) } }),
    );
    expect(errors[0]).toMatch(/not list more than 8/);
  });

  it("resolves localized text by locale, language and en fallback", () => {
    const text = { en: "Hello", de: "Hallo", "de-CH": "Grüezi" };
    expect(resolveMindooDBAppLocalizedText(text, "de-CH")).toBe("Grüezi");
    expect(resolveMindooDBAppLocalizedText(text, "de-AT")).toBe("Hallo");
    expect(resolveMindooDBAppLocalizedText(text, "fr")).toBe("Hello");
    expect(resolveMindooDBAppLocalizedText("Plain", "fr")).toBe("Plain");
    expect(resolveMindooDBAppLocalizedText(undefined, "fr")).toBe("");
  });

  it("resolves listing assets against the app origin only", () => {
    expect(resolveMindooDBAppListingAssetUrl("icon.svg", "https://app.example.com")).toBe(
      "https://app.example.com/icon.svg",
    );
    expect(resolveMindooDBAppListingAssetUrl("shots/a.png", "https://app.example.com/sub/")).toBe(
      "https://app.example.com/sub/shots/a.png",
    );
    expect(resolveMindooDBAppListingAssetUrl("icon.svg", "http://127.0.0.1:4300")).toBe(
      "http://127.0.0.1:4300/icon.svg",
    );
    expect(resolveMindooDBAppListingAssetUrl("javascript:alert(1)", "https://app.example.com")).toBeNull();
  });
});
