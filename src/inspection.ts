/**
 * Checking an embedded component's document before it is saved.
 *
 * A component that declares `supports: ["inspect:<contract>"]` describes its
 * document on request in a shape every host can read without knowing the app:
 * a Word or Markdown document as {@link MindooDBAppDocumentInspection}, a
 * workbook as {@link MindooDBAppSpreadsheetInspection}, a deck as
 * {@link MindooDBAppSlidesInspection}. A host asks for that (`embed.inspect`)
 * or checks it before every save (`embed.onBeforeSave`), answering with
 * {@link MindooDBAppIssue}s. The same checks can run on the small summary each
 * component writes to its root document (`inspection` field), so a host can
 * judge documents it does not have open.
 *
 * Rules that work on both: {@link defineDocumentRules}.
 */
import { MindooDBAppValue, type MindooDBAppAtomicValue } from "./values";

/** Word and Markdown documents. */
export const MINDOODB_INSPECT_DOCUMENT = "mindoo.inspect.document@1";
/** Workbooks. */
export const MINDOODB_INSPECT_SPREADSHEET = "mindoo.inspect.spreadsheet@1";
/** Presentations. */
export const MINDOODB_INSPECT_SLIDES = "mindoo.inspect.slides@1";

/** Root document field holding the summary a component writes on every save. */
export const MINDOODB_APP_INSPECTION_FIELD = "inspection";
/** Upper bound of the root summary, as JSON. */
export const MINDOODB_APP_INSPECTION_SUMMARY_MAX_BYTES = 8 * 1024;
/** Upper bound of a full inspection Haven passes between apps, as JSON. */
export const MINDOODB_APP_INSPECTION_MAX_BYTES = 256 * 1024;
/** At most this many issues per check. */
export const MINDOODB_APP_ISSUES_MAX = 100;

/**
 * A place in the component's document, for `embed.reveal` and issues: a heading
 * (its id from the outline), a cell (`Sheet1!B3`, or `B3` on the first sheet) or
 * a slide (0-based).
 */
export type MindooDBAppInspectAnchor =
  | { kind: "heading"; id: string }
  | { kind: "cell"; ref: string }
  | { kind: "slide"; index: number };

export type MindooDBAppIssueSeverity = "error" | "warning" | "info";

/**
 * A finding about the document. Before a save, `error` stops it, `warning` asks
 * the user whether to save anyway, `info` is only shown.
 */
export interface MindooDBAppIssue {
  severity: MindooDBAppIssueSeverity;
  /** For the user, in their language. At most 500 characters. */
  message: string;
  /** Where in the document, so the component can show it (`embed.reveal`). */
  anchor?: MindooDBAppInspectAnchor;
  /** Stable id of the rule, e.g. `open-placeholders`. */
  code?: string;
}

/** What a host asks a component to describe (`embed.inspect`, `onBeforeSave`). */
export interface MindooDBAppInspectRequest {
  /** One of the component's `inspect:` contracts. Default: its first one. */
  contract?: string;
  /**
   * Optional parts: `text` (plain text of a document, see `maxTextLength`). Other
   * parts of the contracts are always there.
   */
  include?: string[];
  /** Spreadsheets: cells whose values to return, `Sheet1!B3` or `B3` (first sheet). At most 200. */
  cells?: string[];
  /** With `include: ["text"]`: at most this many characters (default 4000, max 50000). */
  maxTextLength?: number;
}

/** What every inspection carries. */
export interface MindooDBAppInspectionBase {
  contract: string;
  /** Title of the document (the root's `subject`). */
  subject?: string;
  /** Set when lists or text were shortened, e.g. in the root summary. */
  truncated?: boolean;
}

/** `mindoo.inspect.document@1`: a Word or Markdown document. */
export interface MindooDBAppDocumentInspection extends MindooDBAppInspectionBase {
  contract: typeof MINDOODB_INSPECT_DOCUMENT;
  /** Plain text, shortened to `maxTextLength`; only with `include: ["text"]`. */
  text?: string;
  /** Headings in document order. */
  outline: Array<{ level: number; text: string; anchor: { kind: "heading"; id: string } }>;
  /** Placeholders and Word MERGEFIELDs that were not filled in yet. */
  placeholders: Array<{ name: string; kind: "placeholder" | "mergefield"; anchor?: MindooDBAppInspectAnchor }>;
  /** Comments that are not resolved. */
  openComments: number;
  /** Tracked changes that were neither accepted nor rejected. */
  openTrackedChanges: number;
  wordCount: number;
}

