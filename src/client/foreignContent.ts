import type {
  MindooDBAppForeignContentApi,
  MindooDBAppForeignContentInput,
  MindooDBAppForeignContentView,
} from "../types";
import type { PortRpcClient } from "./portRpcClient";

function unsupported(message: string): Error {
  return Object.assign(new Error(message), { code: "unsupported" });
}

function isUnknownMethod(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "method-not-found" || code === "unsupported";
}

/** How long the viewer page may take to load and answer. */
const READY_TIMEOUT_MS = 15_000;

type Message =
  | { type: "ready"; version: number }
  | { type: "height"; height: number }
  | { type: "link"; href: string; text: string }
  | { type: "rendered"; remoteImages: number };

class ForeignContentView implements MindooDBAppForeignContentView {
  private readonly heightListeners = new Set<(height: number) => void>();
  private readonly linkListeners = new Set<(link: { href: string; text: string }) => void>();
  private readonly renderedListeners = new Set<(info: { remoteImages: number }) => void>();
  private state: { html: string; remoteImages: boolean; css: string };
  private closed = false;

  constructor(
    public readonly frame: HTMLIFrameElement,
    private readonly port: MessagePort,
    input: MindooDBAppForeignContentInput,
  ) {
    this.state = { html: input.html, remoteImages: input.remoteImages === true, css: input.css ?? "" };
    port.onmessage = (event: MessageEvent<Message>) => this.receive(event.data);
  }

  private receive(message: Message) {
    if (!message || typeof message !== "object" || this.closed) return;
    if (message.type === "height" && Number.isFinite(message.height)) {
      this.frame.style.height = `${Math.max(0, Math.ceil(message.height))}px`;
      this.heightListeners.forEach((listener) => listener(message.height));
    } else if (message.type === "link" && typeof message.href === "string") {
      const link = { href: message.href, text: typeof message.text === "string" ? message.text : "" };
      this.linkListeners.forEach((listener) => listener(link));
    } else if (message.type === "rendered") {
      const info = { remoteImages: Number(message.remoteImages) || 0 };
      this.renderedListeners.forEach((listener) => listener(info));
    }
  }

  render() {
    if (this.closed) return;
    this.port.postMessage({ type: "render", ...this.state });
  }

  update(input: Partial<Pick<MindooDBAppForeignContentInput, "html" | "remoteImages" | "css">>) {
    this.state = {
      html: input.html ?? this.state.html,
      remoteImages: input.remoteImages ?? this.state.remoteImages,
      css: input.css ?? this.state.css,
    };
    this.render();
  }

  onHeight(listener: (height: number) => void) {
    this.heightListeners.add(listener);
    return () => void this.heightListeners.delete(listener);
  }

  onLink(listener: (link: { href: string; text: string }) => void) {
    this.linkListeners.add(listener);
    return () => void this.linkListeners.delete(listener);
  }

  onRendered(listener: (info: { remoteImages: number }) => void) {
    this.renderedListeners.add(listener);
    return () => void this.renderedListeners.delete(listener);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.port.close();
    this.frame.remove();
    this.heightListeners.clear();
    this.linkListeners.clear();
    this.renderedListeners.clear();
  }
}

/**
 * `session.foreignContent`. Haven names its viewer page; the app frames it and
 * hands it a MessagePort, so neither the content nor Haven's page can reach the
 * app, and nothing passes through Haven itself after the URL.
 */
export class MindooDBAppForeignContentClient implements MindooDBAppForeignContentApi {
  constructor(private readonly rpc: PortRpcClient) {}

  async show(input: MindooDBAppForeignContentInput): Promise<MindooDBAppForeignContentView> {
    let url: string;
    try {
      ({ url } = await this.rpc.call<{ url: string }>("foreignContent.frameUrl", {}));
    } catch (error) {
      if (isUnknownMethod(error)) throw unsupported("This Haven has no viewer for foreign content.");
      throw error;
    }
    const target = new URL(url);
    const frame = input.container.ownerDocument.createElement("iframe");
    frame.src = url;
    frame.title = input.title ?? "";
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.dataset.mindoodbForeignContent = "";
    Object.assign(frame.style, { display: "block", width: "100%", height: "0px", border: "0", background: "transparent" });
    const channel = new MessageChannel();
    const view = new ForeignContentView(frame, channel.port1, input);
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(unsupported("Haven's viewer did not answer.")), READY_TIMEOUT_MS);
      channel.port1.addEventListener("message", function onReady(event) {
        if ((event.data as Message | null)?.type !== "ready") return;
        clearTimeout(timer);
        channel.port1.removeEventListener("message", onReady);
        resolve();
      });
      channel.port1.start();
      frame.addEventListener(
        "load",
        () => {
          // `*` only where the page has no comparable origin (custom schemes); the port is what counts.
          const origin = target.protocol === "http:" || target.protocol === "https:" ? target.origin : "*";
          frame.contentWindow?.postMessage({ type: "mindoodb-foreign-content/connect" }, origin, [channel.port2]);
        },
        { once: true },
      );
    });
    input.container.appendChild(frame);
    try {
      await ready;
    } catch (error) {
      view.close();
      throw error;
    }
    view.render();
    return view;
  }
}
