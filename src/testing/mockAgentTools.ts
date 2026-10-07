/**
 * Haven's side of agent tools, for tests: what `session.agent` talks to.
 *
 * It accepts the app's tool declarations and context with Haven's validation, keeps
 * the files the app hands over (`provideFile`), lets a test hand the app files the way
 * Haven imports them from the exchange folder (`takeFile`), and calls the app's tools
 * over the bridge port like Haven's broker, including the consent step for tools
 * marked `consequentialHint`.
 */
import type {
  MindooDBAppAgentRegistration,
  MindooDBAppAgentToolDescriptor,
  MindooDBAppAgentToolErrorCode,
  MindooDBAppBridgeAgentInvokeMessage,
  MindooDBAppBridgeAgentResultMessage,
} from "../types";

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;
const PREFIX_PATTERN = /^[a-z][a-z0-9_]{0,15}$/;
export const MOCK_AGENT_MAX_TOOLS = 64;
export const MOCK_AGENT_MAX_DESCRIPTION = 2000;
export const MOCK_AGENT_FILE_TTL_MS = 10 * 60 * 1000;
export const MOCK_AGENT_FILE_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_INVOKE_TIMEOUT_MS = 120_000;

/** A file in the mock exchange: handed over by the app, or imported for it by the test. */
export interface MockAgentFile {
  fileRef: string;
  name: string;
  mimeType: string;
  data: Uint8Array;
  /** `app`: the app produced it (`provideFile`); `host`: imported for the app (`takeFile`). */
  source: "app" | "host";
  createdAt: number;
  expiresAt: number;
}

/** How Haven's consent dialog answers a call to a consequential tool. */
export type MockAgentConsent = "allow" | "deny" | ((call: { tool: string; input: Record<string, unknown> }) => boolean | Promise<boolean>);

export type MockAgentCallResult =
  | { ok: true; result: unknown; durationMs: number }
  | {
      ok: false;
      error: { code: MindooDBAppAgentToolErrorCode | "LOCKED" | string; message: string; requiredAction?: string };
      durationMs: number;
    };

/** One tool call as the log records it. */
export interface MockAgentCall {
  callId: string;
  tool: string;
  input: Record<string, unknown>;
  startedAt: number;
  outcome?: MockAgentCallResult;
}

export interface MockAgentHostOptions {
  /**
   * The prefix agents see in front of the app's tool names (`agentToolPrefix` in
   * `haven-app.json`). Without one it is derived from the app id, as Haven does.
   */
  agentToolPrefix?: string;
  /** Whether the user has agent access on (`registerTools` answers `enabled`). Default true. */
  agentToolsEnabled?: boolean;
  /** Answer of the consent dialog for consequential tools. Default `"allow"`. */
  agentConsent?: MockAgentConsent;
  /** How long a call waits for the app. Default 120 s, Haven's limit. */
  agentInvokeTimeoutMs?: number;
}

export interface MockAgentHostController {
  /** The app's tools as it declared them (without prefix). */
  tools(): MindooDBAppAgentToolDescriptor[];
  /** The names agents see: `<prefix>_<name>`. */
  exposedNames(): string[];
  readonly prefix: string;
  /** What the app last passed to `setContext`. */
  context(): Record<string, unknown> | null;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  setConsent(consent: MockAgentConsent): void;
  /**
   * Calls one of the app's tools as an agent would, by its own name or the prefixed
   * one. Never throws: failures come back as `{ ok: false, error }` with the code the
   * agent would see.
   */
  call(tool: string, input?: Record<string, unknown>): Promise<MockAgentCallResult>;
  /** Every call so far, oldest first. */
  calls(): ReadonlyArray<MockAgentCall>;
  /** Puts a file in the exchange for the app, as Haven's `haven_files_import`; returns its fileRef. */
  importFile(file: { name: string; mimeType?: string; data: Uint8Array | ArrayBuffer | Blob | string }): Promise<string>;
  /** A file the app handed over (`provideFile`), or `null` when unknown or expired. */
  getFile(fileRef: string): MockAgentFile | null;
  /** Files in the exchange (both directions), newest first. */
  files(): MockAgentFile[];
}

function invalid(message: string): Error {
  return Object.assign(new Error(message), { name: "invalid-params" });
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { name: "not-found" });
}

/** Haven's derivation when the app declares no prefix (`agentAppKey`). */
export function mockAgentToolPrefix(appId: string, declared?: string): string {
  if (declared && PREFIX_PATTERN.test(declared) && !declared.endsWith("_") && !/^haven(?:_|$)/.test(declared)) {
    return declared;
  }
  const key = (appId.split("\\").pop() ?? "")
    .trim()
    .toLowerCase()
    .replace(/^mindoodb-app-/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16)
    .replace(/_+$/, "");
  if (!key) return "app";
  return /^[a-z]/.test(key) ? key : `app_${key}`.slice(0, 16);
}

