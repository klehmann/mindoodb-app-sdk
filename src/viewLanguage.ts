import { parseMindooDBFormulaBooleanExpression } from "mindoodb-view-language";
import type { MindooDBAppBooleanExpression } from "mindoodb-view-language";
import type {
  MindooDB,
  MindooQueryOptions,
  MindooQueryResult,
  MindooQuerySortKey,
} from "mindoodb";

export {
  createViewLanguage,
  getMindooDBViewLanguageHelper,
  mindooDBViewLanguageHelpers,
  mindooDBViewLanguageHelpersByName,
} from "mindoodb-view-language";
export type {
  MindooDBAppFieldPath,
  MindooDBAppPathValue,
  MindooDBViewLanguageArgumentKind,
  MindooDBViewLanguageHelperArgument,
  MindooDBViewLanguageHelperCategory,
  MindooDBViewLanguageHelperMetadata,
} from "mindoodb-view-language";

/**
 * Thin convenience wrapper around `db.query()`: accepts the filter either
 * as a prebuilt expression (from `createViewLanguage()`) or as formula
 * source text, which is parsed with the shared formula parser.
 */
export async function queryDocuments(
  db: Pick<MindooDB, "query">,
  filter: MindooDBAppBooleanExpression | string,
  sortBy?: MindooQuerySortKey[],
  options?: MindooQueryOptions,
): Promise<MindooQueryResult> {
  if (!db.query) {
    throw new Error("This MindooDB instance does not support ad-hoc queries.");
  }
  const expression = typeof filter === "string"
    ? parseMindooDBFormulaBooleanExpression(filter)
    : filter;
  return db.query({ filter: expression, sortBy }, options);
}
