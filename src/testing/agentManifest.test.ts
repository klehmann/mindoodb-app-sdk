import { describe, expect, it } from "vitest";

import { MINDOODB_APP_DEFINITION_FORMAT, MINDOODB_APP_DEFINITION_VERSION } from "../appDefinition";
import { assertAgentManifest, checkAgentManifest } from "./index";

const TOOLS = ["maps_list", "map_get", "nodes_add", "nodes_update", "ops_guide", "get_context"];

function definition(agent: Record<string, unknown> = {}) {
  return {
    format: MINDOODB_APP_DEFINITION_FORMAT,
    formatVersion: MINDOODB_APP_DEFINITION_VERSION,
    appId: "mindoodb-app-vega",
    label: "Vega",
    agentToolPrefix: "vega",
    agent: {
      summary: { en: "Mind maps whose nodes are tasks.", de: "Mindmaps, deren Knoten Aufgaben sind." },
      capabilities: [
        { id: "maps", title: { en: "Find maps", de: "Maps finden" }, tools: ["maps_list", "map_get"] },
        { id: "nodes", title: { en: "Edit nodes", de: "Knoten bearbeiten" }, tools: ["nodes_add", "nodes_update", "ops_guide"] },
      ],
      ...agent,
    },
  };
}

describe("checkAgentManifest", () => {
  it("passes a profile that matches the tools and warns about tools without a capability", () => {
    const result = checkAgentManifest({
      definition: definition(),
      tools: TOOLS.map((name) => ({ name })),
      guideTexts: { "agent.en.md": "Call `vega_maps_list`, then vega_map_get. Export with `haven_files_export`." },
    });
    expect(result).toEqual({ errors: [], warnings: ['The tool "get_context" belongs to no capability.'] });
    expect(
      checkAgentManifest({ definition: definition(), tools: TOOLS, internalTools: ["get_context"] }).warnings,
    ).toEqual([]);
  });

  it("reports capability tools the app does not register", () => {
    const result = checkAgentManifest({
      definition: definition({
        capabilities: [{ id: "maps", title: { en: "Maps", de: "Maps" }, tools: ["maps_list", "vega_map_get"] }],
      }),
      tools: TOOLS,
    });
    expect(result.errors).toEqual([
      'Capability "maps" names the tool "vega_map_get", which the app does not register. Name it without the prefix.',
    ]);
  });

  it("finds missing tools in guide texts but not field names or placeholders", () => {
    const result = checkAgentManifest({
      definition: definition(),
      tools: TOOLS,
      guideTexts: [
        "Use `vega_nodes_remove` or vega_map_delete. The `node_id` field, `vega_*` and vega_<name> are fine.",
        "Then `nodes_remove` and `maps_list` and `ops_guide`.",
      ],
    });
    expect(result.errors).toEqual([
      "guide text #0 names `vega_nodes_remove`, which the app does not register.",
      "guide text #0 names `vega_map_delete`, which the app does not register.",
      "guide text #1 names `nodes_remove`, which looks like a tool but the app does not register it.",
    ]);
    expect(
      checkAgentManifest({
        definition: definition(),
        tools: TOOLS,
        guideTexts: ["`nodes_remove` and vega_map_delete"],
        ignore: ["nodes_remove", "map_delete"],
      }).errors,
    ).toEqual([]);
  });

  it("reports locales that differ between summary, titles and examples", () => {
    const result = checkAgentManifest({
      definition: definition({
        capabilities: [{ id: "maps", title: { en: "Maps" }, tools: TOOLS }],
        examples: { en: ["Plan a launch"], de: ["Plane einen Launch"], fr: ["Planifie"] },
      }),
      tools: TOOLS,
    });
    expect(result.errors).toEqual([
      'The agent capability "maps" title has the locales en, the summary de,en.',
      "The agent examples has the locales de,en,fr, the summary de,en.",
    ]);
  });

  it("reports a missing or too long summary through the definition's validation", () => {
    expect(checkAgentManifest({ definition: definition({ summary: undefined }), tools: TOOLS }).errors).toEqual([
      'App definition agent.summary must be an object of per-locale strings with an "en" entry.',
    ]);
    expect(
      checkAgentManifest({ definition: definition({ summary: { en: "x".repeat(401) } }), tools: TOOLS }).errors,
    ).toEqual(["App definition agent.summary.en must not be longer than 400 characters."]);
    const { agent: _agent, ...withoutAgent } = definition();
    expect(checkAgentManifest({ definition: withoutAgent, tools: TOOLS }).errors).toEqual([
      "haven-app.json has no agent block.",
    ]);
  });

  it("assertAgentManifest throws with every error", () => {
    expect(() =>
      assertAgentManifest({ definition: definition(), tools: ["maps_list"], guideTexts: ["`vega_gone`"] }),
    ).toThrow(/map_get[\s\S]*vega_gone/);
    expect(assertAgentManifest({ definition: definition(), tools: TOOLS, internalTools: ["get_context"] })).toEqual([]);
  });
});
