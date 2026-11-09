// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MindooDBAppForeignContentClient } from "./foreignContent";
import type { PortRpcClient } from "./portRpcClient";

function rpcAnswering(answer: (method: string) => unknown): PortRpcClient {
  return { call: vi.fn(async (method: string) => answer(method)) } as unknown as PortRpcClient;
}

/** Plays Haven's viewer page: takes the port from the connect message and answers on it. */
function playViewer(container: HTMLElement) {
  return new Promise<{ port: MessagePort; origin: string; received: unknown[] }>((resolve) => {
    const observer = new MutationObserver(() => {
      const frame = container.querySelector("iframe");
      if (!frame) return;
      observer.disconnect();
      const received: unknown[] = [];
      vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(((message: unknown, origin: string, transfer?: Transferable[]) => {
        const port = transfer?.[0] as MessagePort;
        expect(message).toEqual({ type: "mindoodb-foreign-content/connect" });
        port.onmessage = (event) => received.push(event.data);
        port.postMessage({ type: "ready", version: 1 });
        resolve({ port, origin, received });
      }) as never);
      frame.dispatchEvent(new Event("load"));
    });
    observer.observe(container, { childList: true });
  });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("foreign content", () => {
  it("frames Haven's viewer, hands it a port and renders, sizes and reports links", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const client = new MindooDBAppForeignContentClient(rpcAnswering(() => ({ url: "https://haven.example/foreign-frame.html", version: 1 })));
    const viewer = playViewer(container);
    const shown = client.show({ container, html: "<p>Hi <img src=https://x.example/a.png></p>", title: "Message body" });
    const { port, origin, received } = await viewer;
    const view = await shown;
    expect(origin).toBe("https://haven.example");
    expect(view.frame.title).toBe("Message body");
    expect(view.frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    await tick();
    expect(received).toEqual([{ type: "render", html: "<p>Hi <img src=https://x.example/a.png></p>", remoteImages: false, css: "" }]);

    const heights: number[] = [];
    const links: unknown[] = [];
    const rendered: unknown[] = [];
    view.onHeight((height) => heights.push(height));
    view.onLink((link) => links.push(link));
    view.onRendered((info) => rendered.push(info));
    port.postMessage({ type: "height", height: 321.4 });
    port.postMessage({ type: "link", href: "https://example.com", text: "Example" });
    port.postMessage({ type: "rendered", remoteImages: 1 });
    await tick();
    await tick();
    expect(heights).toEqual([321.4]);
    expect(view.frame.style.height).toBe("322px");
    expect(links).toEqual([{ href: "https://example.com", text: "Example" }]);
    expect(rendered).toEqual([{ remoteImages: 1 }]);

    view.update({ remoteImages: true });
    await tick();
    expect(received.at(-1)).toEqual({ type: "render", html: "<p>Hi <img src=https://x.example/a.png></p>", remoteImages: true, css: "" });
    view.close();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("rejects with unsupported on a Haven without the viewer", async () => {
    const client = new MindooDBAppForeignContentClient({
      call: vi.fn(async () => {
        throw Object.assign(new Error("nope"), { code: "method-not-found" });
      }),
    } as unknown as PortRpcClient);
    await expect(client.show({ container: document.createElement("div"), html: "" })).rejects.toMatchObject({ code: "unsupported" });
  });
});
