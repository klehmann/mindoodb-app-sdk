import { describe, expect, it } from "vitest";

describe("session.getDevice", () => {
  it("the mock plays one device per session, configurable for two-device tests", async () => {
    const { createMockMindooDBAppSession } = await import("../testing");
    expect(await createMockMindooDBAppSession().session.getDevice()).toEqual({
      id: "mock-device",
      label: "Test device",
      platform: "browser",
    });
    const laptop = createMockMindooDBAppSession({ device: { id: "laptop", label: "Laptop", platform: "desktop" } });
    expect((await laptop.session.getDevice())?.id).toBe("laptop");
  });
});
