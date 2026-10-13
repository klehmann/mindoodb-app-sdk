import { describe, expect, it, vi } from "vitest";

import { MindooDBAppPdfApiImpl } from "./pdf";
import type { PortRpcClient } from "./portRpcClient";

const PDF = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");

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

describe("session.pdf", () => {
  it("passes the request to pdf.sign", async () => {
    const { rpc, calls } = fakeRpc(() => ({ ok: false, reason: "declined" }));
    const api = new MindooDBAppPdfApiImpl(rpc);
    expect(await api.sign({ pdf: PDF, reason: "Approved", visibleSignature: { pageIndex: 2 } })).toEqual({
      ok: false,
      reason: "declined",
    });
    expect(calls[0]).toEqual({
      method: "pdf.sign",
      params: {
        pdf: PDF,
        fileName: undefined,
        reason: "Approved",
        location: undefined,
        contactInfo: undefined,
        visibleSignature: { pageIndex: 2 },
        timestamp: undefined,
      },
    });
  });

  it("reports unsupported on hosts without PDF signing", async () => {
    const { rpc } = fakeRpc(() => {
      throw Object.assign(new Error("unknown"), { code: "method-not-found" });
    });
    expect(await new MindooDBAppPdfApiImpl(rpc).sign({ pdf: PDF })).toEqual({ ok: false, reason: "unsupported" });
  });
});

describe("mock session pdf.sign", () => {
  it("answers as if the user signed, records the request and can decline", async () => {
    const { createMockMindooDBAppSession } = await import("../testing");
    const mock = createMockMindooDBAppSession();
    const signed = await mock.session.pdf.sign({ pdf: PDF, fileName: "a.pdf", timestamp: false });
    expect(signed).toMatchObject({ ok: true, pdf: PDF, signer: { commonName: "Test Signer" } });
    expect(signed.ok && signed.timestampTime).toBe(undefined);
    expect(mock.getPdfSignRequests()).toEqual([{ pdf: PDF, fileName: "a.pdf", timestamp: false }]);

    expect(await mock.session.pdf.sign({ pdf: new Uint8Array([1, 2, 3]) })).toMatchObject({ ok: false, reason: "invalid" });
    mock.setPdfSignOutcome("declined");
    expect(await mock.session.pdf.sign({ pdf: PDF })).toEqual({ ok: false, reason: "declined" });
  });
});
