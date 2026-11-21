/**
 * `session.ink` as the mocks play Haven's native app: languages that are
 * installed or have to be downloaded first (with progress), and a recognizer
 * whose answer the test decides.
 *
 * @module mockInk
 */
import type {
  MindooDBAppBridgePortMessage,
  MindooDBAppInkApi,
  MindooDBAppInkCandidate,
  MindooDBAppInkCapabilities,
  MindooDBAppInkLanguageState,
  MindooDBAppInkProgress,
  MindooDBAppInkProgressHandler,
  MindooDBAppInkRecognizeInput,
  MindooDBAppInkRecognizeResult,
} from "../types";

export type MockInkAnswer =
  | string
  | MindooDBAppInkCandidate[]
  | MindooDBAppInkRecognizeResult
  | ((input: MindooDBAppInkRecognizeInput) => string | MindooDBAppInkCandidate[] | MindooDBAppInkRecognizeResult);

export interface MockInkOptions {
  /** `native` (default) or `none` as in a browser. */
  recognize?: "native" | "none";
  /** Language states; languages not listed are `downloadable`. Default: `de-DE` and `en-US` installed. */
  languages?: Record<string, MindooDBAppInkLanguageState>;
  /** The language Haven runs in (default `en-US`). */
  defaultLanguage?: string;
}

export interface MockInkController {
  /** `native` or `none` (then every call answers like a browser Haven). */
  setRecognize(mode: "native" | "none"): void;
  setLanguageState(language: string, state: MindooDBAppInkLanguageState): void;
  /** What `recognize` answers from now on: text, candidates, a full result or a function of the input. */
  answer(answer: MockInkAnswer): void;
  /** Every `recognize` input, oldest first. */
  requests(): MindooDBAppInkRecognizeInput[];
  /** Pushes a progress event to the app as Haven does during a download. */
  emitProgress(progress: MindooDBAppInkProgress): void;
}

export function createMockInk(options: MockInkOptions = {}) {
  let mode: "native" | "none" = options.recognize ?? "native";
  const languages = new Map<string, MindooDBAppInkLanguageState>(
    Object.entries(options.languages ?? { "de-DE": "installed", "en-US": "installed" }),
  );
  const defaultLanguage = options.defaultLanguage ?? "en-US";
  let answer: MockInkAnswer = [{ text: "mock ink" }];
  const requests: MindooDBAppInkRecognizeInput[] = [];
  const handlers = new Set<MindooDBAppInkProgressHandler>();
  let post: ((message: MindooDBAppBridgePortMessage) => boolean) | null = null;

  function stateOf(language: string): MindooDBAppInkLanguageState {
    return languages.get(language) ?? "downloadable";
  }

  function emit(progress: MindooDBAppInkProgress) {
    for (const handler of [...handlers]) handler({ ...progress });
    post?.({ protocol: "mindoodb-app-bridge", kind: "ink-progress", progress: { ...progress } });
  }

  function capabilities(input: { languages?: string[] } = {}): MindooDBAppInkCapabilities {
    if (mode === "none") return { recognize: "none", engines: [], languages: {} };
    const result: Record<string, MindooDBAppInkLanguageState> = {};
    for (const [language, state] of languages) if (state === "installed") result[language] = state;
    for (const language of input.languages ?? []) result[language] = stateOf(language);
    return { recognize: "native", engines: ["mock-ink"], languages: result };
  }

  async function download(language: string): Promise<MindooDBAppInkLanguageState> {
    const state = stateOf(language);
    if (state !== "downloadable" && state !== "downloading") return state;
    languages.set(language, "downloading");
    for (const fraction of [0, 0.5, 1]) {
      emit({ language, phase: "downloading", fraction });
      await Promise.resolve();
    }
    languages.set(language, "installed");
    emit({ language, phase: "installed", fraction: 1 });
    return "installed";
  }

  async function prepare(input: { languages?: string[] } = {}) {
    if (mode === "none") return { status: "unsupported" as const, languages: {} };
    const wanted = input.languages?.length ? input.languages : [defaultLanguage];
    const result: Record<string, MindooDBAppInkLanguageState> = {};
    for (const language of wanted) result[language] = await download(language);
    const ready = Object.values(result).every((state) => state === "installed");
    return ready
      ? { status: "ready" as const, languages: result }
      : { status: "failed" as const, languages: result, reason: "language unavailable" };
  }

  function recognize(input: MindooDBAppInkRecognizeInput): MindooDBAppInkRecognizeResult {
    if (mode === "none") return { status: "unsupported" };
    requests.push(structuredClone(input));
    const language = input.language ?? defaultLanguage;
    const state = stateOf(language);
    if (state === "unavailable") return { status: "failed", language, reason: "language unavailable" };
    if (state !== "installed") {
      void download(language);
      return { status: "model-downloading", language };
    }
    const value = typeof answer === "function" ? answer(input) : answer;
    if (typeof value === "string") return { status: "ok", engine: "mock-ink", language, candidates: [{ text: value }] };
    if (Array.isArray(value)) {
      const max = input.maxCandidates ?? 5;
      return { status: "ok", engine: "mock-ink", language, candidates: value.slice(0, max).map((candidate) => ({ ...candidate })) };
    }
    return value;
  }

  /** Level 1: the mock session's own `session.ink`. */
  const api: MindooDBAppInkApi = {
    async capabilities(input) {
      return capabilities(input);
    },
    async prepare(input = {}) {
      const listener = input.onProgress;
      const wanted = input.languages?.length ? new Set(input.languages) : new Set([defaultLanguage]);
      const relay = listener
        ? (progress: MindooDBAppInkProgress) => {
            if (wanted.has(progress.language)) listener(progress);
          }
        : null;
      if (relay) handlers.add(relay);
      try {
        return await prepare(input);
      } finally {
        if (relay) handlers.delete(relay);
      }
    },
    async recognize(input) {
      return recognize(input);
    },
    onProgress(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };

  /** Level 2: the fake host's `ink.*` requests; `send` reaches the app's port. */
  async function dispatch(method: string, params: unknown, send: (message: MindooDBAppBridgePortMessage) => boolean) {
    const input = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case "ink.capabilities":
        return { result: capabilities(input as { languages?: string[] }) };
      case "ink.prepare":
        post = send;
        return { result: await prepare(input as { languages?: string[] }) };
      case "ink.recognize":
        post = send;
        return { result: recognize(input as unknown as MindooDBAppInkRecognizeInput) };
      default:
        return undefined;
    }
  }

  const controller: MockInkController = {
    setRecognize(next) {
      mode = next;
    },
    setLanguageState(language, state) {
      languages.set(language, state);
    },
    answer(next) {
      answer = next;
    },
    requests: () => requests.map((request) => structuredClone(request)),
    emitProgress: emit,
  };

  return { api, dispatch, controller, reset: () => (post = null) };
}
