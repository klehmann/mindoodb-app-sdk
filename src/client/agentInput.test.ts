import { describe, expect, it } from "vitest";

import { normalizeAgentToolInput } from "./agentInput";

const POINT = { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } };
const RECT = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } },
};

describe("normalizeAgentToolInput", () => {
  it("drops blank strings, empty arrays, null and empty objects from optional fields", () => {
    const schema = {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        keyId: { type: "string" },
        shareWith: { type: "array", items: { type: "string" } },
        onlyMe: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
        note: { type: "string" },
        options: { type: "object", properties: { mode: { type: "string" } } },
      },
    };
    expect(
      normalizeAgentToolInput(
        { title: "", keyId: " ", shareWith: [], onlyMe: false, tags: ["a"], note: null, options: { mode: "" } },
        schema,
      ),
    ).toEqual({ title: "", onlyMe: false, tags: ["a"] });
  });

  it("keeps numbers, booleans and properties the schema does not declare", () => {
    const schema = { type: "object", properties: { page: { type: "integer" }, inside: { type: "boolean" } } };
    expect(normalizeAgentToolInput({ page: 0, inside: false, extra: "" }, schema)).toEqual({
      page: 0,
      inside: false,
      extra: "",
    });
  });

  it("cleans objects inside arrays without dropping the array entries", () => {
    // What Goose sent for one ellipse in sketchbook draw.
    const schema = {
      type: "object",
      required: ["shapes"],
      properties: {
        layerId: { type: "string" },
        shapes: {
          type: "array",
          items: {
            type: "object",
            required: ["type"],
            properties: {
              type: { type: "string" },
              from: POINT,
              fromId: { type: "string" },
              points: { type: "array", items: POINT },
              d: { type: "string" },
              cx: { type: "number" },
              around: {
                type: "object",
                properties: { ids: { type: "array", items: { type: "string" } }, rect: RECT, padding: { type: "number" } },
              },
            },
          },
        },
      },
    };
    const input = {
      layerId: "",
      shapes: [
        {
          type: "ellipse",
          from: { x: 0, y: 0 },
          fromId: "",
          points: [],
          d: "",
          cx: 380,
          around: { ids: [], rect: { x: 0, y: 0, width: 0, height: 0 }, padding: 0 },
        },
      ],
    };
    expect(normalizeAgentToolInput(input, schema)).toEqual({
      shapes: [
        {
          type: "ellipse",
          from: { x: 0, y: 0 },
          cx: 380,
          around: { rect: { x: 0, y: 0, width: 0, height: 0 }, padding: 0 },
        },
      ],
    });
    expect(input.layerId).toBe("");
  });

  it("leaves input alone when the schema declares no properties", () => {
    expect(normalizeAgentToolInput({ a: "", b: [] }, {})).toEqual({ a: "", b: [] });
  });
});