/** A cell value as `mindoo.inspect.spreadsheet@1` reports it. */
export interface MindooDBAppInspectedCell {
  value: string | number | boolean | null;
  formula?: string;
  /** Formula error such as `#REF!` or `#DIV/0!`. */
  error?: string;
}

/** `mindoo.inspect.spreadsheet@1`: a workbook. */
export interface MindooDBAppSpreadsheetInspection extends MindooDBAppInspectionBase {
  contract: typeof MINDOODB_INSPECT_SPREADSHEET;
  sheets: Array<{ name: string; rows?: number; columns?: number }>;
  namedRanges: Array<{ name: string; ref: string }>;
  /** The requested `cells`, keyed by the ref as requested. */
  cells?: Record<string, MindooDBAppInspectedCell>;
  /** Cells whose formula evaluates to an error. */
  formulaErrors: Array<{ ref: string; error: string; formula?: string }>;
}

/** `mindoo.inspect.slides@1`: a presentation. */
export interface MindooDBAppSlidesInspection extends MindooDBAppInspectionBase {
  contract: typeof MINDOODB_INSPECT_SLIDES;
  slideCount: number;
  slides: Array<{ index: number; title?: string }>;
  /** Layout placeholders nobody filled, e.g. an empty title. */
  emptyPlaceholders: Array<{ slide: number; placeholder: string; anchor: { kind: "slide"; index: number } }>;
}

export type MindooDBAppInspection =
  | MindooDBAppDocumentInspection
  | MindooDBAppSpreadsheetInspection
  | MindooDBAppSlidesInspection;

/** What a component passes to `session.embedding.complete`. */
export interface MindooDBAppEmbeddingResult {
  /** Title of the document after the edit. */
  subject: string;
  /** One or two sentences for the host to show. */
  summary?: string;
  /** Small preview, a `data:image/png` or `data:image/jpeg` URL (the whole result stays below 64 KiB). */
  thumbnail?: string;
  /** Counts such as words, sheets or slides. */
  stats?: Record<string, number>;
}

/** The outcome of `session.embedding.validate`. */
export interface MindooDBAppEmbedValidation {
  /** False: do not save (an error, or the user did not confirm a warning). */
  ok: boolean;
  issues: MindooDBAppIssue[];
  /** The host did not answer in time; Haven let the save go ahead. */
  timedOut?: boolean;
}

/** Thrown by `session.embedding.save` when the host's checks stopped the save. */
export class MindooDBAppEmbedValidationError extends Error {
  constructor(readonly issues: MindooDBAppIssue[]) {
    const first = issues.find((issue) => issue.severity === "error") ?? issues[0];
    super(first ? first.message : "The document was not saved.");
    this.name = "MindooDBAppEmbedValidationError";
  }
}

const SUPPORTS_CAPABILITY = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * Whether a component's `supports` list covers `requirement`: `inspect` is met by
 * any `inspect:…` entry, `inspect:mindoo.inspect.document@1` only by that one.
 */
export function mindooDBAppComponentSupports(supports: readonly string[] | undefined, requirement: string): boolean {
  const wanted = requirement.trim();
  return (supports ?? []).some((entry) => entry === wanted || (!wanted.includes(":") && entry.startsWith(`${wanted}:`)));
}

/** The contracts of a component's `inspect:` entries, in declared order. */
export function mindooDBAppInspectContracts(supports: readonly string[] | undefined): string[] {
  return (supports ?? []).filter((entry) => entry.startsWith("inspect:")).map((entry) => entry.slice("inspect:".length));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A valid anchor, or undefined. */
export function normalizeMindooDBAppInspectAnchor(raw: unknown): MindooDBAppInspectAnchor | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  if (raw.kind === "heading" && typeof raw.id === "string" && raw.id && raw.id.length <= 200) {
    return { kind: "heading", id: raw.id };
  }
  if (raw.kind === "cell" && typeof raw.ref === "string" && raw.ref && raw.ref.length <= 200) {
    return { kind: "cell", ref: raw.ref };
  }
  if (raw.kind === "slide" && Number.isInteger(raw.index) && (raw.index as number) >= 0) {
    return { kind: "slide", index: raw.index as number };
  }
  return undefined;
}

