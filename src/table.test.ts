import { describe, expect, it } from "vitest";

import {
  createMindooTable,
  isMindooTable,
  mindooTableOffers,
  mindooTableToMarkdown,
  mindooTableToTsv,
  parseDelimitedText,
  parseMarkdownTable,
  readMindooTable,
} from "./index";

const table = createMindooTable(
  [
    { key: "date", label: "Date", type: "date" },
    { key: "title", label: "Title", type: "text" },
    { key: "hours", label: "Hours", type: "duration" },
    { key: "amount", label: "Amount", type: "money" },
  ],
  [
    ["2026-11-02", "Daily | sync", 90, "133.50"],
    ["2026-11-03", "Review\twith tabs", 30, null],
  ],
  { currency: "EUR" },
);

describe("mindoo.table@1", () => {
  it("is offered as JSON, tab-separated text and Markdown", () => {
    expect(isMindooTable(table)).toBe(true);
    expect(isMindooTable({ $type: "mindoo.table@1", columns: [{ key: "a", label: "A", type: "colour" }], rows: [] })).toBe(false);
    expect(mindooTableToTsv(table)).toBe("Date\tTitle\tHours\tAmount\n2026-11-02\tDaily | sync\t1:30\t133.50\n2026-11-03\tReview with tabs\t0:30\t");
    expect(mindooTableToMarkdown(table).split("\n").slice(0, 3)).toEqual([
      "| Date | Title | Hours | Amount |",
      "| --- | --- | ---: | ---: |",
      "| 2026-11-02 | Daily \\| sync | 1:30 | 133.50 |",
    ]);
    expect(mindooTableOffers(table).map((offer) => offer.type)).toEqual(["application/json", "text/plain", "text/markdown"]);
    expect(mindooTableToTsv(table, (value, column) => (column.type === "money" && value ? `${value} €` : String(value ?? "")))).toContain("133.50 €");
  });

  it("is read back from drag items: JSON first, then Markdown, then delimited text", () => {
    const items = Object.fromEntries(mindooTableOffers(table).map((offer) => [offer.type, offer.data]));
    expect(readMindooTable(items)?.typed).toEqual(table);
    expect(readMindooTable({ "text/markdown": items["text/markdown"] })?.rows[0]).toEqual(["2026-11-02", "Daily | sync", "1:30", "133.50"]);
    expect(readMindooTable({ "text/plain": items["text/plain"] })).toEqual({
      headers: ["Date", "Title", "Hours", "Amount"],
      rows: [
        ["2026-11-02", "Daily | sync", "1:30", "133.50"],
        ["2026-11-03", "Review with tabs", "0:30", ""],
      ],
      typed: null,
    });
    expect(readMindooTable({ "text/plain": "" })).toBeNull();
  });

  it("splits CSV with quotes, semicolons and tabs", () => {
    expect(parseDelimitedText('Datum;Beschreibung;Aufwand\n02.11.2026;"Sprint; Planung";1,5\n')).toEqual([
      ["Datum", "Beschreibung", "Aufwand"],
      ["02.11.2026", "Sprint; Planung", "1,5"],
    ]);
    expect(parseDelimitedText('﻿Date,Title\r\n2026-11-02,"Say ""hi"""')).toEqual([
      ["Date", "Title"],
      ["2026-11-02", 'Say "hi"'],
    ]);
    expect(parseMarkdownTable("no table here")).toBeNull();
  });
});
