/**
 * Tests for the v0.3 rule additions (beyond the parity oracle): long intervals,
 * weekday/weekend helpers, time words, enriched exceptions, fortnight/start-date,
 * and repetition limits + the occurrences() API. Expected values are hand-computed
 * (reference NOW = 2026-03-12 12:00 Europe/Paris unless stated).
 */
import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";

import { nextOccurrence, occurrences, parseSchedule, NoOccurrenceError } from "../src/index.js";

const TZ = "Europe/Paris";
const NOW = "2026-03-12T12:00:00";

function nextLocal(rule: string, now: string = NOW): string {
  const got = nextOccurrence(rule, { now });
  const tz = parseSchedule(rule, TZ).tz;
  return DateTime.fromJSDate(got).setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

describe("group 1: long intervals", () => {
  const CASES: [string, string][] = [
    ["every 2 months on the 1st at 09:00", "2026-05-01T09:00:00"],
    ["every quarter on the 1st at 09:00", "2026-06-01T09:00:00"],
    ["every 6 months on the 15th at 08:00", "2026-03-15T08:00:00"],
    ["every 2 years on 03-14 at 10:00", "2026-03-14T10:00:00"],
    ["every 2 years on 03-01 at 10:00", "2028-03-01T10:00:00"],
    ["every other month at 09:00", "2026-05-12T09:00:00"],
    ["every other year", "2028-03-12T00:00:00"],
    ["tous les 2 mois le 1er à 09h00", "2026-05-01T09:00:00"],
    ["tous les 2 ans le 03-14 à 10h00", "2026-03-14T10:00:00"],
    ["un mois sur deux à 09h00", "2026-05-12T09:00:00"],
    ["tous les trimestres le 1er à 09h00", "2026-06-01T09:00:00"],
    ["tous les semestres le 15 à 08h00", "2026-03-15T08:00:00"],
  ];
  it.each(CASES)("%s -> %s", (rule, expected) => expect(nextLocal(rule)).toBe(expected));
});

describe("group 2: weekday / weekend", () => {
  const CASES: [string, string, string][] = [
    ["every weekend at 10:00", NOW, "2026-03-14T10:00:00"],
    ["every monday to friday at 09:00", NOW, "2026-03-13T09:00:00"],
    ["every month on the last weekday at 18:00", NOW, "2026-03-31T18:00:00"],
    ["every month on the last weekday at 18:00", "2026-05-01T00:00:00", "2026-05-29T18:00:00"],
    ["every month on the last weekday at 18:00", "2026-02-10T00:00:00", "2026-02-27T18:00:00"],
    ["every month on the first weekday at 09:00", NOW, "2026-04-01T09:00:00"],
    ["every month on the first weekday at 09:00", "2026-08-01T00:00:00", "2026-08-03T09:00:00"],
    ["the last weekday of the month at 18:00", NOW, "2026-03-31T18:00:00"],
    ["tous les week-ends à 10h00", NOW, "2026-03-14T10:00:00"],
    ["du lundi au vendredi à 09h00", NOW, "2026-03-13T09:00:00"],
    ["le dernier jour ouvré du mois à 18h00", NOW, "2026-03-31T18:00:00"],
    ["le premier jour ouvré du mois à 09h00", NOW, "2026-04-01T09:00:00"],
  ];
  it.each(CASES)("%s @ %s -> %s", (rule, now, expected) =>
    expect(nextLocal(rule, now)).toBe(expected),
  );
});

describe("group 3: time expressions", () => {
  const CASES: [string, string][] = [
    ["every day at noon", "2026-03-13T12:00:00"],
    ["every day at midnight", "2026-03-13T00:00:00"],
    ["every 2 hours from 09:00 to 17:00", "2026-03-12T14:00:00"],
    ["every day every 30 minutes from 12:00 to 14:00", "2026-03-12T12:30:00"],
    ["tous les jours à midi", "2026-03-13T12:00:00"],
    ["tous les jours à minuit", "2026-03-13T00:00:00"],
    ["toutes les 2 heures de 09h00 à 17h00", "2026-03-12T14:00:00"],
  ];
  it.each(CASES)("%s -> %s", (rule, expected) => expect(nextLocal(rule)).toBe(expected));
});

describe("group 4: enriched exceptions", () => {
  const CASES: [string, string, string][] = [
    ["every day at 10:00 except in august", "2026-08-01T00:00:00", "2026-09-01T10:00:00"],
    ["every month on the 15th at 08:00 except in march", NOW, "2026-04-15T08:00:00"],
    ["every day at 10:00 except the 15th", "2026-03-14T12:00:00", "2026-03-16T10:00:00"],
    ["every day at 10:00 except between 2026-03-13 and 2026-03-20", NOW, "2026-03-21T10:00:00"],
    ["tous les jours à 10h00 sauf en août", "2026-08-01T00:00:00", "2026-09-01T10:00:00"],
    ["tous les jours à 10h00 sauf le 15 du mois", "2026-03-14T12:00:00", "2026-03-16T10:00:00"],
    [
      "tous les jours à 10h00 sauf entre le 2026-03-13 et le 2026-03-20",
      NOW,
      "2026-03-21T10:00:00",
    ],
  ];
  it.each(CASES)("%s @ %s -> %s", (rule, now, expected) =>
    expect(nextLocal(rule, now)).toBe(expected),
  );
});

describe("group 5: fortnight / start-date / limit", () => {
  it.each([
    ["every fortnight at 09:00", "2026-03-26T09:00:00"],
    ["tous les quinze jours à 09h00", "2026-03-26T09:00:00"],
    ["every day at 09:00 starting 2026-04-01", "2026-04-01T09:00:00"],
    ["tous les jours à 09h00 à partir du 2026-04-01", "2026-04-01T09:00:00"],
    ["every day at 09:00 starting 2026-04-01 5 times", "2026-04-01T09:00:00"],
  ] as [string, string][])("%s -> %s", (rule, expected) => expect(nextLocal(rule)).toBe(expected));

  it("a repetition limit is exhausted past the last occurrence", () => {
    expect(() =>
      nextOccurrence("every day at 09:00 starting 2026-04-01 5 times", {
        now: "2026-04-10T00:00:00",
      }),
    ).toThrow(NoOccurrenceError);
  });
});

describe("occurrences() API", () => {
  const fmt = (d: Date) => DateTime.fromJSDate(d).setZone(TZ).toFormat("yyyy-MM-dd'T'HH:mm:ss");

  it("returns the next N occurrences", () => {
    const got = occurrences("every weekday at 09:00", { now: NOW, count: 6 }).map(fmt);
    expect(got).toEqual([
      "2026-03-13T09:00:00",
      "2026-03-16T09:00:00",
      "2026-03-17T09:00:00",
      "2026-03-18T09:00:00",
      "2026-03-19T09:00:00",
      "2026-03-20T09:00:00",
    ]);
  });

  it("stops at a repetition limit even if more are requested", () => {
    const got = occurrences("every day at 09:00 starting 2026-04-01 5 times", {
      now: NOW,
      count: 10,
    }).map(fmt);
    expect(got).toEqual([
      "2026-04-01T09:00:00",
      "2026-04-02T09:00:00",
      "2026-04-03T09:00:00",
      "2026-04-04T09:00:00",
      "2026-04-05T09:00:00",
    ]);
  });

  it("FR repetition limit via 'fois'", () => {
    const got = occurrences("tous les jours à 09h00 à partir du 2026-04-01 5 fois", {
      now: NOW,
      count: 10,
    });
    expect(got).toHaveLength(5);
  });
});