/**
 * Issues as they may cross between apps: known severities, messages and codes
 * shortened, invalid anchors dropped, at most {@link MINDOODB_APP_ISSUES_MAX}.
 * Anything that is not an issue is left out.
 */
export function normalizeMindooDBAppIssues(raw: unknown): MindooDBAppIssue[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const issues: MindooDBAppIssue[] = [];
  for (const entry of raw) {
    if (issues.length >= MINDOODB_APP_ISSUES_MAX) {
      break;
    }
    if (!isPlainObject(entry) || typeof entry.message !== "string" || !entry.message.trim()) {
      continue;
    }
    const severity = entry.severity === "warning" || entry.severity === "info" ? entry.severity : entry.severity === "error" ? "error" : null;
    if (!severity) {
      continue;
    }
    const anchor = normalizeMindooDBAppInspectAnchor(entry.anchor);
    const code = typeof entry.code === "string" && entry.code.trim() ? entry.code.trim().slice(0, 64) : undefined;
    issues.push({
      severity,
      message: entry.message.trim().slice(0, 500),
      ...(anchor ? { anchor } : {}),
      ...(code ? { code } : {}),
    });
  }
  return issues;
}

/** An inspect request as it may cross between apps. */
export function normalizeMindooDBAppInspectRequest(raw: unknown): MindooDBAppInspectRequest {
  const input = isPlainObject(raw) ? raw : {};
  const strings = (value: unknown, max: number) =>
    Array.isArray(value)
      ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && !!entry && entry.length <= 200))].slice(0, max)
      : [];
  const include = strings(input.include, 16);
  const cells = strings(input.cells, 200);
  const maxTextLength = Number(input.maxTextLength);
  return {
    ...(typeof input.contract === "string" && input.contract ? { contract: input.contract.slice(0, 200) } : {}),
    ...(include.length ? { include } : {}),
    ...(cells.length ? { cells } : {}),
    ...(Number.isFinite(maxTextLength) && maxTextLength > 0 ? { maxTextLength: Math.min(Math.floor(maxTextLength), 50_000) } : {}),
  };
}

/**
 * An inspection as it may cross between apps: plain JSON with a `contract`, at
 * most {@link MINDOODB_APP_INSPECTION_MAX_BYTES}. Throws otherwise.
 */
export function normalizeMindooDBAppInspection(raw: unknown): MindooDBAppInspectionBase & Record<string, unknown> {
  let json: string;
  try {
    json = JSON.stringify(raw);
  } catch {
    throw new Error("An inspection must be plain JSON.");
  }
  if (!json || json.length > MINDOODB_APP_INSPECTION_MAX_BYTES) {
    throw new Error(`An inspection must not be larger than ${MINDOODB_APP_INSPECTION_MAX_BYTES / 1024} KiB.`);
  }
  const value = JSON.parse(json) as unknown;
  if (!isPlainObject(value) || typeof value.contract !== "string" || !value.contract) {
    throw new Error("An inspection must be an object with a contract.");
  }
  return value as MindooDBAppInspectionBase & Record<string, unknown>;
}

const SUMMARY_TEXT_STEPS = [500, 200, 0];
const SUMMARY_LIST_STEPS = [50, 20, 5, 0];

function shorten(value: unknown, textMax: number, listMax: number, marks: { truncated: boolean }): unknown {
  if (typeof value === "string") {
    if (value.length <= textMax) return value;
    marks.truncated = true;
    return value.slice(0, textMax);
  }
  if (Array.isArray(value)) {
    if (value.length > listMax) marks.truncated = true;
    return value.slice(0, listMax).map((entry) => shorten(entry, Math.min(textMax || 80, 80), listMax, marks));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shorten(entry, textMax, listMax, marks)]));
  }
  return value;
}

/**
 * The small summary of an inspection a component keeps on its root document:
 * no requested cells, text and lists shortened (`truncated: true` then) until it
 * fits {@link MINDOODB_APP_INSPECTION_SUMMARY_MAX_BYTES}. Counts stay exact, so
 * rules like "no open placeholders" give the same answer on it.
 */
