import { describe, expect, it } from "vitest";
import { applySafeAreaVariables, MINDOODB_SAFE_AREA_CSS_VARIABLES } from "./safeArea";

function root() {
  const values = new Map<string, string>();
  return { values, style: { setProperty: (name: string, value: string) => values.set(name, value) } };
}

describe("applySafeAreaVariables", () => {
  it("sets the four variables from the insets, rounded to a tenth of a pixel", () => {
    const target = root();
    applySafeAreaVariables({ top: 62.04, right: 0, bottom: 34, left: 0 }, target);
    expect(Object.fromEntries(target.values)).toEqual({
      [MINDOODB_SAFE_AREA_CSS_VARIABLES.top]: "62px",
      [MINDOODB_SAFE_AREA_CSS_VARIABLES.right]: "0px",
      [MINDOODB_SAFE_AREA_CSS_VARIABLES.bottom]: "34px",
      [MINDOODB_SAFE_AREA_CSS_VARIABLES.left]: "0px",
    });
  });

  it("falls back to 0px without insets or with nonsense values", () => {
    const target = root();
    applySafeAreaVariables(undefined, target);
    expect([...target.values.values()]).toEqual(["0px", "0px", "0px", "0px"]);
    applySafeAreaVariables({ top: Number.NaN, right: -3, bottom: Infinity, left: 2 }, target);
    expect([...target.values.values()]).toEqual(["0px", "0px", "0px", "2px"]);
  });

  it("does nothing without a document", () => {
    expect(() => applySafeAreaVariables({ top: 1, right: 0, bottom: 0, left: 0 }, undefined)).not.toThrow();
  });
});
