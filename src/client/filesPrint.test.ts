import { describe, expect, it, vi } from "vitest";

import { createMockMindooDBAppSession } from "../testing/index";
import { MindooDBAppFilesApiImpl } from "./files";
import type { PortRpcClient } from "./portRpcClient";

describe("session.files.print", () => {
  it("sends the name and bytes of a PDF to files.print", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const rpc = { call: vi.fn(async (method: string, params: unknown) => (calls.push({ method, params }), { ok: true })) } as unknown as PortRpcClient;
    const api = new MindooDBAppFilesApiImpl(rpc);
    expect(await api.print({ name: "Offer.pdf", data: new TextEncoder().encode("%PDF-1.7\n") })).toEqual({ ok: true });
    expect(calls[0]!.method).toBe("files.print");
    expect((calls[0]!.params as { name: string; data: Uint8Array }).name).toBe("Offer.pdf");
  });

  it("refuses what is not a PDF without asking Haven", async () => {
    const rpc = { call: vi.fn() } as unknown as PortRpcClient;
    const api = new MindooDBAppFilesApiImpl(rpc);
    expect(await api.print({ name: "a.txt", data: new TextEncoder().encode("hello") })).toMatchObject({ ok: false, reason: "invalid" });
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it("answers unsupported for an older Haven", async () => {
    const rpc = { call: vi.fn(async () => Promise.reject(Object.assign(new Error("no"), { code: "method-not-found" }))) } as unknown as PortRpcClient;
    const api = new MindooDBAppFilesApiImpl(rpc);
    expect(await api.print(new File(["%PDF-1.7"], "x.pdf"))).toEqual({ ok: false, reason: "unsupported" });
  });

  it("is mocked: unsupported by default, printed on request", async () => {
    const mock = createMockMindooDBAppSession({ databases: [] });
    const session = await mock.bridge.connect();
    const pdf = new File(["%PDF-1.7"], "Offer.pdf", { type: "application/pdf" });
    expect(await session.files.print(pdf)).toEqual({ ok: false, reason: "unsupported" });
    mock.setPrintOutcome("printed");
    expect(await session.files.print(pdf)).toEqual({ ok: true });
    expect(mock.getPrintRequests().map((request) => request.name)).toEqual(["Offer.pdf", "Offer.pdf"]);
  });
});