export function summarizeMindooDBAppInspection<T extends MindooDBAppInspectionBase>(
  inspection: T,
  maxBytes = MINDOODB_APP_INSPECTION_SUMMARY_MAX_BYTES,
): T {
  const { cells: _cells, ...rest } = inspection as T & { cells?: unknown };
  const base = JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
  for (const textMax of SUMMARY_TEXT_STEPS) {
    for (const listMax of SUMMARY_LIST_STEPS) {
      const marks = { truncated: false };
      const next = shorten(base, textMax, listMax, marks) as Record<string, unknown>;
      // Strings that went down to nothing say less than leaving them out.
      if (textMax === 0 && typeof next.text === "string") delete next.text;
      next.contract = inspection.contract;
      if (typeof inspection.subject === "string") next.subject = inspection.subject.slice(0, 200);
      if (marks.truncated || inspection.truncated) next.truncated = true;
      if (JSON.stringify(next).length <= maxBytes) {
        return next as T;
      }
    }
  }
  return { contract: inspection.contract, truncated: true } as T;
}

/**
 * The summary as a value to write to the root (`set: { inspection: … }`): one
 * atomic string of JSON, so concurrent saves replace it instead of merging text.
 */
export function mindooDBAppInspectionSummaryValue(inspection: MindooDBAppInspectionBase): MindooDBAppAtomicValue {
  return MindooDBAppValue.atomic(JSON.stringify(summarizeMindooDBAppInspection(inspection)));
}

/** The summary a component wrote to this root document, or null. */
export function readMindooDBAppInspectionSummary<T extends MindooDBAppInspectionBase = MindooDBAppInspection>(
  root: Readonly<Record<string, unknown>> | null | undefined,
): T | null {
  let value = root?.[MINDOODB_APP_INSPECTION_FIELD];
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return isPlainObject(value) && typeof value.contract === "string" ? (value as unknown as T) : null;
}

/** What a rule's `check` may return: a message, issues, or nothing for "fine". */
export type MindooDBAppDocumentRuleOutcome =
  | string
  | MindooDBAppIssue
  | MindooDBAppIssue[]
  | null
  | undefined
  | false;

/** One check on an inspection. */
export interface MindooDBAppDocumentRule<T extends MindooDBAppInspectionBase = MindooDBAppInspection> {
  /** Stable id; becomes the issue's `code`. */
  code: string;
  /** For a message returned as a string. Default `error`. */
  severity?: MindooDBAppIssueSeverity;
  check(inspection: T): MindooDBAppDocumentRuleOutcome;
}

/** What {@link defineDocumentRules} returns. */
export interface MindooDBAppDocumentRules {
  /** What to ask the component for (`embed.onBeforeSave(handler, { inspect: rules.request })`). */
  readonly request: MindooDBAppInspectRequest;
  /** Issues of a full inspection; none for an inspection of another contract. */
  check(inspection: MindooDBAppInspectionBase | null | undefined): MindooDBAppIssue[];
  /** The same rules on a root document's summary (`inspection` field); none without one. */
  checkRoot(root: Readonly<Record<string, unknown>> | null | undefined): MindooDBAppIssue[];
  /** A ready `embed.onBeforeSave` handler. */
  beforeSave(input: { inspection: MindooDBAppInspectionBase | null }): { issues: MindooDBAppIssue[] };
  /** Checks every save of this embed; returns the function that stops it. */
  attach(embed: {
    onBeforeSave(
      handler: (input: { inspection: MindooDBAppInspectionBase | null }) => { issues: MindooDBAppIssue[] },
      options?: { inspect?: MindooDBAppInspectRequest },
    ): () => void;
  }): () => void;
}

function outcomeIssues(rule: { code: string; severity?: MindooDBAppIssueSeverity }, outcome: MindooDBAppDocumentRuleOutcome) {
  if (!outcome) return [];
  if (typeof outcome === "string") {
    return [{ severity: rule.severity ?? "error", message: outcome, code: rule.code }] as MindooDBAppIssue[];
  }
  return (Array.isArray(outcome) ? outcome : [outcome]).map((issue) => ({ code: rule.code, ...issue }));
}

