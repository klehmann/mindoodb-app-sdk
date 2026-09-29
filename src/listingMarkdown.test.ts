import { describe, expect, it } from "vitest";

import { listingMarkdownToPlainText, parseListingMarkdown, sanitizeListingHref } from "./listingMarkdown";

describe("listing markdown", () => {
  it("parses paragraphs, headings and lists", () => {
    expect(parseListingMarkdown("# Title\n\nFirst line\nsecond line\n\n- a\n- b\n  wrapped\n\n1. one\n2. two")).toEqual([
      { type: "heading", children: [{ type: "text", text: "Title" }] },
      { type: "paragraph", children: [{ type: "text", text: "First line second line" }] },
      {
        type: "list",
        ordered: false,
        items: [[{ type: "text", text: "a" }], [{ type: "text", text: "b wrapped" }]],
      },
      { type: "list", ordered: true, items: [[{ type: "text", text: "one" }], [{ type: "text", text: "two" }]] },
    ]);
  });

  it("parses emphasis, code and links", () => {
    const [block] = parseListingMarkdown("**bold** _it_ *it* `x_y` [site](https://a.example) see https://b.example/x.");
    expect(block).toEqual({
      type: "paragraph",
      children: [
        { type: "strong", children: [{ type: "text", text: "bold" }] },
        { type: "text", text: " " },
        { type: "em", children: [{ type: "text", text: "it" }] },
        { type: "text", text: " " },
        { type: "em", children: [{ type: "text", text: "it" }] },
        { type: "text", text: " " },
        { type: "code", text: "x_y" },
        { type: "text", text: " " },
        { type: "link", href: "https://a.example/", children: [{ type: "text", text: "site" }] },
        { type: "text", text: " see " },
        { type: "link", href: "https://b.example/x", children: [{ type: "text", text: "https://b.example/x" }] },
        { type: "text", text: "." },
      ],
    });
  });

  it("keeps identifiers, arithmetic and unknown syntax literal", () => {
    expect(listingMarkdownToPlainText("teacher_core and 2 * 3 * 4 <b>x</b> \\*no\\*")).toBe(
      "teacher_core and 2 * 3 * 4 <b>x</b> *no*",
    );
  });

  it("only links https: and mailto:", () => {
    expect(sanitizeListingHref("https://ok.example")).toBe("https://ok.example/");
    expect(sanitizeListingHref("mailto:hi@ok.example")).toBe("mailto:hi@ok.example");
    expect(sanitizeListingHref("java\nscript:alert(1)")).toBeNull();
    expect(sanitizeListingHref("http://plain.example")).toBeNull();
    expect(sanitizeListingHref("data:text/html,x")).toBeNull();
    expect(sanitizeListingHref("/relative")).toBeNull();
    expect(parseListingMarkdown("[x](javascript:alert(1))")).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "x" }] },
    ]);
  });

  it("converts to plain paragraphs for older readers", () => {
    expect(
      listingMarkdownToPlainText("**Vega** is _nice_.\n\n- one\n- [Site](https://vega.example)\n- [vega.example](https://vega.example)"),
    ).toBe("Vega is nice.\n\n• one\n\n• Site (https://vega.example/)\n\n• vega.example");
  });
});
