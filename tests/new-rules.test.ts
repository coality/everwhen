/**
 * Tests for rules that extend beyond the reference grammar (not present in the
 * parity oracle): nth-weekday-of-month exclusions, multiple monthly ordinals,
 * weekend exclusions, and biweekly ("every other" / "un … sur deux").
 * Expected values are hand-computed.
 */
import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";

import { nextOccurrence, parseRule, parseSchedule } from "../src/index.js";

const TZ = "Europe/Paris";

function nextLocal(rule: string, now: string): string {
  const got = nextOccurrence(rule, { now });
  const tz = parseSchedule(rule, TZ).tz;
  return DateTime.fromJSDate(got).setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

describe("exception: nth weekday of month", () => {
  it("EN last-tuesday exclusion: a non-last tuesday is kept", () => {
    expect(
      nextLocal(
        "every tuesday at 09:30 except the last tuesday of the month",
        "2026-03-12T12:00:00",
      ),
    ).toBe("2026-03-17T09:30:00");
  });

  it("EN last-tuesday exclusion: the last tuesday is skipped to next month", () => {
    // 2026-03-31 is the last Tuesday of March -> skipped -> 2026-04-07 (1st Tue).
    expect(
      nextLocal(
        "every tuesday at 09:30 except the last tuesday of the month",
        "2026-03-25T00:00:00",
      ),
    ).toBe("2026-04-07T09:30:00");
  });

  it("FR last-tuesday exclusion (the requested rule)", () => {
    expect(
      nextLocal("tous les mardis à 09h30 sauf le dernier mardi du mois", "2026-03-12T12:00:00"),
    ).toBe("2026-03-17T09:30:00");
    expect(
      nextLocal("tous les mardis à 09h30 sauf le dernier mardi du mois", "2026-03-25T00:00:00"),
    ).toBe("2026-04-07T09:30:00");
  });

  it("EN first-monday exclusion is skipped", () => {
    // First Monday of April 2026 is the 6th -> skipped -> 13th.
    expect(
      nextLocal(
        "every monday at 08:00 except the first monday of the month",
        "2026-03-30T12:00:00",
      ),
    ).toBe("2026-04-13T08:00:00");
  });

  it("parses into setpos_weekdays", () => {
    const r = parseRule("every tuesday at 09:30 except the last tuesday of the month");
    expect(r.except_.setpos_weekdays).toEqual([{ pos: -1, weekday: 1 }]);
    expect(r.except_.weekdays).toEqual([]);
  });
});

describe("monthly: multiple ordinals", () => {
  it("EN first and third monday", () => {
    expect(
      nextLocal("every month on the first and third monday at 09:00", "2026-03-12T12:00:00"),
    ).toBe("2026-03-16T09:00:00");
  });

  it("EN second and fourth tuesday", () => {
    expect(
      nextLocal("every month on the second and fourth tuesday at 18:00", "2026-03-12T12:00:00"),
    ).toBe("2026-03-24T18:00:00");
  });

  it("FR premier et troisième lundi", () => {
    expect(
      nextLocal("tous les mois le premier et troisième lundi à 09h00", "2026-03-12T12:00:00"),
    ).toBe("2026-03-16T09:00:00");
  });

  it("parses into a bysetpos list", () => {
    const r = parseRule("every month on the first and third monday at 09:00");
    expect(r.bysetpos).toEqual([1, 3]);
    expect(r.byweekday).toEqual([0]);
  });
});

describe("exclude weekends", () => {
  it("EN: friday -> skips sat/sun -> monday", () => {
    expect(nextLocal("every day at 10:00 except weekends", "2026-03-13T12:00:00")).toBe(
      "2026-03-16T10:00:00",
    );
  });

  it("FR: sauf le week-end", () => {
    expect(nextLocal("tous les jours à 10h00 sauf le week-end", "2026-03-13T12:00:00")).toBe(
      "2026-03-16T10:00:00",
    );
  });

  it("parses to excluded weekdays 5,6", () => {
    expect(parseRule("every day at 10:00 except weekends").except_.weekdays).toEqual([5, 6]);
  });
});

describe("biweekly", () => {
  it("EN every other tuesday", () => {
    expect(nextLocal("every other tuesday at 09:00", "2026-03-12T12:00:00")).toBe(
      "2026-03-24T09:00:00",
    );
  });

  it("EN every other day", () => {
    expect(nextLocal("every other day at 10:00", "2026-03-12T12:00:00")).toBe(
      "2026-03-14T10:00:00",
    );
  });

  it("FR un mardi sur deux", () => {
    expect(nextLocal("un mardi sur deux à 09h00", "2026-03-12T12:00:00")).toBe(
      "2026-03-24T09:00:00",
    );
  });

  it("FR tous les deux jours", () => {
    expect(nextLocal("tous les deux jours à 10h00", "2026-03-12T12:00:00")).toBe(
      "2026-03-14T10:00:00",
    );
  });

  it("EN every other tuesday == every 2 weeks on tuesday", () => {
    const a = parseRule("every other tuesday at 09:00");
    expect(a.freq).toBe("weekly");
    expect(a.interval).toBe(2);
    expect(a.byweekday).toEqual([1]);
  });
});
