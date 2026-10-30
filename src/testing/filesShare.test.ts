import { describe, expect, it } from "vitest";

import { createMockMindooDBAppSession } from "./index";

describe("mock session.files.share", () => {
  it("records the files and answers the outcome the test set", async () => {
    const mock = createMockMindooDBAppSession({ databases: [] });
    const session = await mock.bridge.connect();
    const pdf = new File(["%PDF-1.7"], "Offer.pdf", { type: "application/pdf" });

    expect(await session.files.share([pdf], { title: "Offer" })).toEqual({ ok: true, method: "share" });
    mock.setShareOutcome("cancelled");
    expect(await session.files.share([pdf, { name: "b.txt", data: new Uint8Array([1]) }])).toEqual({
      ok: false,
      reason: "cancelled",
    });
    expect(await session.files.share([])).toMatchObject({ ok: false, reason: "invalid" });

    const requests = mock.getShareRequests();
    expect(requests.map((request) => [request.title, request.files.map((file) => file.name)])).toEqual([
      ["Offer", ["Offer.pdf"]],
      [undefined, ["Offer.pdf", "b.txt"]],
    ]);
    expect(requests[0].files[0]).toMatchObject({ type: "application/pdf" });
  });
});
