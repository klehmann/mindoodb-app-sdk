/**
 * Checks an app's agent profile (`agent` in haven-app.json) against the tools it really
 * registers, for a unit test: every tool a capability names must exist, every tool
 * should belong to a capability, and the how-to texts must not name tools that are
 * gone.
 */
import {
  validateMindooDBAppDefinition,
  type MindooDBAppDefinition,
  type MindooDBAppLocaleMap,
} from "../appDefinition";
import { mockAgentToolPrefix } from "./mockAgentTools";

export interface AgentManifestCheckOptions {
  /** haven-app.json as parsed JSON, or an already validated definition. */
  definition: unknown;
  /**
   * The prefix agents see. Defaults to the definition's `agentToolPrefix`, else the
   * prefix Haven derives from the app id.
   */
  toolPrefix?: string;
  /** The tools the app registers: names as in `registerTools`, or the tool objects. */
  tools: ReadonlyArray<string | { name: string }>;
  /**
   * Texts agents read that name tools: agent.md files, the ops_guide output, tool
   * descriptions. An object names each text in the messages.
   */
  guideTexts?: Record<string, string> | readonly string[];
  /** Registered tools that need no capability (no warning when none lists them). */
  internalTools?: readonly string[];
  /** Names in guide texts that look like tools but are not, e.g. an op called `node_add`. */
  ignore?: readonly string[];
}

export interface AgentManifestCheckResult {
  errors: string[];
  warnings: string[];
}

function localeKeys(map: MindooDBAppLocaleMap<unknown> | undefined): string {
  return map ? Object.keys(map).sort().join(",") : "";
}

function findGuideProblems(
  name: string,
  text: string,
  prefix: string,
  registered: ReadonlySet<string>,
  ignore: ReadonlySet<string>,
): string[] {
  const problems = new Set<string>();
  // Prefixed names are unambiguous wherever they stand: `vega_nodes_add`, vega_nodes_add.
  // `vega_*` and `vega_<name>` are placeholders, not names.
  const prefixed = new RegExp(`(?<![A-Za-z0-9_])${prefix}_([a-z0-9_]+)(?![A-Za-z0-9_*<])`, "g");
  for (const match of text.matchAll(prefixed)) {
    const full = match[0];
    const bare = match[1]!.replace(/_+$/, "");
    if (!bare || ignore.has(full) || ignore.has(bare) || registered.has(bare)) continue;
    problems.add(`${name} names \`${full}\`, which the app does not register.`);
  }
  // Without the prefix, only a code span that is just a name shaped like the app's own
  // tools (same first word, e.g. `nodes_remove` next to `nodes_add`) counts, so field
  // names such as `node_id` in a table do not.
  const families = new Set([...registered].filter((tool) => tool.includes("_")).map((tool) => tool.split("_")[0]!));
  for (const match of text.matchAll(/`([a-z][a-z0-9]*_[a-z0-9_]*[a-z0-9])(?:\(\))?`/g)) {
    const bare = match[1]!;
    if (bare.startsWith("haven_") || bare.startsWith(`${prefix}_`)) continue;
    if (registered.has(bare) || ignore.has(bare) || !families.has(bare.split("_")[0]!)) continue;
    problems.add(`${name} names \`${bare}\`, which looks like a tool but the app does not register it.`);
  }
  return [...problems];
}

/**
 * Compares the agent profile with the registered tools and the guide texts. Errors: a
 * capability names a tool that is not registered, a guide text names a missing tool,
 * the summary is missing or too long, the locales of summary, titles and examples
 * differ. Warning: a registered tool belongs to no capability.
 */
export function checkAgentManifest(options: AgentManifestCheckOptions): AgentManifestCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const validation = validateMindooDBAppDefinition(options.definition);
  errors.push(...validation.errors);
  const definition: MindooDBAppDefinition | null = validation.definition;
  if (!definition) {
    return { errors, warnings };
  }
  const agent = definition.agent;
  if (!agent) {
    errors.push("haven-app.json has no agent block.");
    return { errors, warnings };
  }
  const prefix = options.toolPrefix ?? mockAgentToolPrefix(definition.appId, definition.agentToolPrefix);
  const registered = new Set(options.tools.map((tool) => (typeof tool === "string" ? tool : tool.name)));
  const ignore = new Set(options.ignore ?? []);

  const covered = new Set<string>();
  for (const capability of agent.capabilities) {
    for (const tool of capability.tools) {
      covered.add(tool);
      if (!registered.has(tool)) {
        const hint = tool.startsWith(`${prefix}_`) ? " Name it without the prefix." : "";
        errors.push(`Capability "${capability.id}" names the tool "${tool}", which the app does not register.${hint}`);
      }
    }
  }
  const internal = new Set(options.internalTools ?? []);
  for (const tool of registered) {
    if (!covered.has(tool) && !internal.has(tool)) {
      warnings.push(`The tool "${tool}" belongs to no capability.`);
    }
  }

  const summaryLocales = localeKeys(agent.summary);
  const mismatched = [
    ...agent.capabilities.map((capability) => [`capability "${capability.id}" title`, localeKeys(capability.title)] as const),
    ...(agent.examples ? [["examples", localeKeys(agent.examples)] as const] : []),
  ].filter(([, locales]) => locales !== summaryLocales);
  for (const [what, locales] of mismatched) {
    errors.push(`The agent ${what} has the locales ${locales || "(none)"}, the summary ${summaryLocales}.`);
  }

  const texts = Array.isArray(options.guideTexts)
    ? options.guideTexts.map((text, index) => [`guide text #${index}`, text] as const)
    : Object.entries((options.guideTexts ?? {}) as Record<string, string>);
  for (const [name, text] of texts) {
    errors.push(...findGuideProblems(name, text, prefix, registered, ignore));
  }
  return { errors, warnings };
}

/** {@link checkAgentManifest} for a test: throws with every error; returns the warnings. */
export function assertAgentManifest(options: AgentManifestCheckOptions): string[] {
  const { errors, warnings } = checkAgentManifest(options);
  if (errors.length) {
    throw new Error(`The agent profile does not match the app's tools:\n- ${errors.join("\n- ")}`);
  }
  return warnings;
}
