/**
 * Rules for document ids an app chooses itself, as MindooDB enforces them
 * (`CUSTOM_DOC_ID_REGEX` / `DOC_ID_PREFIX_REGEX` in mindoodb's core types).
 * The mock database applies the same checks, so tests fail where Haven would.
 */

/**
 * A caller-provided document id (`documents.create({ id })`): a lowercase ASCII
 * letter first, then lowercase ASCII letters, digits or `_`. Generated ids
 * (ObjectIds, hex) may start with a digit, so never use one as a prefix as is.
 */
export const MINDOODB_CUSTOM_DOCUMENT_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * An `idPrefix` for generated ids: 1–10 lowercase ASCII letters or digits,
 * starting with a letter, no `_` (MindooDB appends `_<objectid>` itself).
 */
export const MINDOODB_DOCUMENT_ID_PREFIX_PATTERN = /^[a-z][a-z0-9]{0,9}$/;

/** Whether `id` is accepted as a caller-provided document id. */
export function isValidMindooDBDocumentId(id: string): boolean {
  return MINDOODB_CUSTOM_DOCUMENT_ID_PATTERN.test(id);
}

/**
 * A valid caller-provided document id from `prefix` and `parts`, joined with
 * `_`: each part lowercased, other characters replaced by `_`. `prefix` must
 * start with a lowercase letter (e.g. `documentId("game", workbookId, n)`).
 */
export function mindooDBDocumentId(prefix: string, ...parts: Array<string | number>): string {
  const id = [prefix, ...parts]
    .map((part) => String(part).toLowerCase().replace(/[^a-z0-9_]/g, "_"))
    .join("_");
  if (!isValidMindooDBDocumentId(id)) {
    throw new Error(`mindooDBDocumentId: prefix "${prefix}" must start with a lowercase letter`);
  }
  return id;
}

/**
 * Throws the host's error when `input` carries an invalid `id` or `idPrefix`.
 * `methodName` is the prefix of the message (Haven reports `createDocument`).
 */
export function assertValidMindooDBCreateIds(
  input: { id?: string; idPrefix?: string },
  methodName = "createDocument",
): void {
  if (input.id !== undefined && !isValidMindooDBDocumentId(input.id)) {
    throw new Error(
      `${methodName}: invalid document id "${input.id}". ` +
        `Custom document IDs must match ${MINDOODB_CUSTOM_DOCUMENT_ID_PATTERN.source}.`,
    );
  }
  if (input.idPrefix !== undefined && !MINDOODB_DOCUMENT_ID_PREFIX_PATTERN.test(input.idPrefix)) {
    throw new Error(
      `${methodName}: invalid idPrefix "${input.idPrefix}". ` +
        `ID prefixes must match ${MINDOODB_DOCUMENT_ID_PREFIX_PATTERN.source}.`,
    );
  }
}
