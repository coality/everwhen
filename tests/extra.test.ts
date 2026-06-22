/**
 * Extra coverage beyond the ported parity matrix: language detection &
 * fallback, IR shape stability, explicit `now` handling (string + Date),
 * composed min-candidate selection, and absolute-instant correctness.
 */
import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";

import {
  nextOccurrence,
  parseRule,
  parseSchedule,
  parseScheduleEn,
  parseScheduleFr,
  detectLanguage,
} from "../src/index.js";

describe("language detection", () => {
  it("detects French", () => {
    expect(detectLanguage("tous les jours à 10h00")).toBe("fr");
  });
  it("detects English", () => {
    expect(detectLanguage("every day at 10:00")).toBe("en");
  });
  it("ties resolve to English", () => {
    expect(detectLanguage("")).toBe("en");
  });
});

describe("cross-language fallback", () => {
  it("parses a French rule the detector tied on (falls back to FR)", () => {
    // "chaque année" carries no strong markers -> detector returns 'en',
    // EN parse fails, fallback to FR succeeds.
    const r = parseRule("chaque année");
    expect(r.type).toBe("rrule");
    expect(r.freq).toBe("yearly");
  });

  it("the unified parser yields the same IR as the explicit FR parser", () => {
    const a = parseSchedule("tous les jours à 10h00");
    const b = parseScheduleFr("tous les jours à 10h00");
    expect(a).toEqual(b);
  });
});

describe("IR shape stability", () => {
  it("one-shot", () => {
    const r = parseRule("2026-03-13 at 02:00");
    expect(r.type).toBe("oneshot");
    expect(r.at).toEqual({ year: 2026, month: 3, day: 13, hour: 2, minute: 0 });
    expect(r.window_date).toEqual({
      start: { year: 2026, month: 3, day: 13 },
      end: { year: 2026, month: 3, day: 13 },
      until: null,
    });
  });

  it("monthly nth-weekday (bysetpos)", () => {
    const r = parseRule("every month on the first monday at 09:00");
    expect(r.freq).toBe("monthly");
    expect(r.bysetpos).toEqual([1]);
    expect(r.byweekday).toEqual([0]);
    expect(r.times).toEqual([{ hour: 9, minute: 0 }]);
  });

  it("step-within-day", () => {
    const r = parseRule("every day every 2 hours between 09:00 and 17:00");
    expect(r.freq).toBe("daily");
    expect(r.step).toEqual({ hours: 2, minutes: null });
    expect(r.between_time).toEqual({
      start: { hour: 9, minute: 0 },
      end: { hour: 17, minute: 0 },
    });
  });

  it("FR interval (tous les 15 jours-style) maps to interval", () => {
    const r = parseScheduleEn("every 14 days at 09:00").rules[0]!;
    expect(r.interval).toBe(14);
    expect(r.freq).toBe("daily");
  });
});

describe("explicit now handling", () => {
  it("accepts an ISO string interpreted in the schedule zone", () => {
    const got = nextOccurrence("every day at 15:00", { now: "2026-03-12T12:00:00" });
    const local = DateTime.fromJSDate(got)
      .setZone("Europe/Paris")
      .toFormat("yyyy-MM-dd'T'HH:mm:ss");
    expect(local).toBe("2026-03-12T15:00:00");
  });

  it("accepts a JS Date (absolute instant)", () => {
    const now = DateTime.fromObject(
      { year: 2026, month: 3, day: 12, hour: 12, minute: 0 },
      { zone: "Europe/Paris" },
    ).toJSDate();
    const got = nextOccurrence("every day at 15:00", { now });
    const local = DateTime.fromJSDate(got)
      .setZone("Europe/Paris")
      .toFormat("yyyy-MM-dd'T'HH:mm:ss");
    expect(local).toBe("2026-03-12T15:00:00");
  });
});

describe("composed rules pick the earliest candidate", () => {
  it("min across rules", () => {
    const got = nextOccurrence("every weekday at 09:00, and every saturday at 10:30", {
      now: "2026-03-12T12:00:00",
    });
    const local = DateTime.fromJSDate(got)
      .setZone("Europe/Paris")
      .toFormat("yyyy-MM-dd'T'HH:mm:ss");
    expect(local).toBe("2026-03-13T09:00:00");
  });
});

describe("absolute-instant correctness", () => {
  it("returns the exact instant for a Paris rule", () => {
    const got = nextOccurrence("every day at 10:00", { now: "2026-03-12T12:00:00" });
    const expected = DateTime.fromObject(
      { year: 2026, month: 3, day: 13, hour: 10, minute: 0 },
      { zone: "Europe/Paris" },
    ).toJSDate();
    expect(got.getTime()).toBe(expected.getTime());
  });

  it("a zoned rule resolves to the correct absolute instant", () => {
    // 10:00 in New York, not in Paris.
    const got = nextOccurrence("every day at 10:00 in America/New_York", {
      now: "2026-03-12T12:00:00",
    });
    const expected = DateTime.fromObject(
      { year: 2026, month: 3, day: 13, hour: 10, minute: 0 },
      { zone: "America/New_York" },
    ).toJSDate();
    expect(got.getTime()).toBe(expected.getTime());
  });
});
