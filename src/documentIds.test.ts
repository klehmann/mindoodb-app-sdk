import { describe, expect, it } from "vitest";

import {
  assertValidMindooDBCreateIds,
  isValidMindooDBDocumentId,
  mindooDBDocumentId,
} from "./documentIds";

describe("document id rules", () => {
  it("accepts ids starting with a lowercase letter", () => {
    expect(isValidMindooDBDocumentId("wb_default")).toBe(true);
    expect(isValidMindooDBDocumentId("game_6ac1_x")).toBe(true);
    for (const id of ["6ac16a5e71b863b189e9a8ab_game", "Game", "doc-1", "_x", ""]) {
      expect(isValidMindooDBDocumentId(id)).toBe(false);
    }
  });

  it("builds valid ids from parts that start with a digit or contain other characters", () => {
    expect(mindooDBDocumentId("game", "6ac16a5e71b863b189e9a8ab", "musv808d")).toBe("game_6ac16a5e71b863b189e9a8ab_musv808d");
    expect(mindooDBDocumentId("demo", "Trees", "doc-5", 3)).toBe("demo_trees_doc_5_3");
    expect(() => mindooDBDocumentId("1x")).toThrow();
  });

  it("reports invalid ids and prefixes like the host", () => {
    expect(() => assertValidMindooDBCreateIds({ id: "6ac1_game" })).toThrow(
      'createDocument: invalid document id "6ac1_game". Custom document IDs must match ^[a-z][a-z0-9_]*$.',
    );
    expect(() => assertValidMindooDBCreateIds({ idPrefix: "cls_" })).toThrow(/invalid idPrefix "cls_"/);
    expect(() => assertValidMindooDBCreateIds({ idPrefix: "classroom1" })).not.toThrow();
    expect(() => assertValidMindooDBCreateIds({})).not.toThrow();
  });
});
