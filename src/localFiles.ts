/**
 * Rules shared by `session.localFiles`, the test host's mock and Haven: valid file
 * names and the error shape with a `code`.
 */
import type { MindooDBAppLocalFilesErrorCode } from "./types";

export const LOCAL_FILE_NAME_MAX = 200;

/** Why `name` is not a valid local file name, or null when it is. */
export function localFileNameProblem(name: unknown): string | null {
  if (typeof name !== "string" || !name) return "a name is required";
  if (name.length > LOCAL_FILE_NAME_MAX) return `names are at most ${LOCAL_FILE_NAME_MAX} characters`;
  for (const segment of name.split("/")) {
    if (!segment) return "empty path segment";
    if (segment === "." || segment === "..") return "\".\" and \"..\" are not allowed";
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) return "use letters, digits, \".\", \"_\" and \"-\" between \"/\"";
  }
  return null;
}

/** An Error carrying a `session.localFiles` error code. */
export function localFilesError(code: MindooDBAppLocalFilesErrorCode, message?: string): Error & { code: MindooDBAppLocalFilesErrorCode } {
  // `name` carries the code across the bridge (error payloads use the name).
  return Object.assign(new Error(message ?? code), { name: code, code });
}
