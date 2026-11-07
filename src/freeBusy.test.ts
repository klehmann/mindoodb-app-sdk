import { describe, expect, it } from "vitest";

import { answerFreeBusyFromMock, mergeFreeBusyIntervals, normalizeFreeBusyRequest, unknownFreeBusy } from "./freeBusy";

const at = (time: string) => `2026-11-09T${time}:00.000Z`;

describe("mergeFreeBusyIntervals", () => {
  it("sorts, merges touching intervals of one status and clips to the range", () => {
    expect(
      mergeFreeBusyIntervals(
        [
          { start: at("11:00"), end: at("12:00"), status: "busy" },
          { start: at("07:00"), end: at("09:00"), status: "busy" },
          { start: at("10:00"), end: at("11:00"), status: "busy" },
        ],
        at("08:00"),
        at("11:30"),
      ),
    ).toEqual([
      { start: at("08:00"), end: at("09:00"), status: "busy" },
      { start: at("10:00"), end: at("11:30"), status: "busy" },
    ]);
  });

  it("the stronger status wins where intervals overlap", () => {
    expect(
      mergeFreeBusyIntervals([
        { start: at("13:00"), end: at("17:00"), status: "tentative" },
        { start: at("14:00"), end: at("15:00"), status: "busy" },
        { start: at("14:30"), end: at("16:00"), status: "oof" },
      ]),
    ).toEqual([
      { start: at("13:00"), end: at("14:00"), status: "tentative" },
      { start: at("14:00"), end: at("14:30"), status: "busy" },
      { start: at("14:30"), end: at("16:00"), status: "oof" },
      { start: at("16:00"), end: at("17:00"), status: "tentative" },
    ]);
  });

  it("drops invalid, empty and out-of-range intervals", () => {
    expect(
      mergeFreeBusyIntervals(
        [
          { start: "nonsense", end: at("10:00"), status: "busy" },
          { start: at("10:00"), end: at("10:00"), status: "busy" },
          { start: at("10:00"), end: at("11:00"), status: "free" as never },
          { start: at("20:00"), end: at("21:00"), status: "busy" },
        ],
        at("08:00"),
        at("18:00"),
      ),
    ).toEqual([]);
  });
});

describe("normalizeFreeBusyRequest", () => {
  it("rejects invalid times, reversed ranges, too many people and too many weeks", () => {
    expect(() => normalizeFreeBusyRequest({ usernames: [], from: "x", to: at("10:00") })).toThrow(TypeError);
    expect(() => normalizeFreeBusyRequest({ usernames: [], from: at("10:00"), to: at("09:00") })).toThrow(RangeError);
    expect(() =>
      normalizeFreeBusyRequest({ usernames: Array.from({ length: 51 }, (_, i) => `u${i}`), from: at("08:00"), to: at("09:00") }),
    ).toThrow(/50 people/);
    expect(() =>
      normalizeFreeBusyRequest({ usernames: ["a"], from: "2026-11-01T00:00:00Z", to: "2027-02-08T00:00:01Z" }),
    ).toThrow(/14 weeks/);
    expect(
      normalizeFreeBusyRequest({ usernames: [" a "], from: "2026-11-01T00:00:00+01:00", to: "2027-02-07T00:00:00+01:00" }),
    ).toMatchObject({ usernames: ["a"], from: "2026-10-31T23:00:00.000Z" });
  });
});

describe("answerFreeBusyFromMock", () => {
  it("answers in request order with unknown, unpublished and clipped busy times", () => {
    const people = [
      {
        username: "CN=Ben/O=Acme",
        busy: [
          { start: at("10:00"), end: at("11:00"), status: "busy" as const },
          { start: at("14:00"), end: at("15:00"), status: "tentative" as const },
          { start: "2026-11-20T10:00:00Z", end: "2026-11-20T11:00:00Z", status: "busy" as const },
        ],
        computedAt: "2026-11-01T08:00:00.000Z",
      },
      { username: "carla/acme", state: "unpublished" as const },
    ];
    const result = answerFreeBusyFromMock(
      people,
      { usernames: ["cn=carla/o=acme", "ben/acme", "cn=dora/o=acme"], from: at("00:00"), to: "2026-11-10T00:00:00Z" },
      () => new Date("2026-11-09T07:00:00Z"),
    );
    expect(result).toEqual([
      { username: "cn=carla/o=acme", state: "unpublished", busy: [], computedAt: "2026-11-09T07:00:00.000Z" },
      {
        username: "ben/acme",
        state: "ok",
        busy: [
          { start: at("10:00"), end: at("11:00"), status: "busy" },
          { start: at("14:00"), end: at("15:00"), status: "tentative" },
        ],
        computedAt: "2026-11-01T08:00:00.000Z",
      },
      { username: "cn=dora/o=acme", state: "unknown", busy: [] },
    ]);
  });

  it("marks the end of the published weeks and knows nothing after it", () => {
    const ben = {
      username: "CN=Ben/O=Acme",
      busy: [
        { start: at("10:00"), end: at("11:00"), status: "busy" as const },
        { start: "2026-11-20T10:00:00Z", end: "2026-11-20T11:00:00Z", status: "busy" as const },
      ],
      computedAt: "2026-11-01T08:00:00.000Z",
      publishedUntil: "2026-11-16T00:00:00Z",
    };
    const [partly] = answerFreeBusyFromMock([ben], { usernames: ["ben/acme"], from: at("00:00"), to: "2026-11-23T00:00:00Z" });
    expect(partly).toEqual({
      username: "ben/acme",
      state: "ok",
      busy: [{ start: at("10:00"), end: at("11:00"), status: "busy" }],
      computedAt: "2026-11-01T08:00:00.000Z",
      publishedUntil: "2026-11-16T00:00:00.000Z",
    });
    const [after] = answerFreeBusyFromMock([ben], { usernames: ["ben/acme"], from: "2026-11-16T00:00:00Z", to: "2026-11-23T00:00:00Z" });
    expect(after).toEqual({ username: "ben/acme", state: "unknown", busy: [] });
    const [inside] = answerFreeBusyFromMock([ben], { usernames: ["ben/acme"], from: at("00:00"), to: "2026-11-10T00:00:00Z" });
    expect(inside).not.toHaveProperty("publishedUntil");
  });

  it("unknownFreeBusy is everyone unknown", () => {
    expect(unknownFreeBusy(["a", "b"])).toEqual([
      { username: "a", state: "unknown", busy: [] },
      { username: "b", state: "unknown", busy: [] },
    ]);
  });
});
