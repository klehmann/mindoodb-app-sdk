import { expandAbbreviatedName } from "./canonicalNames";
import type {
  MindooDBAppFreeBusyInterval,
  MindooDBAppFreeBusyRequest,
  MindooDBAppFreeBusyResult,
  MindooDBAppFreeBusyStatus,
} from "./types";

/** At most this many people per `calendar.freeBusy({ … })` call. */
export const FREE_BUSY_MAX_USERS = 50;
/** At most this many weeks between `from` and `to`. */
export const FREE_BUSY_MAX_WEEKS = 14;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Rank when intervals overlap: absent wins over busy, busy over tentative. */
const STATUS_RANK: Record<MindooDBAppFreeBusyStatus, number> = { tentative: 1, busy: 2, oof: 3 };

/**
 * Checks a free/busy request as Haven does and returns it normalized (usernames
 * trimmed, duplicates kept so the answer still matches the request order).
 * Throws a `TypeError`/`RangeError` for invalid times, `to` before `from`, more
 * than {@link FREE_BUSY_MAX_USERS} people or more than {@link FREE_BUSY_MAX_WEEKS} weeks.
 */
export function normalizeFreeBusyRequest(request: MindooDBAppFreeBusyRequest): {
  usernames: string[];
  from: string;
  to: string;
  fromMs: number;
  toMs: number;
} {
  const usernames = Array.isArray(request?.usernames)
    ? request.usernames.map((username) => (typeof username === "string" ? username.trim() : ""))
    : [];
  const fromMs = Date.parse(request?.from);
  const toMs = Date.parse(request?.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    throw new TypeError("calendar.freeBusy: `from` and `to` must be ISO date-times.");
  }
  if (toMs < fromMs) {
    throw new RangeError("calendar.freeBusy: `to` is before `from`.");
  }
  if (toMs - fromMs > FREE_BUSY_MAX_WEEKS * WEEK_MS) {
    throw new RangeError(`calendar.freeBusy: at most ${FREE_BUSY_MAX_WEEKS} weeks per call.`);
  }
  if (usernames.length > FREE_BUSY_MAX_USERS) {
    throw new RangeError(`calendar.freeBusy: at most ${FREE_BUSY_MAX_USERS} people per call.`);
  }
  return {
    usernames,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    fromMs,
    toMs,
  };
}

/** What older hosts (without `calendar.freeBusy`) answer: nobody's times are known. */
export function unknownFreeBusy(usernames: readonly string[]): MindooDBAppFreeBusyResult[] {
  return usernames.map((username) => ({ username, state: "unknown" as const, busy: [] }));
}

/**
 * Busy intervals clipped to `[from, to)`, sorted, and merged where they overlap or
 * touch. Where two statuses overlap the stronger one wins (`oof` > `busy` >
 * `tentative`), so a busy hour inside a tentative afternoon splits it into three
 * pieces. Invalid or empty intervals are dropped. Times come back as ISO strings.
 */
export function mergeFreeBusyIntervals(
  intervals: readonly MindooDBAppFreeBusyInterval[],
  from?: string | number,
  to?: string | number,
): MindooDBAppFreeBusyInterval[] {
  const lower = from === undefined ? -Infinity : typeof from === "number" ? from : Date.parse(from);
  const upper = to === undefined ? Infinity : typeof to === "number" ? to : Date.parse(to);
  const pieces: Array<{ start: number; end: number; rank: number }> = [];
  for (const interval of intervals ?? []) {
    const rank = STATUS_RANK[interval?.status as MindooDBAppFreeBusyStatus];
    const start = Math.max(Date.parse(interval?.start), lower);
    const end = Math.min(Date.parse(interval?.end), upper);
    if (!rank || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    pieces.push({ start, end, rank });
  }
  if (!pieces.length) return [];
  // Sweep over all boundaries: each elementary segment takes the strongest status covering it.
  const bounds = [...new Set(pieces.flatMap((piece) => [piece.start, piece.end]))].sort((a, b) => a - b);
  const segments: Array<{ start: number; end: number; rank: number }> = [];
  for (let index = 0; index < bounds.length - 1; index++) {
    const start = bounds[index]!;
    const end = bounds[index + 1]!;
    let rank = 0;
    for (const piece of pieces) {
      if (piece.start <= start && piece.end >= end && piece.rank > rank) rank = piece.rank;
    }
    if (!rank) continue;
    const last = segments[segments.length - 1];
    if (last && last.end === start && last.rank === rank) {
      last.end = end;
    } else {
      segments.push({ start, end, rank });
    }
  }
  const statusOf = (rank: number) =>
    (Object.keys(STATUS_RANK) as MindooDBAppFreeBusyStatus[]).find((status) => STATUS_RANK[status] === rank)!;
  return segments.map((segment) => ({
    start: new Date(segment.start).toISOString(),
    end: new Date(segment.end).toISOString(),
    status: statusOf(segment.rank),
  }));
}

/** One person of the mock host's `freeBusy` option. */
export interface MockFreeBusyPerson {
  username: string;
  /** `"ok"` (default) publishes `busy`; `"unpublished"`: the person switched publishing off. */
  state?: "ok" | "unpublished";
  busy?: MindooDBAppFreeBusyInterval[];
  /** When the person's device last computed the times; defaults to "now" of the call. */
  computedAt?: string;
}

function personKey(username: string): string {
  return expandAbbreviatedName(username.trim()).toLowerCase();
}

/**
 * Answers a free/busy request from mock data the way Haven does: request order,
 * `unknown` for people not listed, `unpublished` without times, and the busy
 * times of everyone else clipped to the range and merged.
 */
export function answerFreeBusyFromMock(
  people: readonly MockFreeBusyPerson[],
  request: MindooDBAppFreeBusyRequest,
  now: () => Date = () => new Date(),
): MindooDBAppFreeBusyResult[] {
  const { usernames, fromMs, toMs } = normalizeFreeBusyRequest(request);
  const byName = new Map(people.map((person) => [personKey(person.username), person]));
  return usernames.map((username) => {
    const person = username ? byName.get(personKey(username)) : undefined;
    if (!person) return { username, state: "unknown" as const, busy: [] };
    const computedAt = person.computedAt ?? now().toISOString();
    if (person.state === "unpublished") return { username, state: "unpublished" as const, busy: [], computedAt };
    return {
      username,
      state: "ok" as const,
      busy: mergeFreeBusyIntervals(person.busy ?? [], fromMs, toMs),
      computedAt,
    };
  });
}
