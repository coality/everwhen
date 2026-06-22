/**
 * Robustness / edge-case regression tests. Companion to engine.test.ts.
 *
 * Pins down: malformed input never throws an unexpected type; zero/negative
 * interval and step are rejected instead of hanging; empty/unparseable
 * schedules raise InvalidRuleError; public-holidays exclusion is rejected in
 * both languages; and a handful of calendar edge cases resolve correctly.
 */
import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";

import {
  nextOccurrence,
  validate,
  parseRule,
  parseSchedule,
  InvalidRuleError,
} from "../src/index.js";

const TZ = "Europe/Paris";
const NOW = "2026-03-12T12:00:00";

const ZERO_INTERVAL_RULES = [
  "every 0 days at 10:00",
  "every 0 weeks at 10:00",
  "every 0 hours",
  "every 0 minutes",
  "every 0 hours between 09:00 and 17:00",
  "every day every 0 hours between 09:00 and 17:00",
  "every day every 0 minutes between 09:00 and 17:00",
  "every weekday every 0 minutes between 09:00 and 17:00",
];

describe("zero / negative interval & step", () => {
  it.each(ZERO_INTERVAL_RULES)("nextOccurrence rejects (no hang): %s", (rule) => {
    expect(() => nextOccurrence(rule, { now: NOW })).toThrow();
  });

  it.each(ZERO_INTERVAL_RULES)("validate rejects: %s", (rule) => {
    expect(() => validate(rule, { now: NOW })).toThrow();
  });

  it("parseRule refuses to build a hanging IR", () => {
    expect(() => parseRule("every 0 days at 10:00")).toThrow();
  });

  it("negative interval rejected (unsupported, not a crash)", () => {
    expect(() => nextOccurrence("every -1 days at 10:00", { now: NOW })).toThrow();
  });
});

const EMPTY_RULES = ["", "   ", "\t\n"];

describe("empty / malformed input", () => {
  it.each(EMPTY_RULES)("empty schedule raises InvalidRuleError: %j", (rule) => {
    expect(() => nextOccurrence(rule, { now: NOW })).toThrow(InvalidRuleError);
    expect(() => validate(rule, { now: NOW })).toThrow(InvalidRuleError);
  });

  const MALFORMED_RULES = [
    "garbage nonsense",
    "every",
    "every day at",
    "every day at 25:00",
    "every day at 10:99",
    "every day at 24:00",
    "every month on the 32nd at 10:00",
    "every month on the 0th at 10:00",
    "every 30 minutes between 09:00 and 17:00", // minutely-between not supported
  ];

  it.each(MALFORMED_RULES)("malformed input throws: %s", (rule) => {
    expect(() => nextOccurrence(rule, { now: NOW })).toThrow();
  });
});

const HOLIDAY_RULES = [
  "every day at 10:00 except on public holidays",
  "every day at 10:00 except public holidays",
  "tous les jours à 10h00 sauf les jours fériés",
  "tous les jours à 10h00 sauf jour férié",
];

describe("public-holidays exclusion (parseable but unsupported)", () => {
  it.each(HOLIDAY_RULES)("rejected with InvalidRuleError: %s", (rule) => {
    expect(() => nextOccurrence(rule, { now: NOW })).toThrow(InvalidRuleError);
    expect(() => validate(rule, { now: NOW })).toThrow(InvalidRuleError);
  });
});

function nextLocal(rule: string, now: string): string {
  const got = nextOccurrence(rule, { now });
  const tz = parseSchedule(rule, TZ).tz;
  return DateTime.fromJSDate(got).setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

describe("calendar edge cases", () => {
  const CASES: [string, string, string, string][] = [
    ["leap-feb29", "every year on 02-29 at 10:00", NOW, "2028-02-29T10:00:00"],
    [
      "31st-skips-april",
      "every month on the 31st at 20:00",
      "2026-04-01T00:00:00",
      "2026-05-31T20:00:00",
    ],
    [
      "last-day-feb",
      "every month on the last day at 20:00",
      "2026-02-10T00:00:00",
      "2026-02-28T20:00:00",
    ],
    [
      "fifth-monday-gap",
      "every month on the fifth monday at 09:00",
      "2026-04-01T00:00:00",
      "2026-06-29T09:00:00",
    ],
    [
      "weekend-shift-yearly",
      "every year on 07-04 at 09:00 if weekend then next monday",
      NOW,
      "2026-07-06T09:00:00",
    ],
  ];

  it.each(CASES)("%s", (_id, rule, now, expected) => {
    expect(nextLocal(rule, now)).toBe(expected);
  });
});
