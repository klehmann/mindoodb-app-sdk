import { describe, expect, it, vi } from "vitest";

import { MindooDBAppFilesApiImpl } from "./files";
import type { PortRpcClient } from "./portRpcClient";

function fakeRpc(answer: (method: string, params: unknown) => unknown) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const rpc = {
    call: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params });
      return answer(method, params);
    }),
  } as unknown as PortRpcClient;
  return { rpc, calls };
}

describe("session.files", () => {
  it("sends name, type and bytes of each file to files.share", async () => {
    const { rpc, calls } = fakeRpc(() => ({ ok: true, method: "share" }));
    const api = new MindooDBAppFilesApiImpl(rpc);
    const result = await api.share(
      [
        new File(["%PDF-1.7"], "Offer.pdf", { type: "application/pdf" }),
        { name: "notes.txt", data: new TextEncoder().encode("hi") },
        { name: "pic.png", data: new Blob([new Uint8Array([1, 2])], { type: "image/png" }) },
      ],
      { title: "3 offers" },
    );
    expect(result).toEqual({ ok: true, method: "share" });
    expect(calls[0].method).toBe("files.share");
    const params = calls[0].params as { files: Array<{ name: string; type: string; data: Uint8Array }>; title: string };
    expect(params.title).toBe("3 offers");
    expect(params.files.map((file) => [file.name, file.type, file.data.byteLength])).toEqual([
      ["Offer.pdf", "application/pdf", 8],
      ["notes.txt", "application/octet-stream", 2],
      ["pic.png", "image/png", 2],
    ]);
    expect(params.files[0].data).toBeInstanceOf(Uint8Array);
  });

  it("answers invalid without asking Haven when a limit is broken", async () => {
    const { rpc, calls } = fakeRpc(() => ({ ok: true, method: "share" }));
    const api = new MindooDBAppFilesApiImpl(rpc);
    expect(await api.share([])).toMatchObject({ ok: false, reason: "invalid" });
    expect(await api.share([{ name: " ", data: new Uint8Array(1) }])).toMatchObject({ ok: false, reason: "invalid" });
    const many = Array.from({ length: 51 }, (_, n) => ({ name: `${n}.txt`, data: new Uint8Array(1) }));
    expect(await api.share(many)).toMatchObject({ ok: false, reason: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("answers unsupported when Haven does not know files.share", async () => {
    const { rpc } = fakeRpc(() => {
      throw Object.assign(new Error("unknown"), { code: "method-not-found" });
    });
    const api = new MindooDBAppFilesApiImpl(rpc);
    expect(await api.share([{ name: "a.txt", data: new Uint8Array(1) }])).toEqual({ ok: false, reason: "unsupported" });
  });
});