/** Haven's checks on declared tools (`validateAgentToolDescriptors`). */
export function validateMockAgentTools(raw: unknown): MindooDBAppAgentToolDescriptor[] {
  if (!Array.isArray(raw)) throw invalid("tools must be an array.");
  if (raw.length > MOCK_AGENT_MAX_TOOLS) throw invalid(`An app may offer at most ${MOCK_AGENT_MAX_TOOLS} agent tools.`);
  const seen = new Set<string>();
  return raw.map((entry: unknown) => {
    const tool = entry as Partial<MindooDBAppAgentToolDescriptor> | null;
    if (!tool || typeof tool.name !== "string" || !TOOL_NAME_PATTERN.test(tool.name)) {
      throw invalid(`Invalid agent tool name "${String(tool?.name)}".`);
    }
    if (seen.has(tool.name)) throw invalid(`Agent tool "${tool.name}" is declared twice.`);
    seen.add(tool.name);
    if (typeof tool.description !== "string" || !tool.description.trim()) {
      throw invalid(`Agent tool "${tool.name}" needs a description.`);
    }
    if (tool.description.length > MOCK_AGENT_MAX_DESCRIPTION) {
      throw invalid(`The description of agent tool "${tool.name}" is too long.`);
    }
    const schema = tool.inputSchema as Record<string, unknown> | undefined;
    if (!schema || typeof schema !== "object" || Array.isArray(schema) || schema.type !== "object") {
      throw invalid(`Agent tool "${tool.name}" needs an object inputSchema.`);
    }
    const annotations = tool.annotations ?? {};
    for (const key of ["readOnlyHint", "consequentialHint", "untrustedContentHint"] as const) {
      if (annotations[key] !== undefined && typeof annotations[key] !== "boolean") {
        throw invalid(`Agent tool "${tool.name}" has invalid annotations.`);
      }
    }
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: schema,
      ...(tool.annotations ? { annotations: { ...tool.annotations } } : {}),
    };
  });
}

