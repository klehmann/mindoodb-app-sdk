/**
 * The shared table format `mindoo.table@1`, so TimeRecords, TeamGrid and other apps
 * exchange tables without knowing each other . A table source offers
 * three versions at once:
 *
 * - `application/json`: `{ "$type": "mindoo.table@1", columns: [{ key, label, type }], rows }`
 *   with normalized values (ISO dates, durations in minutes, money as decimal strings);
 * - `text/plain`: tab-separated with a header row (like a copy from a spreadsheet);
 * - `text/markdown`: a Markdown table.
 *
 * A target reads whichever it understands best: `readMindooTable(event.items)` takes the
 * typed JSON first, then a Markdown table, then delimited text (tabs, semicolons or commas,
 * as copied from a spreadsheet or saved as CSV).
 */

import type { MindooDBAppDragOffer } from "./types";

export const MINDOO_TABLE_TYPE = "mindoo.table@1";

export const MINDOO_TABLE_COLUMN_TYPES = ["date", "text", "duration", "money", "number"] as const;
export type MindooTableColumnType = (typeof MINDOO_TABLE_COLUMN_TYPES)[number];

export interface MindooTableColumn {
  key: string;
  label: string;
  type: MindooTableColumnType;
}

/** date: "YYYY-MM-DD"; duration: minutes; money: decimal string ("640.00"); number: number; text: string. */
export type MindooTableCell = string | number | null;

export interface MindooTable {
  $type: typeof MINDOO_TABLE_TYPE;
  columns: MindooTableColumn[];
  rows: MindooTableCell[][];
  /** ISO 4217 code of the money columns, if any. */
  currency?: string;
  /** A title for the table (a sheet name, a file name). */
  title?: string;
}

export function createMindooTable(columns: MindooTableColumn[], rows: MindooTableCell[][], extra: { currency?: string; title?: string } = {}): MindooTable {
  return { $type: MINDOO_TABLE_TYPE, columns, rows, ...extra };
}

export function isMindooTable(value: unknown): value is MindooTable {
  if (!value || typeof value !== "object") return false;
  const table = value as Partial<MindooTable>;
  return (
    table.$type === MINDOO_TABLE_TYPE &&
    Array.isArray(table.columns) &&
    table.columns.every((column) => column && typeof column.key === "string" && typeof column.label === "string" && (MINDOO_TABLE_COLUMN_TYPES as readonly string[]).includes(column.type)) &&
    Array.isArray(table.rows) &&
    table.rows.every((row) => Array.isArray(row))
  );
}

/** A cell as text in exchange form: durations as h:mm, everything else as stored. */
export function formatMindooTableCell(value: MindooTableCell, type: MindooTableColumnType): string {
  if (value === null || value === undefined) return "";
  if (type === "duration" && typeof value === "number") {
    const sign = value < 0 ? "-" : "";
    const minutes = Math.abs(Math.round(value));
    return `${sign}${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  }
  return String(value);
}

/** Tab-separated with a header row; tabs and line breaks inside cells become spaces. */
export function mindooTableToTsv(table: MindooTable, format: (value: MindooTableCell, column: MindooTableColumn) => string = (value, column) => formatMindooTableCell(value, column.type)): string {
  const clean = (text: string) => text.replace(/[\t\r\n]+/g, " ");
  const lines = [table.columns.map((column) => clean(column.label)).join("\t")];
  for (const row of table.rows) lines.push(table.columns.map((column, index) => clean(format(row[index] ?? null, column))).join("\t"));
  return lines.join("\n");
}

/** A Markdown table; numbers and durations right-aligned. */
export function mindooTableToMarkdown(table: MindooTable, format: (value: MindooTableCell, column: MindooTableColumn) => string = (value, column) => formatMindooTableCell(value, column.type)): string {
  const escape = (text: string) => text.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
  const header = `| ${table.columns.map((column) => escape(column.label)).join(" | ")} |`;
  const rule = `| ${table.columns.map((column) => (column.type === "text" || column.type === "date" ? "---" : "---:")).join(" | ")} |`;
  const body = table.rows.map((row) => `| ${table.columns.map((column, index) => escape(format(row[index] ?? null, column))).join(" | ")} |`);
  return [header, rule, ...body].join("\n");
}

/** The three offers of a table for `session.drag.bindSource` / `start` and the clipboard. */
export function mindooTableOffers(
  table: MindooTable,
  format?: (value: MindooTableCell, column: MindooTableColumn) => string,
): MindooDBAppDragOffer[] {
  return [
    { type: "application/json", data: JSON.stringify(table) },
    { type: "text/plain", data: mindooTableToTsv(table, format) },
    { type: "text/markdown", data: mindooTableToMarkdown(table, format) },
  ];
}

/** Splits delimited text (tab, semicolon or comma, detected from the first line) with "quoted" cells. */
export function parseDelimitedText(text: string): string[][] {
  const source = text.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
  const firstLine = source.split("\n", 1)[0] ?? "";
  const count = (char: string) => firstLine.split(char).length - 1;
  const delimiter = count("\t") > 0 ? "\t" : count(";") >= count(",") && count(";") > 0 ? ";" : count(",") > 0 ? "," : "\t";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((cells) => cells.map((value) => value.trim())).filter((cells) => cells.some((value) => value !== ""));
}

/** The cells of a Markdown table, or null when the text is not one. */
export function parseMarkdownTable(text: string): string[][] | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("|"));
  if (lines.length < 2 || !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(lines[1]!)) return null;
  const split = (line: string) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim().replace(/\\\|/g, "|"));
  return [split(lines[0]!), ...lines.slice(2).map(split)];
}

/** A table as plain cells (header first), from whatever a drop or paste brought. */
export interface MindooTableCells {
  headers: string[];
  rows: string[][];
  /** The typed table when the source offered `mindoo.table@1`. */
  typed: MindooTable | null;
}

export function mindooTableCells(table: MindooTable): MindooTableCells {
  return {
    headers: table.columns.map((column) => column.label),
    rows: table.rows.map((row) => table.columns.map((column, index) => formatMindooTableCell(row[index] ?? null, column.type))),
    typed: table,
  };
}

/**
 * Reads a dropped or pasted table from drag items (`event.items` of a drop, keyed by MIME
 * type): `mindoo.table@1` JSON first, then a Markdown table, then delimited text.
 */
export function readMindooTable(items: Record<string, string | undefined>): MindooTableCells | null {
  const json = items["application/json"];
  const text = items["text/plain"];
  const markdownText = items["text/markdown"];
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (isMindooTable(parsed)) return mindooTableCells(parsed);
    } catch {
      // Not JSON: try the text versions.
    }
  }
  const markdown = markdownText ? parseMarkdownTable(markdownText) : null;
  const cells = markdown ?? (text ? parseMarkdownTable(text) ?? parseDelimitedText(text) : null);
  if (!cells || cells.length === 0) return null;
  const [headers, ...rows] = cells;
  return { headers: headers!, rows, typed: null };
}