/**
 * Rules a host applies to a component's document, before a save (on the full
 * inspection) and when reading (on the root's summary):
 *
 * ```ts
 * const rules = defineDocumentRules<MindooDBAppDocumentInspection>({
 *   contract: MINDOODB_INSPECT_DOCUMENT,
 *   rules: [mindooDBAppInspectRules.noOpenPlaceholders(), mindooDBAppInspectRules.noOpenTrackedChanges("warning")],
 * });
 * rules.attach(embed);
 * const issues = rules.checkRoot(document.data);
 * ```
 *
 * The summary is shortened, so rules that look at text or long lists may see
 * less on it than on the full inspection; counts are always exact.
 */
export function defineDocumentRules<T extends MindooDBAppInspectionBase = MindooDBAppInspection>(definition: {
  /** Only inspections of this contract are checked. */
  contract?: string;
  include?: string[];
  cells?: string[];
  maxTextLength?: number;
  rules: Array<MindooDBAppDocumentRule<T>>;
}): MindooDBAppDocumentRules {
  const request = normalizeMindooDBAppInspectRequest(definition);
  function check(inspection: MindooDBAppInspectionBase | null | undefined) {
    if (!inspection || (definition.contract && inspection.contract !== definition.contract)) {
      return [];
    }
    const issues = definition.rules.flatMap((rule) => {
      try {
        return outcomeIssues(rule, rule.check(inspection as T));
      } catch (error) {
        return [
          {
            severity: "warning" as const,
            code: rule.code,
            message: `Check "${rule.code}" failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ];
      }
    });
    return normalizeMindooDBAppIssues(issues);
  }
  const rules: MindooDBAppDocumentRules = {
    request,
    check,
    checkRoot: (root) => check(readMindooDBAppInspectionSummary(root)),
    beforeSave: ({ inspection }) => ({ issues: check(inspection) }),
    attach: (embed) => embed.onBeforeSave(rules.beforeSave, { inspect: request }),
  };
  return rules;
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Common rules for {@link defineDocumentRules}; pass `message` to word them yourself. */
export const mindooDBAppInspectRules = {
  /** Documents: no placeholder or MERGEFIELD left open. */
  noOpenPlaceholders(
    severity: MindooDBAppIssueSeverity = "error",
    message?: (names: string[]) => string,
  ): MindooDBAppDocumentRule<MindooDBAppDocumentInspection> {
    return {
      code: "open-placeholders",
      severity,
      check: (inspection) => {
        const names = (inspection.placeholders ?? []).map((entry) => entry.name);
        if (!names.length) return null;
        return message?.(names) ?? `${plural(names.length, "placeholder is", "placeholders are")} not filled in: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ", …" : ""}`;
      },
    };
  },
  /** Documents: every comment resolved. */
  noOpenComments(
    severity: MindooDBAppIssueSeverity = "warning",
    message?: (count: number) => string,
  ): MindooDBAppDocumentRule<MindooDBAppDocumentInspection> {
    return {
      code: "open-comments",
      severity,
      check: (inspection) =>
        inspection.openComments > 0 ? (message?.(inspection.openComments) ?? `${plural(inspection.openComments, "comment is", "comments are")} not resolved.`) : null,
    };
  },
  /** Documents: every tracked change accepted or rejected. */
  noOpenTrackedChanges(
    severity: MindooDBAppIssueSeverity = "warning",
    message?: (count: number) => string,
  ): MindooDBAppDocumentRule<MindooDBAppDocumentInspection> {
    return {
      code: "open-tracked-changes",
      severity,
      check: (inspection) =>
        inspection.openTrackedChanges > 0
          ? (message?.(inspection.openTrackedChanges) ?? `${plural(inspection.openTrackedChanges, "tracked change is", "tracked changes are")} not accepted or rejected.`)
          : null,
    };
  },
  /** Spreadsheets: no formula evaluates to an error; one issue per cell. */
  noFormulaErrors(severity: MindooDBAppIssueSeverity = "error"): MindooDBAppDocumentRule<MindooDBAppSpreadsheetInspection> {
    return {
      code: "formula-errors",
      severity,
      check: (inspection) =>
        (inspection.formulaErrors ?? []).map((entry) => ({
          severity,
          message: `${entry.ref}: ${entry.error}`,
          anchor: { kind: "cell" as const, ref: entry.ref },
        })),
    };
  },
  /** Presentations: no layout placeholder left empty; one issue per slide. */
  noEmptySlidePlaceholders(
    severity: MindooDBAppIssueSeverity = "warning",
  ): MindooDBAppDocumentRule<MindooDBAppSlidesInspection> {
    return {
      code: "empty-placeholders",
      severity,
      check: (inspection) => {
        const bySlide = new Map<number, string[]>();
        for (const entry of inspection.emptyPlaceholders ?? []) {
          bySlide.set(entry.slide, [...(bySlide.get(entry.slide) ?? []), entry.placeholder]);
        }
        return [...bySlide.entries()].map(([slide, names]) => ({
          severity,
          message: `Slide ${slide + 1}: empty ${names.join(", ")}`,
          anchor: { kind: "slide" as const, index: slide },
        }));
      },
    };
  },
};

/** For manifest validation: `validate`, `inspect:mindoo.inspect.document@1`, … */
/** The part after `:` that is not a contract, e.g. `pdf` in `export:pdf`. */
const SUPPORTS_ARGUMENT = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * For manifest validation: `validate`, `inspect:mindoo.inspect.document@1`,
 * `export:pdf`, … (a capability, optionally a contract or a plain argument).
 */
export function isMindooDBAppSupportsEntry(entry: string, contractPattern: RegExp): boolean {
  const [capability, argument, ...rest] = entry.split(":");
  if (rest.length || !capability || !SUPPORTS_CAPABILITY.test(capability)) {
    return false;
  }
  return argument === undefined || contractPattern.test(argument) || SUPPORTS_ARGUMENT.test(argument);
}

/**
 * `session.embedding.save` without the transport: validate, show what stopped it,
 * else flush with the root summary. Shared by the bridge client and the mock host.
 */
export async function performMindooDBAppEmbeddingSave(steps: {
  validate: () => Promise<MindooDBAppEmbedValidation>;
  provider: ((request: MindooDBAppInspectRequest) => MindooDBAppInspectionBase | Promise<MindooDBAppInspectionBase>) | null;
  showIssues: ((issues: MindooDBAppIssue[]) => void | Promise<void>) | null;
  flush: (context: { inspection: MindooDBAppAtomicValue | null; issues: MindooDBAppIssue[] }) => void | Promise<void>;
  saved: () => void | Promise<void>;
}): Promise<MindooDBAppEmbedValidation> {
  const validation = await steps.validate();
  if (!validation.ok) {
    if (validation.issues.length && steps.showIssues) {
      try {
        await steps.showIssues(validation.issues);
      } catch (error) {
        console.warn("[mindoodb-app-sdk] Showing issues failed.", error);
      }
    }
    throw new MindooDBAppEmbedValidationError(validation.issues);
  }
  let inspection: MindooDBAppAtomicValue | null = null;
  if (steps.provider) {
    try {
      inspection = mindooDBAppInspectionSummaryValue(normalizeMindooDBAppInspection(await steps.provider({})));
    } catch (error) {
      // A summary is a convenience for readers; never a reason not to save.
      console.warn("[mindoodb-app-sdk] Could not summarize the document.", error);
    }
  }
  await steps.flush({ inspection, issues: validation.issues });
  await steps.saved();
  return validation;
}

/**
 * How Haven turns a host's answer into the component's `validate` result: an error
 * stops the save, warnings stop it unless the user confirms (`confirm`), or
 * nothing asks (`interactive: false`).
 */
export async function resolveMindooDBAppEmbedValidation(
  issues: MindooDBAppIssue[],
  interactive: boolean,
  confirm: (warnings: MindooDBAppIssue[]) => boolean | Promise<boolean>,
): Promise<MindooDBAppEmbedValidation> {
  if (issues.some((issue) => issue.severity === "error")) {
    return { ok: false, issues };
  }
  const warnings = issues.filter((issue) => issue.severity === "warning");
  if (!warnings.length || !interactive) {
    return { ok: true, issues };
  }
  return { ok: (await confirm(warnings)) === true, issues };
}
