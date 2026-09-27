import { describe, expect, it } from "vitest";

import { isLaunchedByHaven, readMindooDBAppLaunchId } from "./hosting";

describe("launch detection", () => {
  it("reads the launch id Haven appends", () => {
    expect(readMindooDBAppLaunchId("?mindoodbAppLaunchId=abc&x=1")).toBe("abc");
    expect(isLaunchedByHaven("?mindoodbAppLaunchId=abc")).toBe(true);
  });

  it("treats a missing or blank launch id as a direct visit", () => {
    expect(readMindooDBAppLaunchId("")).toBeNull();
    expect(readMindooDBAppLaunchId("?mindoodbAppLaunchId=%20")).toBeNull();
    expect(isLaunchedByHaven("?app=1")).toBe(false);
  });
});