async function bytesOf(data: Uint8Array | ArrayBuffer | Blob | string): Promise<Uint8Array> {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data.slice();
  if (typeof Blob !== "undefined" && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return new Uint8Array(data as ArrayBuffer);
}

/** Buffers sent across a MessagePort (or from another realm) fail `instanceof`; check structurally. */
function structuralBytes(data: unknown): Uint8Array | null {
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  if (Object.prototype.toString.call(data) === "[object ArrayBuffer]") return new Uint8Array(data as ArrayBuffer).slice();
  return null;
}

export interface MockAgentHost {
  controller: MockAgentHostController;
  /** Answers `agent.*` requests; `undefined` for any other method. */
  dispatch(method: string, params: unknown): Promise<{ result: unknown } | undefined>;
  /** The app's `agent-result` message. */
  handleResult(message: MindooDBAppBridgeAgentResultMessage): void;
  /** Fails pending calls (the app closed or reloaded). */
  reset(reason?: string): void;
}

export function createMockAgentHost(
  options: MockAgentHostOptions & {
    appId: () => string;
    /** Posts to the app's port; `false` when no app is connected. */
    post(message: MindooDBAppBridgeAgentInvokeMessage): boolean;
    onChange?(): void;
  },
): MockAgentHost {
  const prefix = mockAgentToolPrefix(options.appId(), options.agentToolPrefix);
  let tools: MindooDBAppAgentToolDescriptor[] = [];
  let context: Record<string, unknown> | null = null;
  let enabled = options.agentToolsEnabled ?? true;
  let consent: MockAgentConsent = options.agentConsent ?? "allow";
  const timeoutMs = options.agentInvokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
  const files = new Map<string, MockAgentFile>();
  const calls: MockAgentCall[] = [];
  const pending = new Map<string, { resolve(value: MockAgentCallResult): void; startedAt: number; timer: ReturnType<typeof setTimeout> }>();
  let counter = 0;
  const changed = () => options.onChange?.();

  function prune(now = Date.now()) {
    for (const [ref, file] of files) if (file.expiresAt <= now) files.delete(ref);
  }

  function addFile(file: Omit<MockAgentFile, "fileRef" | "createdAt" | "expiresAt">): MockAgentFile {
    prune();
    if (file.data.length > MOCK_AGENT_FILE_MAX_BYTES) {
      throw invalid(`Files for agents may be at most ${MOCK_AGENT_FILE_MAX_BYTES / 1024 / 1024} MB.`);
    }
    const now = Date.now();
    counter += 1;
    const entry: MockAgentFile = {
      ...file,
      fileRef: `file_test${counter.toString(16).padStart(4, "0")}`,
      createdAt: now,
      expiresAt: now + MOCK_AGENT_FILE_TTL_MS,
    };
    files.set(entry.fileRef, entry);
    changed();
    return entry;
  }

  function registration(): MindooDBAppAgentRegistration {
    return { enabled, exposedNames: tools.map((tool) => `${prefix}_${tool.name}`) };
  }

  async function dispatch(method: string, params: unknown): Promise<{ result: unknown } | undefined> {
    const input = (params ?? {}) as Record<string, unknown>;
    if (method === "agent.registerTools") {
      tools = validateMockAgentTools(input.tools);
      changed();
      return { result: registration() };
    }
    if (method === "agent.setContext") {
      const next = input.context ?? null;
      if (next !== null && (typeof next !== "object" || Array.isArray(next))) {
        throw invalid("context must be an object or null.");
      }
      context = next as Record<string, unknown> | null;
      changed();
      return { result: null };
    }
    if (method === "agent.provideFile") {
      if (typeof input.name !== "string" || !input.name.trim()) throw invalid("provideFile needs a file name.");
      const data = structuralBytes(input.data);
      if (!data) throw invalid("provideFile needs the file content as an ArrayBuffer.");
      const mimeType = typeof input.mimeType === "string" && input.mimeType ? input.mimeType : "application/octet-stream";
      const file = addFile({ name: input.name.trim(), mimeType, data, source: "app" });
      return { result: { fileRef: file.fileRef, size: file.data.length } };
    }
    if (method === "agent.takeFile") {
      prune();
      const file = typeof input.fileRef === "string" ? files.get(input.fileRef) : undefined;
      // as in Haven: only files imported for the app, never what it handed over itself
      if (!file || file.source !== "host") throw notFound("Unknown or expired file reference.");
      return { result: { name: file.name, mimeType: file.mimeType, data: file.data.slice().buffer } };
    }
    return undefined;
  }

  function finish(callId: string, outcome: MockAgentCallResult) {
    const call = calls.find((entry) => entry.callId === callId);
    if (call) call.outcome = outcome;
    changed();
    return outcome;
  }

  async function call(name: string, input: Record<string, unknown> = {}): Promise<MockAgentCallResult> {
    counter += 1;
    const callId = `test-call-${counter}`;
    const startedAt = Date.now();
    const toolName = name.startsWith(`${prefix}_`) && !tools.some((t) => t.name === name) ? name.slice(prefix.length + 1) : name;
    calls.push({ callId, tool: toolName, input, startedAt });
    changed();
    const failWith = (code: string, message: string, requiredAction?: string) =>
      finish(callId, {
        ok: false,
        error: { code, message, ...(requiredAction ? { requiredAction } : {}) },
        durationMs: Date.now() - startedAt,
      });
    if (!enabled) return failWith("NOT_ALLOWED", "The user has agent tools switched off for this app.");
    const tool = tools.find((entry) => entry.name === toolName);
    if (!tool) return failWith("NOT_FOUND", `The app offers no tool "${name}".`);
    if (tool.annotations?.consequentialHint) {
      const allowed = typeof consent === "function" ? await consent({ tool: toolName, input }) : consent === "allow";
      if (!allowed) return failWith("NOT_ALLOWED", "The user declined this call.", "ask the user before trying again");
    }
    return await new Promise<MockAgentCallResult>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(callId);
        resolve(failWith("FAILED", `The app did not answer "${toolName}" in time.`));
      }, timeoutMs);
      pending.set(callId, { resolve, startedAt, timer });
      const posted = options.post({ protocol: "mindoodb-app-bridge", kind: "agent-invoke", callId, tool: toolName, input });
      if (!posted) {
        clearTimeout(timer);
        pending.delete(callId);
        resolve(failWith("INVALID_STATE", "The app is not connected."));
      }
    });
  }

  function handleResult(message: MindooDBAppBridgeAgentResultMessage) {
    const entry = pending.get(message.callId);
    if (!entry) return;
    pending.delete(message.callId);
    clearTimeout(entry.timer);
    const durationMs = Date.now() - entry.startedAt;
    entry.resolve(
      finish(
        message.callId,
        message.ok
          ? { ok: true, result: message.result ?? null, durationMs }
          : {
              ok: false,
              error: {
                code: message.error?.code ?? "FAILED",
                message: message.error?.message ?? "The app reported an error.",
                ...(message.error?.requiredAction ? { requiredAction: message.error.requiredAction } : {}),
              },
              durationMs,
            },
      ),
    );
  }

  function reset(reason = "The app was closed.") {
    for (const [callId, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve(
        finish(callId, { ok: false, error: { code: "INVALID_STATE", message: reason }, durationMs: Date.now() - entry.startedAt }),
      );
    }
    pending.clear();
    tools = [];
    context = null;
    changed();
  }

  const controller: MockAgentHostController = {
    prefix,
    tools: () => tools.map((tool) => ({ ...tool })),
    exposedNames: () => registration().exposedNames,
    context: () => context,
    isEnabled: () => enabled,
    setEnabled(next) {
      enabled = next;
      changed();
    },
    setConsent(next) {
      consent = next;
    },
    call,
    calls: () => calls,
    async importFile(file) {
      const data = await bytesOf(file.data);
      const mimeType =
        file.mimeType || (typeof Blob !== "undefined" && file.data instanceof Blob ? file.data.type : "") || "application/octet-stream";
      return addFile({ name: file.name, mimeType, data, source: "host" }).fileRef;
    },
    getFile(fileRef) {
      prune();
      const file = files.get(fileRef);
      return file && file.source === "app" ? file : null;
    },
    files() {
      prune();
      return [...files.values()].sort((a, b) => b.createdAt - a.createdAt);
    },
  };

  return { controller, dispatch, handleResult, reset };
}
