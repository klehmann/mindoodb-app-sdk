import { expandAbbreviatedName } from "./canonicalNames";
import type {
  MindooDBAppCalendarShareLevel,
  MindooDBAppColleagueCalendar,
  MindooDBAppColleagueEvent,
  MindooDBAppSharedCalendar,
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
  /**
   * Calendar sharing (`calendar.colleagueEvents`): what the person shares with
   * the app's user. Default `"busy"` (free/busy only).
   */
  level?: MindooDBAppCalendarShareLevel;
  /**
   * The person's appointments for `calendar.colleagueEvents`. `private: true`
   * ones show only at level `"all"`; at `"business"` they count as busy.
   */
  events?: Array<Omit<MindooDBAppColleagueEvent, "key"> & { key?: string; private?: boolean }>;
  /** `"ok"` (default) publishes `busy`; `"unpublished"`: the person switched publishing off. */
  state?: "ok" | "unpublished";
  busy?: MindooDBAppFreeBusyInterval[];
  /** When the person's device last computed the times; defaults to "now" of the call. */
  computedAt?: string;
  /**
   * End of the published weeks (ISO): a request past it gets `publishedUntil`
   * and no times after it, one entirely after it answers "unknown". Default: no end.
   */
  publishedUntil?: string;
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
    const until = person.publishedUntil ? Date.parse(person.publishedUntil) : NaN;
    if (Number.isFinite(until) && fromMs >= until) return { username, state: "unknown" as const, busy: [] };
    const past = Number.isFinite(until) && toMs > until;
    return {
      username,
      state: "ok" as const,
      busy: mergeFreeBusyIntervals(person.busy ?? [], fromMs, past ? until : toMs),
      computedAt,
      ...(past ? { publishedUntil: new Date(until).toISOString() } : {}),
    };
  });
}

/** At most this many people per `calendar.colleagueEvents({ … })` call. */
export const COLLEAGUE_EVENTS_MAX_USERS = 20;

/** What older hosts (without `calendar.colleagueEvents`) answer: nothing shared. */
export function unsharedCalendars(usernames: readonly string[]): MindooDBAppColleagueCalendar[] {
  return usernames.map((username) => ({ username, level: "none" as const, state: "unknown" as const, events: [], busy: [] }));
}

/** `intervals` minus the times of `cover` (both ISO), merged. */
export function subtractFreeBusyIntervals(
  intervals: readonly MindooDBAppFreeBusyInterval[],
  cover: ReadonlyArray<{ start: string; end: string }>,
): MindooDBAppFreeBusyInterval[] {
  const blocks = cover
    .map((item) => ({ start: Date.parse(item.start), end: Date.parse(item.end) }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start);
  const result: MindooDBAppFreeBusyInterval[] = [];
  for (const interval of mergeFreeBusyIntervals(intervals)) {
    const end = Date.parse(interval.end);
    let start = Date.parse(interval.start);
    for (const block of blocks) {
      if (block.end <= start || block.start >= end) continue;
      if (block.start > start) result.push({ ...interval, start: new Date(start).toISOString(), end: new Date(block.start).toISOString() });
      start = Math.max(start, block.end);
      if (start >= end) break;
    }
    if (start < end) result.push({ ...interval, start: new Date(start).toISOString() });
  }
  return result;
}

const LEVEL_RANK: Record<MindooDBAppCalendarShareLevel, number> = { none: 0, busy: 1, business: 2, all: 3 };

/**
 * Answers a `calendar.colleagueEvents` request from mock data the way Haven
 * does: at `"business"` the person's non-private appointments in detail, at
 * `"all"` all of them, and everything not shown in detail as busy.
 */
export function answerColleagueEventsFromMock(
  people: readonly MockFreeBusyPerson[],
  request: MindooDBAppFreeBusyRequest,
  now: () => Date = () => new Date(),
): MindooDBAppColleagueCalendar[] {
  const { usernames, fromMs, toMs } = normalizeFreeBusyRequest(request);
  if (usernames.length > COLLEAGUE_EVENTS_MAX_USERS) {
    throw new RangeError(`calendar.colleagueEvents: at most ${COLLEAGUE_EVENTS_MAX_USERS} people per call.`);
  }
  const busyAnswers = answerFreeBusyFromMock(people, request, now);
  const byName = new Map(people.map((person) => [personKey(person.username), person]));
  return usernames.map((username, index) => {
    const person = username ? byName.get(personKey(username)) : undefined;
    const busy = busyAnswers[index]!;
    if (!person || busy.state !== "ok") return { username, level: "none" as const, state: busy.state, events: [], busy: [] };
    const level = person.level ?? "busy";
    if (level === "none") return { username, level, state: "unknown" as const, events: [], busy: [] };
    const inRange = (person.events ?? []).filter(
      (event) => Date.parse(event.end) > fromMs && Date.parse(event.start) < toMs,
    );
    const shown = LEVEL_RANK[level] >= LEVEL_RANK.business
      ? inRange.filter((event) => !event.private || level === "all")
      : [];
    const hidden = inRange.filter((event) => !shown.includes(event) && event.status !== "free");
    const events: MindooDBAppColleagueEvent[] = shown
      .map((event, position) => {
        const { private: _private, ...rest } = event;
        return { ...rest, key: event.key ?? `mock-${index}-${position}` };
      })
      .sort((a, b) => a.start.localeCompare(b.start));
    const all = [
      ...busy.busy,
      ...hidden.map((event) => ({ start: event.start, end: event.end, status: event.status as MindooDBAppFreeBusyStatus })),
    ];
    return {
      username,
      level,
      state: "ok" as const,
      events,
      busy: subtractFreeBusyIntervals(mergeFreeBusyIntervals(all, fromMs, toMs), events.filter((event) => event.status !== "free")),
      ...(busy.computedAt ? { computedAt: busy.computedAt } : {}),
    };
  });
}

/** `calendar.sharedCalendars` from mock data: people at `"business"` or `"all"`. */
export function answerSharedCalendarsFromMock(people: readonly MockFreeBusyPerson[]): MindooDBAppSharedCalendar[] {
  return people
    .filter((person) => person.level === "business" || person.level === "all")
    .map((person) => ({ username: person.username, level: person.level as "business" | "all" }));
}
