/**
 * Placeholder values some agent clients send for optional fields.
 *
 * Several agents (Goose, for one) fill every optional property of a tool's
 * input schema: `""` for strings, `[]` for arrays, an object of such
 * placeholders for objects. A tool that reads "present" as "chosen" then
 * rejects the call ("pass only one of …") or acts on an empty id. Before a
 * call reaches `execute`, the SDK removes these placeholders from optional
 * properties, guided by the schema, so tools see the input the agent meant.
 *
 * Only values that cannot carry a choice are removed: `null`, blank strings,
 * empty arrays and objects left empty after their own placeholders are gone.
 * Numbers and booleans stay, since `0` and `false` are real values; tools
 * decide whether a zero means "not set" for them. Required properties and
 * properties the schema does not declare are kept as sent.
 *
 * @module agentInput
 */

type JsonSchema = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlaceholder(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

function normalizeValue(value: unknown, schema: unknown): unknown {
  if (!isPlainObject(schema)) return value;
  if (Array.isArray(value)) {
    const items = schema.items;
    return isPlainObject(items) ? value.map((item) => normalizeValue(item, items)) : value;
  }
  if (isPlainObject(value) && isPlainObject(schema.properties)) {
    return normalizeObject(value, schema);
  }
  return value;
}

function normalizeObject(input: Record<string, unknown>, schema: JsonSchema): Record<string, unknown> {
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string") : []);
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!(key in properties)) {
      result[key] = raw;
      continue;
    }
    const value = normalizeValue(raw, properties[key]);
    if (!required.has(key) && isPlaceholder(value)) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Returns `input` without the placeholder values agents send for optional
 * properties of `schema` (see the module comment). Does not change `input`.
 */
export function normalizeAgentToolInput(input: Record<string, unknown>, schema: Record<string, unknown>): Record<string, unknown> {
  return isPlainObject(input) ? normalizeObject(input, schema) : input;
}
