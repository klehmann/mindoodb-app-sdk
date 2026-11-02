/** @vitest-environment jsdom */
/**
 * Host-owned drag with files, over the real bridge port against the fake host: the
 * app as a target (text and files dropped on it) and as a source (files produced only
 * when a target asks).
 */
import { describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import { MINIMAL_DRAG_PREVIEW_PNG } from "../drag";
import type { MindooDBAppDragDropEvent, MindooDBAppDragOverEvent } from "../types";
import { createFakeBridgeHost } from "./index";

const preview = () => ({ png: MINIMAL_DRAG_PREVIEW_PNG.buffer.slice(0), width: 80, height: 32, hotspotX: 4, hotspotY: 4 });

async function connected() {
  const host = createFakeBridgeHost();
  host.install();
  const session = await createMindooDBAppBridge().connect();
  return { host, session };
}

describe("drag with files in the fake host", () => {
  it("drops text and the files a target accepts, and reads them on demand", async () => {
    const { host, session } = await connected();
    try {
      const overs: MindooDBAppDragOverEvent[] = [];
      const drops: MindooDBAppDragDropEvent[] = [];
      await session.drag.setProfile({
        accepts: ["text/plain"],
        acceptsFiles: ["application/pdf", "image/*"],
        onOver: (event) => {
          overs.push(event);
          return { accept: event.x < 100, effect: "copy" };
        },
        onDrop: (event) => drops.push(event),
      });
      expect(host.drag.profile()).toEqual({ accepts: ["text/plain"], acceptsFiles: ["application/pdf", "image/*"] });

      const files = [
        { type: "application/pdf", name: "RE-1.pdf", size: 8 },
        { type: "application/xml", name: "RE-1.xml" },
      ];
      expect(await host.drag.over({ x: 10, y: 10, types: ["text/plain", "text/markdown"], files })).toEqual({ accept: true, effect: "copy" });
      expect(await host.drag.over({ x: 200, y: 10, types: ["text/plain"] })).toEqual({ accept: false, effect: "forbidden" });
      expect(overs[0]!.files).toEqual([{ type: "application/pdf", name: "RE-1.pdf", size: 8 }]);

      const delivered = await host.drag.drop({
        x: 10,
        y: 10,
        items: { "text/plain": "Rechnung RE-1", "text/markdown": "**Rechnung**" },
        files: [
          { type: "application/pdf", name: "RE-1.pdf", data: "%PDF-1.7" },
          { type: "application/xml", name: "RE-1.xml", data: "<x/>" },
          { type: "image/png", name: "logo.png", data: new Uint8Array([137, 80, 78, 71]) },
        ],
      });
      expect(delivered).toEqual({ types: ["text/plain"], files: ["RE-1.pdf", "logo.png"] });
      await expect.poll(() => drops.length).toBe(1);
      const drop = drops[0]!;
      expect(drop.items).toEqual({ "text/plain": "Rechnung RE-1" });
      expect(drop.files.map((file) => [file.name, file.type, file.size])).toEqual([
        ["RE-1.pdf", "application/pdf", 8],
        ["logo.png", "image/png", 4],
      ]);
      const pdf = await drop.files[0]!.read();
      expect(pdf.type).toBe("application/pdf");
      expect(await pdf.text()).toBe("%PDF-1.7");
    } finally {
      host.dispose();
    }
  });

  it("offers files when dragging and produces them only when asked", async () => {
    const { host, session } = await connected();
    try {
      let reads = 0;
      const result = session.drag.start({
        offers: [{ type: "text/plain", data: "RE-1" }],
        files: [
          {
            type: "application/pdf",
            name: "RE-1.pdf",
            read: async () => {
              reads += 1;
              return new Blob(["%PDF-1.7 invoice"], { type: "application/pdf" });
            },
          },
        ],
        preview: preview(),
        pointer: { x: 1, y: 1 },
      });
      await expect.poll(() => host.drag.started().length).toBe(1);
      const [drag] = host.drag.started();
      expect(drag!.offers).toEqual([{ type: "text/plain", data: "RE-1" }]);
      expect(drag!.files).toEqual([{ id: expect.any(String), type: "application/pdf", name: "RE-1.pdf" }]);
      expect(reads).toBe(0);

      host.drag.finish();
      expect(await result).toEqual({ action: "copied" });
      const blob = await host.drag.readFile(drag!.files[0]!.id);
      expect(reads).toBe(1);
      expect(blob.type).toBe("application/pdf");
      expect(await blob.text()).toBe("%PDF-1.7 invoice");
      await expect(host.drag.readFile("unknown")).rejects.toThrow(/no longer available/);
    } finally {
      host.dispose();
    }
  });

  it("allows a drag that offers only files, and rejects bad file names", async () => {
    const { host, session } = await connected();
    try {
      const start = session.drag.start({
        offers: [],
        files: [{ type: "application/pdf", name: "a.pdf", read: async () => new Uint8Array([1]) }],
        preview: preview(),
        pointer: { x: 1, y: 1 },
      });
      await expect.poll(() => host.drag.started().length).toBe(1);
      host.drag.finish({ action: "cancelled", reason: "escape" });
      expect(await start).toEqual({ action: "cancelled", reason: "escape" });
      await expect(
        session.drag.start({
          offers: [],
          files: [{ type: "application/pdf", name: "../a.pdf", read: async () => new Uint8Array([1]) }],
          preview: preview(),
          pointer: { x: 1, y: 1 },
        }),
      ).rejects.toThrow(/file name/);
      await expect(session.drag.start({ offers: [], preview: preview(), pointer: { x: 1, y: 1 } })).rejects.toThrow(/at least one type/);
    } finally {
      host.dispose();
    }
  });
});
