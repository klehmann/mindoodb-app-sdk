// @vitest-environment jsdom
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toShareFilePayloads } from "./client/files";
import { decodeDataUrl, installDownloadCapture } from "./downloadCapture";
import type { MindooDBAppFilesShareResult } from "./types";

async function text(file: File) {
  return await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file);
  });
}

describe("installDownloadCapture", () => {
  let stop: (() => void) | null = null;
  const originalClick = HTMLAnchorElement.prototype.click;
  afterEach(() => {
    stop?.();
    stop = null;
    HTMLAnchorElement.prototype.click = originalClick;
  });

  function setup(active: boolean, answer: MindooDBAppFilesShareResult = { ok: true, method: "share" }) {
    const navigations: string[] = [];
    // jsdom cannot download: count what would have been followed instead.
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      navigations.push(this.download);
    };
    const share = vi.fn(async (_files: File[]) => answer);
    stop = installDownloadCapture({ active: () => active, share });
    return { share, navigations };
  }

  function link(href: string, name = "Offer.pdf") {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = name;
    return anchor;
  }

  it("hands a blob: download to the share sheet instead of following it", async () => {
    const { share, navigations } = setup(true);
    const url = URL.createObjectURL(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
    link(url).click();
    URL.revokeObjectURL(url);
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const [file] = share.mock.calls[0]![0];
    expect([file!.name, file!.type, await text(file!)]).toEqual(["Offer.pdf", "application/pdf", "%PDF-1.7"]);
    expect(navigations).toEqual([]);
  });

  it("takes data: URLs and a user's click on a link too", async () => {
    const { share } = setup(true);
    const anchor = link("data:text/plain;base64,SGFsbG8=", "note.txt");
    document.body.append(anchor);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(await text(share.mock.calls[0]![0][0]!)).toBe("Hallo");
    anchor.remove();
  });

  it("leaves downloads alone in a browser, links without download and unknown blobs", () => {
    const inactive = setup(false);
    const url = URL.createObjectURL(new Blob(["x"]));
    link(url).click();
    expect(inactive.share).not.toHaveBeenCalled();
    expect(inactive.navigations).toEqual(["Offer.pdf"]);
    stop?.();

    const active = setup(true);
    const plain = document.createElement("a");
    plain.href = "https://example.com/";
    plain.click();
    link("blob:http://localhost/unknown").click();
    expect(active.share).not.toHaveBeenCalled();
    expect(active.navigations).toEqual(["", "Offer.pdf"]);
  });

  it("lets the link through once when Haven cannot share", async () => {
    const { share, navigations } = setup(true, { ok: false, reason: "unsupported" });
    link(URL.createObjectURL(new Blob(["x"]))).click();
    await vi.waitFor(() => expect(navigations).toEqual(["Offer.pdf"]));
    expect(share).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the user cancels, and is gone once stopped", async () => {
    const { share, navigations } = setup(true, { ok: false, reason: "cancelled" });
    link(URL.createObjectURL(new Blob(["x"]))).click();
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(navigations).toEqual([]);
    stop?.();
    stop = null;
    link(URL.createObjectURL(new Blob(["y"]))).click();
    expect(navigations).toEqual(["Offer.pdf"]);
    expect(share).toHaveBeenCalledTimes(1);
  });
});

describe("decodeDataUrl", () => {
  it("reads base64 and percent-encoded data URLs", () => {
    expect(decodeDataUrl("data:image/png;base64,AAE=")).toEqual({ type: "image/png", bytes: new Uint8Array([0, 1]) });
    const plain = decodeDataUrl("data:,M%C3%BCller")!;
    expect([plain.type, new TextDecoder().decode(plain.bytes)]).toEqual(["text/plain", "Müller"]);
    expect(decodeDataUrl("blob:x")).toBeNull();
  });
});

describe("toShareFilePayloads", () => {
  it("takes bytes from another realm, as they arrive over a MessagePort", async () => {
    const foreign = vm.runInNewContext("new Uint8Array([1, 2, 3])") as Uint8Array;
    expect(foreign instanceof Uint8Array).toBe(false);
    const [payload] = await toShareFilePayloads([{ name: "a.bin", type: "application/octet-stream", data: foreign }]);
    expect(Array.from(payload!.data)).toEqual([1, 2, 3]);
  });
});
