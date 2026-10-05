import type { MindooDBAppListUsersOptions, MindooDBAppListUsersPage } from "./types";

/** Default and maximum page size of `directory.listUsers({ … })`. */
export const LIST_USERS_DEFAULT_LIMIT = 50;
export const LIST_USERS_MAX_LIMIT = 500;

/**
 * One page of a full username list: case-insensitive substring `query`, cursor = offset
 * into the filtered list. Used by the mock host, and by the bridge client when the
 * host answers a paged request with the full list (hosts without paging support).
 */
export function pageUsers(
  users: readonly string[],
  options: MindooDBAppListUsersOptions,
): MindooDBAppListUsersPage {
  const needle = options.query?.trim().toLocaleLowerCase();
  const filtered = needle
    ? users.filter((user) => user.toLocaleLowerCase().includes(needle))
    : [...users];
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit ?? LIST_USERS_DEFAULT_LIMIT)),
    LIST_USERS_MAX_LIMIT,
  );
  const offset = Math.max(0, Number.parseInt(options.cursor ?? "0", 10) || 0);
  const end = offset + limit;
  return {
    users: filtered.slice(offset, end),
    nextCursor: end < filtered.length ? String(end) : null,
  };
}
