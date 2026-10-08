/**
 * App side of agent tools: keeps the implementations, tells Haven what exists,
 * and answers Haven's `agent-invoke` messages.
 *
 * Only descriptors cross the bridge. `execute` stays in the app and runs when
 * Haven forwards an agent's call; the outcome goes back as one `agent-result`
 * message per call. A tool that throws {@link MindooDBAppAgentToolError}
 * reports its code; any other exception becomes `FAILED`.
 *
 * @module agentTools
 */
import type {
  MindooDBAppAgentApi,
  MindooDBAppAgentRegistration,
  MindooDBAppAgentTool,
  MindooDBAppAgentToolErrorCode,
  MindooDBAppBridgeAgentResultMessage,
  MindooDBAppBridgePortMessage,
} from "../types";

/** Tool names an agent client accepts everywhere, before Haven adds the app prefix. */
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;

/** Throw from `execute` to give the agent a code and, ideally, what to do next. */
export class MindooDBAppAgentToolError extends Error {
  readonly code: MindooDBAppAgentToolErrorCode;
  readonly requiredAction?: string;

  constructor(code: MindooDBAppAgentToolErrorCode, message: string, requiredAction?: string) {
    super(message);
    this.name = "MindooDBAppAgentToolError";
    this.code = code;
    this.requiredAction = requiredAction;
  }
}

/** The part of the RPC client the agent API needs; kept narrow for tests. */
export interface AgentToolsRpc {
  call<TResult>(method: string, params: unknown): Promise<TResult>;
  postMessage(message: MindooDBAppBridgePortMessage): void;
  addMessageListener(listener: (message: MindooDBAppBridgePortMessage) => void): () => void;
}

/** Tool results must be plain JSON; this also strips reactive proxies before cloning. */
function toJson(value: unknown): unknown {
  return value === undefined ? null : (JSON.parse(JSON.stringify(value)) as unknown);
}

export class MindooDBAppAgentApiImpl implements MindooDBAppAgentApi {
  private tools = new Map<string, MindooDBAppAgentTool>();
  private readonly stopListening: () => void;

  constructor(private readonly rpc: AgentToolsRpc) {
    this.stopListening = rpc.addMessageListener((message) => {
      if (message.kind === "agent-invoke") {
        void this.invoke(message.callId, message.tool, message.input);
      }
    });
  }

  async registerTools(tools: MindooDBAppAgentTool[]): Promise<MindooDBAppAgentRegistration> {
    const next = new Map<string, MindooDBAppAgentTool>();
    for (const tool of tools) {
      if (!TOOL_NAME_PATTERN.test(tool.name)) {
        throw new Error(`Invalid agent tool name "${tool.name}": use lower case, digits and underscores.`);
      }
      if (next.has(tool.name)) {
        throw new Error(`Agent tool "${tool.name}" is registered twice.`);
      }
      next.set(tool.name, tool);
    }
    this.tools = next;
    return await this.rpc.call<MindooDBAppAgentRegistration>("agent.registerTools", {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: toJson(tool.inputSchema),
        ...(tool.annotations ? { annotations: { ...tool.annotations } } : {}),
        ...(tool.scope ? { scope: tool.scope } : {}),
      })),
    });
  }

  async provideFile(
    data: Blob | ArrayBuffer | Uint8Array,
    options: { name: string; mimeType?: string },
  ): Promise<{ fileRef: string; size: number }> {
    const buffer =
      data instanceof Blob
        ? await data.arrayBuffer()
        : data instanceof Uint8Array
          ? data.slice().buffer
          : data;
    return await this.rpc.call("agent.provideFile", {
      name: options.name,
      mimeType: options.mimeType ?? (data instanceof Blob ? data.type : undefined),
      data: buffer,
    });
  }

  async takeFile(fileRef: string): Promise<File> {
    const result = await this.rpc.call<{ name: string; mimeType: string; data: ArrayBuffer }>("agent.takeFile", {
      fileRef,
    });
    return new File([result.data], result.name, { type: result.mimeType });
  }

  async setContext(context: Record<string, unknown> | null): Promise<void> {
    await this.rpc.call("agent.setContext", { context: context === null ? null : toJson(context) });
  }

  dispose() {
    this.stopListening();
    this.tools.clear();
  }

  private async invoke(callId: string, name: string, input: Record<string, unknown>) {
    let reply: MindooDBAppBridgeAgentResultMessage;
    const tool = this.tools.get(name);
    try {
      if (!tool) {
        throw new MindooDBAppAgentToolError("NOT_FOUND", `The app has no tool "${name}" (any more).`);
      }
      const result = await tool.execute(input ?? {});
      reply = { protocol: "mindoodb-app-bridge", kind: "agent-result", callId, ok: true, result: toJson(result) };
    } catch (error) {
      reply = {
        protocol: "mindoodb-app-bridge",
        kind: "agent-result",
        callId,
        ok: false,
        error:
          error instanceof MindooDBAppAgentToolError
            ? {
                code: error.code,
                message: error.message,
                ...(error.requiredAction ? { requiredAction: error.requiredAction } : {}),
              }
            : { code: "FAILED", message: error instanceof Error && error.message ? error.message : String(error) },
      };
    }
    try {
      this.rpc.postMessage(reply);
    } catch (error) {
      console.warn("[mindoodb-app-sdk] Could not return an agent tool result.", error);
    }
  }
}
