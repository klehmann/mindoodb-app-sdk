import type {
  MindooDBAppBridgeInkProgressMessage,
  MindooDBAppBridgePortMessage,
  MindooDBAppInkApi,
  MindooDBAppInkCapabilities,
  MindooDBAppInkPoint,
  MindooDBAppInkPrepareInput,
  MindooDBAppInkPrepareResult,
  MindooDBAppInkProgress,
  MindooDBAppInkProgressHandler,
  MindooDBAppInkRecognizeInput,
  MindooDBAppInkRecognizeResult,
} from "../types";
import type { PortRpcClient } from "./portRpcClient";

function isInkProgressMessage(message: MindooDBAppBridgePortMessage): message is MindooDBAppBridgeInkProgressMessage {
  return message.kind === "ink-progress";
}

function isUnknownMethod(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "method-not-found" || code === "unsupported";
}

const NO_RECOGNITION: MindooDBAppInkCapabilities = { recognize: "none", engines: [], languages: {} };

/** Points as plain numbers (drops extra properties of pointer-event objects, rounds to 0.01 px). */
function cleanStrokes(strokes: readonly (readonly MindooDBAppInkPoint[])[]): MindooDBAppInkPoint[][] {
  return strokes
    .map((stroke) =>
      stroke
        .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
        .map((point) => {
          const clean: MindooDBAppInkPoint = { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 };
          if (Number.isFinite(point.t)) clean.t = Math.round(point.t!);
          if (Number.isFinite(point.pressure)) clean.pressure = point.pressure;
          return clean;
        }),
    )
    .filter((stroke) => stroke.length > 0);
}

/**
 * `session.ink`. Older Havens and hosts without recognition answer
 * `unsupported` / `none` instead of throwing.
 */
export class MindooDBAppInkApiImpl implements MindooDBAppInkApi {
  private readonly handlers = new Set<MindooDBAppInkProgressHandler>();
  private readonly stopListening: () => void;

  constructor(private readonly rpc: PortRpcClient) {
    this.stopListening = this.rpc.addMessageListener((message) => {
      if (!isInkProgressMessage(message)) return;
      for (const handler of [...this.handlers]) {
        try {
          handler({ ...message.progress });
        } catch (error) {
          console.warn("[mindoodb-app-sdk] An ink progress handler failed.", error);
        }
      }
    });
  }

  async capabilities(input: { languages?: string[] } = {}): Promise<MindooDBAppInkCapabilities> {
    try {
      return await this.rpc.call<MindooDBAppInkCapabilities>("ink.capabilities", {
        ...(input.languages ? { languages: [...input.languages] } : {}),
      });
    } catch (error) {
      if (isUnknownMethod(error)) return { ...NO_RECOGNITION, languages: {} };
      throw error;
    }
  }

  async prepare(input: MindooDBAppInkPrepareInput = {}): Promise<MindooDBAppInkPrepareResult> {
    const wanted = input.languages ? new Set(input.languages) : null;
    const listener = input.onProgress;
    const relay = listener
      ? (progress: MindooDBAppInkProgress) => {
          if (!wanted || wanted.has(progress.language)) listener(progress);
        }
      : null;
    if (relay) this.handlers.add(relay);
    try {
      return await this.rpc.call<MindooDBAppInkPrepareResult>("ink.prepare", {
        ...(input.languages ? { languages: [...input.languages] } : {}),
      });
    } catch (error) {
      if (isUnknownMethod(error)) return { status: "unsupported", languages: {} };
      throw error;
    } finally {
      if (relay) this.handlers.delete(relay);
    }
  }

  async recognize(input: MindooDBAppInkRecognizeInput): Promise<MindooDBAppInkRecognizeResult> {
    const strokes = cleanStrokes(input.strokes ?? []);
    if (strokes.length === 0) return { status: "failed", reason: "no strokes" };
    try {
      return await this.rpc.call<MindooDBAppInkRecognizeResult>("ink.recognize", {
        strokes,
        ...(input.area ? { area: { w: input.area.w, h: input.area.h } } : {}),
        ...(input.language ? { language: input.language } : {}),
        ...(input.preContext ? { preContext: input.preContext.slice(-20) } : {}),
        ...(input.hint ? { hint: input.hint } : {}),
        ...(input.maxCandidates ? { maxCandidates: Math.min(10, Math.max(1, Math.round(input.maxCandidates))) } : {}),
      });
    } catch (error) {
      if (isUnknownMethod(error)) return { status: "unsupported" };
      throw error;
    }
  }

  onProgress(handler: MindooDBAppInkProgressHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  dispose() {
    this.stopListening();
    this.handlers.clear();
  }
}
