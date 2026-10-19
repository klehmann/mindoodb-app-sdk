/**
 * What a host hands to an embedded component and gets back, beyond the document:
 *
 * - **Variables** (`embeds.open({ variables })`, `embed.setVariables`): named values
 *   the user can insert as fields ("Insert field ▸"), e.g. a contact's name and
 *   address. Word keeps them as MERGEFIELDs, text editors as `{{key}}`. Components
 *   that offer this declare `supports: ["variables"]`.
 * - **Templates** (`embeds.open({ template })`): a new document starts as a copy of
 *   another one; the component copies it (it knows its format). `supports: ["template"]`.
 * - **Export** (`embed.export({ format })`): the document as a file, e.g. a PDF to
 *   file with the record or a PNG preview. `supports: ["export:pdf", "export:png"]`.
 */

/** A value a host offers to insert, e.g. `{ key: "company.name", label: "Company", value: "Müller GmbH" }`. */
export interface MindooDBAppEmbedVariable {
  /** Stable name: letters, digits, `_` and `.`; how fields refer to it (`{{company.name}}`, `MERGEFIELD company.name`). */
  key: string;
  /** For the user, in their language. */
  label: string;
  /** The current value; `""` when the host has none (the field stays visible as a field). */
  value: string;
  /** For grouping in menus, e.g. "Company" or "Contact person". */
  group?: string;
}

export const MINDOODB_APP_EMBED_VARIABLES_MAX = 200;
const VARIABLE_KEY = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

/**
 * Variables as they may cross between apps: valid keys only, each once (the last
 * wins), texts shortened, at most {@link MINDOODB_APP_EMBED_VARIABLES_MAX}.
 */
export function normalizeMindooDBAppEmbedVariables(raw: unknown): MindooDBAppEmbedVariable[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const byKey = new Map<string, MindooDBAppEmbedVariable>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { key, label, value, group } = entry as Record<string, unknown>;
    if (typeof key !== "string" || !VARIABLE_KEY.test(key)) continue;
    const text = (input: unknown, max: number) => (typeof input === "string" ? input.slice(0, max) : "");
    byKey.delete(key);
    byKey.set(key, {
      key,
      label: text(label, 120).trim() || key,
      value: typeof value === "number" || typeof value === "boolean" ? String(value) : text(value, 4000),
      ...(typeof group === "string" && group.trim() ? { group: group.trim().slice(0, 80) } : {}),
    });
    if (byKey.size >= MINDOODB_APP_EMBED_VARIABLES_MAX) break;
  }
  return [...byKey.values()];
}

/**
 * `{{key}}` placeholders in `text` replaced by the variables' values; unknown keys
 * (and keys whose value is empty, unless `keepEmpty`) stay as they are.
 */
export function resolveMindooDBAppVariables(
  text: string,
  variables: readonly MindooDBAppEmbedVariable[],
  options: { keepEmpty?: boolean } = {},
): string {
  const values = new Map(variables.map((variable) => [variable.key, variable.value]));
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.-]{0,63})\s*\}\}/g, (match, key: string) => {
    const value = values.get(key);
    return value === undefined || (!value && !options.keepEmpty) ? match : value;
  });
}

/** A template for `embeds.open`: the document a new one starts as a copy of. */
export interface MindooDBAppEmbedTemplate {
  /** Host database that holds the template; default the database of the new document. */
  databaseId?: string;
  docId: string;
}

/** Formats `embed.export` knows by name; components may offer others (`export:<format>`). */
export type MindooDBAppEmbedExportFormat = "pdf" | "docx" | "xlsx" | "pptx" | "png" | "md" | "csv" | (string & {});

/** What a host asks `embed.export` for. */
export interface MindooDBAppEmbedExportRequest {
  format: MindooDBAppEmbedExportFormat;
  /** `png`: the largest width and height in CSS pixels (a preview); the component keeps the aspect ratio. */
  maxWidth?: number;
  maxHeight?: number;
}

/** What a component's export provider returns: the file, or the bytes with name and type. */
export type MindooDBAppEmbeddingExport =
  | Blob
  | { data: Blob | ArrayBuffer | Uint8Array; name?: string; mimeType?: string };

/** The export as it crosses between apps (Haven forwards it unchanged). */
export interface MindooDBAppEmbedExportPayload {
  data: ArrayBuffer;
  name: string;
  mimeType: string;
}

/** Exports larger than this are refused. */
export const MINDOODB_APP_EMBED_EXPORT_MAX_BYTES = 64 * 1024 * 1024;

const EXPORT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  md: "text/markdown",
  csv: "text/csv",
};

/** The media type a format stands for (`application/octet-stream` for unknown ones). */
export function mindooDBAppExportMimeType(format: string): string {
  return EXPORT_TYPES[format] ?? "application/octet-stream";
}

/** An export request as it may cross between apps. Throws without a usable format. */
export function normalizeMindooDBAppEmbedExportRequest(raw: unknown): MindooDBAppEmbedExportRequest {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const format = typeof input.format === "string" ? input.format.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(format)) {
    throw new Error("An export needs a format such as \"pdf\" or \"png\".");
  }
  const size = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.min(Math.round(number), 8192) : undefined;
  };
  const maxWidth = size(input.maxWidth);
  const maxHeight = size(input.maxHeight);
  return { format, ...(maxWidth ? { maxWidth } : {}), ...(maxHeight ? { maxHeight } : {}) };
}

/** A provider's result as a payload: bytes, a name with the format's extension, the media type. */
export async function mindooDBAppExportPayload(
  result: MindooDBAppEmbeddingExport,
  request: MindooDBAppEmbedExportRequest,
  baseName = "document",
): Promise<MindooDBAppEmbedExportPayload> {
  const blob = result instanceof Blob ? result : null;
  const data = blob ?? (result as { data: Blob | ArrayBuffer | Uint8Array }).data;
  const bytes =
    data instanceof Blob
      ? await data.arrayBuffer()
      : ArrayBuffer.isView(data)
        ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
        : data;
  // Checked structurally: an ArrayBuffer from another realm is not an instance of this one's.
  if (Object.prototype.toString.call(bytes) !== "[object ArrayBuffer]") {
    throw new Error("An export must be a Blob, an ArrayBuffer or a Uint8Array.");
  }
  if (bytes.byteLength > MINDOODB_APP_EMBED_EXPORT_MAX_BYTES) {
    throw new Error(`An export must not be larger than ${MINDOODB_APP_EMBED_EXPORT_MAX_BYTES / 1024 / 1024} MiB.`);
  }
  const named = blob ? (blob as Blob & { name?: string }).name : (result as { name?: string }).name;
  const mimeType =
    (!blob && (result as { mimeType?: string }).mimeType) || (blob?.type ? blob.type : "") || mindooDBAppExportMimeType(request.format);
  const name = (typeof named === "string" && named.trim() ? named.trim() : `${baseName}.${request.format}`).slice(0, 200);
  return { data: bytes, name, mimeType };
}

/** The payload as a `File` for the host. */
export function mindooDBAppExportFile(payload: MindooDBAppEmbedExportPayload): File {
  return new File([payload.data], payload.name, { type: payload.mimeType });
}
