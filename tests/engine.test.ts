import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";

import { nextOccurrence, validate, parseSchedule, InvalidRuleError } from "../src/index.js";

const TZ = "Europe/Paris";
// Fixed reference instant: 2026-03-12 12:00 in Europe/Paris. Passed as a
// wall-clock string so it is interpreted in each rule's own zone (matching the
// reference test harness, where `now` is the same wall-clock in the candidate frame).
const NOW = "2026-03-12T12:00:00";

const CASES_EN: [string, string][] = [
  // --- Basics ---
  ["every sunday at 10AM", "2026-03-15T10:00:00"],
  ["every day at 3PM", "2026-03-12T15:00:00"],
  ["every day except wednesday at 10AM", "2026-03-13T10:00:00"],
  ["every 2 days at 10:00", "2026-03-14T10:00:00"],
  ["every 3 weeks on monday at 08:30", "2026-03-30T08:30:00"],
  ["every monday and thursday at 18:00", "2026-03-12T18:00:00"],
  ["every weekday at 09:00", "2026-03-13T09:00:00"],
  ["every day at 09:00 and 18:00", "2026-03-12T18:00:00"],
  ["every saturday at 10:00, 14:00, 18:00", "2026-03-14T10:00:00"],

  // --- Step within day window branch ---
  ["every day every 2 hours between 09:00 and 17:00", "2026-03-12T13:00:00"],
  ["every weekday every 2 hours between 09:00 and 17:00", "2026-03-12T13:00:00"],

  // --- HOURLY between_times ---
  ["every 2 hours between 09:00 and 17:00", "2026-03-12T14:00:00"],
  ["every hour between 18:00 and 23:00", "2026-03-12T18:00:00"],

  // --- Date windows ---
  ["every weekday at 15:00 between 2026-02-01 and 2026-03-31", "2026-03-12T15:00:00"],
  ["every day at 10:00 until 2026-12-31", "2026-03-13T10:00:00"],

  // --- Monthly day-of-month variants ---
  ["every month on the 1st at 09:00", "2026-04-01T09:00:00"],
  ["every month on the last day at 20:00", "2026-03-31T20:00:00"],
  ["every month on the 2nd and 15th at 08:00", "2026-03-15T08:00:00"],
  ["every month on the 15th at 08:00", "2026-03-15T08:00:00"],
  ["every month on the 31st at 20:00", "2026-03-31T20:00:00"],

  // --- Monthly nth weekday variants ---
  ["every month on the first monday at 09:00", "2026-04-06T09:00:00"],
  ["every month on the last friday at 18:00", "2026-03-27T18:00:00"],

  // --- Exceptions ---
  ["every day at 10:00 except 2026-03-13", "2026-03-14T10:00:00"],
  ["every day at 10:00 except 2026-12-25, 2026-01-01", "2026-03-13T10:00:00"],
  ["every weekday except friday at 09:00", "2026-03-16T09:00:00"],
  ["every day except wednesday and sunday at 10:00", "2026-03-13T10:00:00"],

  // --- Composed rules (min of candidates) ---
  ["every weekday at 09:00, and every saturday at 10:30", "2026-03-13T09:00:00"],
  ["every day at 18:00, and 2026-03-13 at 02:00", "2026-03-12T18:00:00"],

  // --- Weekend shift ---
  [
    "every month on the 1st at 09:00 between 2026-08-01 and 2026-08-31 if weekend then next monday",
    "2026-08-03T09:00:00",
  ],
  [
    "every month on the 1st at 09:00 between 2026-08-01 and 2026-08-31 if weekend then next business day",
    "2026-08-03T09:00:00",
  ],

  // --- Timezones ---
  ["every day at 10:00 in Europe/Paris", "2026-03-13T10:00:00"],
  ["every day at 10:00 in America/New_York", "2026-03-13T10:00:00"],

  // --- One-shot ---
  ["2026-03-13 at 2:00", "2026-03-13T02:00:00"],

  // --- Yearly ---
  ["every year on 03-14 at 10:00", "2026-03-14T10:00:00"],
  ["every year on 03-01 at 10:00", "2027-03-01T10:00:00"],
  ["every day", "2026-03-13T00:00:00"],
  ["every year", "2027-03-12T00:00:00"],
  ["every day except thursday at 18:00", "2026-03-13T18:00:00"],
  ["every day except friday at 18:00", "2026-03-12T18:00:00"],
  ["every day except wednesday and sunday at 10:00", "2026-03-13T10:00:00"],

  // --- except weekdays with weekday rule ---
  ["every weekday except thursday at 15:00", "2026-03-13T15:00:00"],
  ["every weekday except friday at 09:00", "2026-03-16T09:00:00"],
  ["every monday and thursday except thursday at 18:00", "2026-03-16T18:00:00"],

  // --- except at end (postfix) ---
  ["every day at 18:00 except thursday", "2026-03-13T18:00:00"],
  ["every weekday at 09:00 except friday", "2026-03-16T09:00:00"],

  // --- except dates (single + multiple) ---
  ["every day at 10:00 except 2026-03-13", "2026-03-14T10:00:00"],
  ["every day at 10:00 except 2026-03-13, 2026-03-14", "2026-03-15T10:00:00"],
  ["every day at 10:00 except 2026-03-13 2026-03-14", "2026-03-15T10:00:00"],

  // --- except dates on weekly rule ---
  ["every sunday at 10AM except 2026-03-15", "2026-03-22T10:00:00"],

  // --- except combined (weekday + date) ---
  ["every day except friday 2026-03-15 at 10:00", "2026-03-14T10:00:00"],
  ["every weekday except friday 2026-03-16 at 09:00", "2026-03-17T09:00:00"],

  // --- except with between window (step-within-day) ---
  ["every day every 2 hours between 09:00 and 17:00 except thursday", "2026-03-13T09:00:00"],
  ["every day every 2 hours between 09:00 and 17:00 except friday", "2026-03-12T13:00:00"],

  // --- except with HOURLY-between ---
  ["every 2 hours between 09:00 and 17:00 except thursday", "2026-03-13T10:00:00"],
  ["every hour between 18:00 and 23:00 except thursday", "2026-03-13T18:00:00"],

  ["every day at 18:00 until 2026-03-13 except 2026-03-12", "2026-03-13T18:00:00"],
  ["every day at 18:00 between 2026-03-12 and 2026-03-13 except 2026-03-12", "2026-03-13T18:00:00"],

  // --- composed rules: except applies per-rule (NOT global) ---
  ["every day at 18:00 except thursday, and 2026-03-13 at 02:00", "2026-03-13T02:00:00"],
  ["every day at 18:00 except friday, and 2026-03-13 at 02:00", "2026-03-12T18:00:00"],

  // --- monthly + except date ---
  ["every month on the 15th at 08:00 except 2026-03-15", "2026-04-15T08:00:00"],
  ["every month on the last day at 20:00 except 2026-03-31", "2026-04-30T20:00:00"],

  // --- nth weekday monthly + except date ---
  ["every month on the first monday at 09:00 except 2026-04-06", "2026-05-04T09:00:00"],

  // --- Daily + multi-times + except ---
  ["every day at 12:01", "2026-03-12T12:01:00"],
  ["every day at 12:00", "2026-03-13T12:00:00"],
  ["every day at 11:00, 12:30, 23:00", "2026-03-12T12:30:00"],
  ["every day except thursday at 12:30", "2026-03-13T12:30:00"],
  ["every day except thursday friday 2026-03-12 at 18:00", "2026-03-14T18:00:00"],
  ["every day at 18:00 except thursday", "2026-03-13T18:00:00"],
  ["every day at 18:00 except friday", "2026-03-12T18:00:00"],
  ["every day except friday 2026-03-15 at 18:00", "2026-03-12T18:00:00"],
  ["every day except thursday at 18:00 between 2026-03-12 and 2026-03-20", "2026-03-13T18:00:00"],
  [
    "every day at 18:00 between 2026-03-12 and 2026-03-15 except 2026-03-12, 2026-03-13",
    "2026-03-14T18:00:00",
  ],

  // --- Weekday rules + except ---
  ["every weekday at 12:30", "2026-03-12T12:30:00"],
  ["every weekday at 13:00 except thursday", "2026-03-13T13:00:00"],
  ["every weekday at 13:00 except friday", "2026-03-12T13:00:00"],
  ["every weekday at 09:00 except thursday", "2026-03-13T09:00:00"],
  ["every weekday at 09:00 except friday", "2026-03-16T09:00:00"],
  [
    "every weekday at 15:30 between 2026-03-01 and 2026-03-31 except thursday",
    "2026-03-13T15:30:00",
  ],
  ["every weekday at 15:30 until 2026-03-20 except 2026-03-13", "2026-03-12T15:30:00"],
  ["every weekday at 15:30 until 2026-03-20 except thursday", "2026-03-13T15:30:00"],
  [
    "every weekday at 09:00 between 2026-03-12 and 2026-03-16 except 2026-03-13",
    "2026-03-16T09:00:00",
  ],
  ["every weekday at 09:00 between 2026-03-12 and 2026-03-16 except friday", "2026-03-16T09:00:00"],

  // --- Step-within-day (DAILY expand) + excepts ---
  ["every day every 30 minutes between 12:00 and 14:00", "2026-03-12T12:30:00"],
  ["every day every 30 minutes between 12:00 and 14:00 except thursday", "2026-03-13T12:00:00"],
  ["every weekday every 30 minutes between 12:00 and 14:00", "2026-03-12T12:30:00"],
  ["every weekday every 30 minutes between 12:00 and 14:00 except thursday", "2026-03-13T12:00:00"],
  ["every weekday every 90 minutes between 08:00 and 12:00 except friday", "2026-03-16T08:00:00"],
  ["every day every 2 hours between 09:00 and 17:00 except thursday", "2026-03-13T09:00:00"],
  ["every day every 2 hours between 09:00 and 17:00 except 2026-03-13", "2026-03-12T13:00:00"],
  [
    "every day every 2 hours between 09:00 and 17:00 between 2026-03-12 and 2026-03-14 except 2026-03-13",
    "2026-03-12T13:00:00",
  ],
  [
    "every weekday every 2 hours between 09:00 and 17:00 between 2026-03-12 and 2026-03-14 except thursday",
    "2026-03-13T09:00:00",
  ],
  [
    "every weekday every 2 hours between 09:00 and 17:00 between 2026-03-12 and 2026-03-14 except friday",
    "2026-03-12T13:00:00",
  ],

  // --- HOURLY between window (filter) + except ---
  ["every 2 hours between 09:00 and 17:00", "2026-03-12T14:00:00"],
  ["every 2 hours between 09:00 and 17:00 except thursday", "2026-03-13T10:00:00"],
  ["every 3 hours between 08:00 and 23:00", "2026-03-12T15:00:00"],
  ["every 4 hours between 01:00 and 23:00 except thursday", "2026-03-13T04:00:00"],
  ["every hour between 12:00 and 14:00", "2026-03-12T13:00:00"],
  ["every hour between 12:00 and 14:00 except thursday", "2026-03-13T12:00:00"],
  ["every hour between 18:00 and 23:00 except thursday", "2026-03-13T18:00:00"],
  ["every 6 hours between 00:00 and 23:00", "2026-03-12T18:00:00"],

  // --- Minutes / hours pure intervals ---
  ["every 15 minutes", "2026-03-12T12:15:00"],
  ["every 45 minutes", "2026-03-12T12:45:00"],
  ["every minute", "2026-03-12T12:01:00"],
  ["every month", "2026-04-12T00:00:00"],
  ["every 6 hours", "2026-03-12T18:00:00"],
  ["every 6 hours except thursday", "2026-03-13T00:00:00"],

  // --- Monthly (day-of-month) + except + windows ---
  ["every month on the 12th at 12:30", "2026-03-12T12:30:00"],
  ["every month on the 12th at 18:00", "2026-03-12T18:00:00"],
  ["every month on the 13th at 10:00", "2026-03-13T10:00:00"],
  ["every month on the 31st at 20:00 except 2026-03-31", "2026-05-31T20:00:00"],
  ["every month on the 15th at 08:00 except 2026-03-15", "2026-04-15T08:00:00"],
  ["every month on the last day at 20:00 except 2026-03-31", "2026-04-30T20:00:00"],
  ["every month on the 12th and 14th at 18:00", "2026-03-12T18:00:00"],
  ["every month on the 31st at 20:00 except 2026-03-31 and 2026-05-31", "2026-07-31T20:00:00"],

  // --- Monthly nth weekday ---
  ["every month on the second thursday at 18:00", "2026-03-12T18:00:00"],
  ["every month on the second thursday at 09:00", "2026-04-09T09:00:00"],
  ["every month on the third friday at 08:00", "2026-03-20T08:00:00"],
  ["every month on the last monday at 07:15", "2026-03-30T07:15:00"],
  ["every month on the fifth monday at 09:00", "2026-03-30T09:00:00"],

  // --- Composed (min candidate wins) ---
  ["2026-03-12 at 13:00, and every day at 18:00", "2026-03-12T13:00:00"],
  ["every day at 18:00 except thursday, and every day at 17:00", "2026-03-12T17:00:00"],
  ["every day at 18:00 except friday, and 2026-03-13 at 02:00", "2026-03-12T18:00:00"],

  // --- Yearly ---
  ["every year on 03-12 at 12:30", "2026-03-12T12:30:00"],
  ["every year on 03-12 at 11:00", "2027-03-12T11:00:00"],
  ["every year on the last sunday of october at 23:00", "2026-10-25T23:00:00"],
  ["every year on the last sunday of march and october at 23:00", "2026-03-29T23:00:00"],
];

const CASES_FR: [string, string][] = [
  ["tous les dimanches à 10h", "2026-03-15T10:00:00"],
  ["tous les jours à 15h", "2026-03-12T15:00:00"],
  ["tous les jours sauf le mercredi à 10h", "2026-03-13T10:00:00"],
  ["tous les 2 jours à 10h00", "2026-03-14T10:00:00"],
  ["toutes les 3 semaines le lundi à 08h30", "2026-03-30T08:30:00"],
  ["tous les lundis et jeudis à 18h00", "2026-03-12T18:00:00"],
  ["tous les jours ouvrés à 09h00", "2026-03-13T09:00:00"],
  ["tous les jours à 09h00 et 18h00", "2026-03-12T18:00:00"],
  ["tous les samedis à 10h00, 14h00, 18h00", "2026-03-14T10:00:00"],
  ["tous les jours, toutes les 2 heures entre 09h00 et 17h00", "2026-03-12T13:00:00"],
  ["tous les jours ouvrés, toutes les 2 heures entre 09h00 et 17h00", "2026-03-12T13:00:00"],
  ["toutes les 2 heures entre 09h00 et 17h00", "2026-03-12T14:00:00"],
  ["toutes les heures entre 18h00 et 23h00", "2026-03-12T18:00:00"],
  ["tous les jours ouvrés à 15h00 entre le 2026-02-01 et le 2026-03-31", "2026-03-12T15:00:00"],
  ["tous les jours à 10h00 jusqu'au 2026-12-31", "2026-03-13T10:00:00"],
  ["tous les mois le 1er à 09h00", "2026-04-01T09:00:00"],
  ["tous les mois le dernier jour à 20h00", "2026-03-31T20:00:00"],
  ["tous les mois le 2 et le 15 à 08h00", "2026-03-15T08:00:00"],
  ["tous les mois le 15 à 08h00", "2026-03-15T08:00:00"],
  ["tous les mois le 31 à 20h00", "2026-03-31T20:00:00"],
  ["tous les mois le premier lundi à 09h00", "2026-04-06T09:00:00"],
  ["tous les mois le dernier vendredi à 18h00", "2026-03-27T18:00:00"],
  ["tous les jours à 10h00 sauf le 2026-03-13", "2026-03-14T10:00:00"],
  ["tous les jours à 10h00 sauf le 2026-12-25 et le 2026-01-01", "2026-03-13T10:00:00"],
  ["tous les jours ouvrés sauf le vendredi à 09h00", "2026-03-16T09:00:00"],
  ["tous les jours sauf le mercredi et le dimanche à 10h00", "2026-03-13T10:00:00"],
  ["tous les jours ouvrés à 09h00, et tous les samedis à 10h30", "2026-03-13T09:00:00"],
  ["tous les jours à 18h00, et le 2026-03-13 à 02h00", "2026-03-12T18:00:00"],
  [
    "tous les mois le 1er à 09h00 entre le 2026-08-01 et le 2026-08-31, si week-end alors lundi suivant",
    "2026-08-03T09:00:00",
  ],
  [
    "tous les mois le 1er à 09h00 entre le 2026-08-01 et le 2026-08-31, si week-end alors prochain jour ouvré",
    "2026-08-03T09:00:00",
  ],
  ["tous les jours à 10h00 (Europe/Paris)", "2026-03-13T10:00:00"],
  ["tous les jours à 10h00 (America/New_York)", "2026-03-13T10:00:00"],
  ["le 2026-03-13 à 02h00", "2026-03-13T02:00:00"],
  ["tous les ans le 03-14 à 10h00", "2026-03-14T10:00:00"],
  ["tous les ans le 03-01 à 10h00", "2027-03-01T10:00:00"],
  ["tous les ans", "2027-03-12T00:00:00"],
  ["chaque jour", "2026-03-13T00:00:00"],
  ["chaque année", "2027-03-12T00:00:00"],
  ["tous les jours sauf le jeudi à 18h00", "2026-03-13T18:00:00"],
  ["tous les jours sauf le vendredi à 18h00", "2026-03-12T18:00:00"],
  ["tous les jours ouvrés sauf le jeudi à 15h00", "2026-03-13T15:00:00"],
  ["tous les lundis et jeudis à 18h00 sauf le jeudi", "2026-03-16T18:00:00"],
  ["tous les jours à 18h00 sauf le jeudi", "2026-03-13T18:00:00"],
  ["tous les jours ouvrés à 09h00 sauf le vendredi", "2026-03-16T09:00:00"],
  ["tous les jours à 10h00 sauf le 2026-03-13 et le 2026-03-14", "2026-03-15T10:00:00"],
  ["tous les dimanches à 10h00 sauf le 2026-03-15", "2026-03-22T10:00:00"],
  ["tous les jours sauf le vendredi et sauf le 2026-03-15 à 10h00", "2026-03-14T10:00:00"],
  ["tous les jours ouvrés sauf le vendredi et sauf le 2026-03-16 à 09h00", "2026-03-17T09:00:00"],
  ["tous les jours, toutes les 2 heures entre 09h00 et 17h00 sauf le jeudi", "2026-03-13T09:00:00"],
  [
    "tous les jours, toutes les 2 heures entre 09h00 et 17h00 sauf le vendredi",
    "2026-03-12T13:00:00",
  ],
  ["toutes les 2 heures entre 09h00 et 17h00 sauf le jeudi", "2026-03-13T10:00:00"],
  ["toutes les heures entre 18h00 et 23h00 sauf le jeudi", "2026-03-13T18:00:00"],
  ["tous les jours à 18h00 jusqu'au 2026-03-13 sauf le 2026-03-12", "2026-03-13T18:00:00"],
  [
    "tous les jours à 18h00 entre le 2026-03-12 et le 2026-03-13 sauf le 2026-03-12",
    "2026-03-13T18:00:00",
  ],
  ["tous les jours à 18h00 sauf le jeudi, et le 2026-03-13 à 02h00", "2026-03-13T02:00:00"],
  ["tous les jours à 18h00 sauf le vendredi, et le 2026-03-13 à 02h00", "2026-03-12T18:00:00"],
  ["tous les mois le 15 à 08h00 sauf le 2026-03-15", "2026-04-15T08:00:00"],
  ["tous les mois le dernier jour à 20h00 sauf le 2026-03-31", "2026-04-30T20:00:00"],
  ["tous les mois le premier lundi à 09h00 sauf le 2026-04-06", "2026-05-04T09:00:00"],
  ["tous les jours à 12h01", "2026-03-12T12:01:00"],
  ["tous les jours à 12h00", "2026-03-13T12:00:00"],
  ["tous les jours à 11h00, 12h30, 23h00", "2026-03-12T12:30:00"],
  ["tous les jours sauf le jeudi à 12h30", "2026-03-13T12:30:00"],
  [
    "tous les jours sauf le jeudi et le vendredi, sauf le 2026-03-12 à 18h00",
    "2026-03-14T18:00:00",
  ],
  ["tous les jours à 18h00 sauf le vendredi", "2026-03-12T18:00:00"],
  ["tous les jours sauf le vendredi et sauf le 2026-03-15 à 18h00", "2026-03-12T18:00:00"],
  [
    "tous les jours sauf le jeudi à 18h00 entre le 2026-03-12 et le 2026-03-20",
    "2026-03-13T18:00:00",
  ],
  [
    "tous les jours à 18h00 entre le 2026-03-12 et le 2026-03-15 sauf le 2026-03-12 et le 2026-03-13",
    "2026-03-14T18:00:00",
  ],
  ["tous les jours ouvrés à 12h30", "2026-03-12T12:30:00"],
  ["tous les jours ouvrés à 13h00 sauf le jeudi", "2026-03-13T13:00:00"],
  ["tous les jours ouvrés à 13h00 sauf le vendredi", "2026-03-12T13:00:00"],
  ["tous les jours ouvrés à 09h00 sauf le jeudi", "2026-03-13T09:00:00"],
  ["tous les jours ouvrés à 09h00 sauf le vendredi", "2026-03-16T09:00:00"],
  [
    "tous les jours ouvrés à 15h30 entre le 2026-03-01 et le 2026-03-31 sauf le jeudi",
    "2026-03-13T15:30:00",
  ],
  ["tous les jours ouvrés à 15h30 jusqu'au 2026-03-20 sauf le 2026-03-13", "2026-03-12T15:30:00"],
  ["tous les jours ouvrés à 15h30 jusqu'au 2026-03-20 sauf le jeudi", "2026-03-13T15:30:00"],
  [
    "tous les jours ouvrés à 09h00 entre le 2026-03-12 et le 2026-03-16 sauf le 2026-03-13",
    "2026-03-16T09:00:00",
  ],
  [
    "tous les jours ouvrés à 09h00 entre le 2026-03-12 et le 2026-03-16 sauf le vendredi",
    "2026-03-16T09:00:00",
  ],
  ["tous les jours, toutes les 30 minutes entre 12h00 et 14h00", "2026-03-12T12:30:00"],
  [
    "tous les jours, toutes les 30 minutes entre 12h00 et 14h00 sauf le jeudi",
    "2026-03-13T12:00:00",
  ],
  ["tous les jours ouvrés, toutes les 30 minutes entre 12h00 et 14h00", "2026-03-12T12:30:00"],
  [
    "tous les jours ouvrés, toutes les 30 minutes entre 12h00 et 14h00 sauf le jeudi",
    "2026-03-13T12:00:00",
  ],
  [
    "tous les jours ouvrés, toutes les 90 minutes entre 08h00 et 12h00 sauf le vendredi",
    "2026-03-16T08:00:00",
  ],
  [
    "tous les jours, toutes les 2 heures entre 09h00 et 17h00 sauf le 2026-03-13",
    "2026-03-12T13:00:00",
  ],
  [
    "tous les jours, toutes les 2 heures entre 09h00 et 17h00 entre le 2026-03-12 et le 2026-03-14 sauf le 2026-03-13",
    "2026-03-12T13:00:00",
  ],
  [
    "tous les jours ouvrés, toutes les 2 heures entre 09h00 et 17h00 entre le 2026-03-12 et le 2026-03-14 sauf le jeudi",
    "2026-03-13T09:00:00",
  ],
  [
    "tous les jours ouvrés, toutes les 2 heures entre 09h00 et 17h00 entre le 2026-03-12 et le 2026-03-14 sauf le vendredi",
    "2026-03-12T13:00:00",
  ],
  ["toutes les 3 heures entre 08h00 et 23h00", "2026-03-12T15:00:00"],
  ["toutes les 4 heures entre 01h00 et 23h00 sauf le jeudi", "2026-03-13T04:00:00"],
  ["toutes les heures entre 12h00 et 14h00", "2026-03-12T13:00:00"],
  ["toutes les heures entre 12h00 et 14h00 sauf le jeudi", "2026-03-13T12:00:00"],
  ["toutes les 6 heures entre 00h00 et 23h00", "2026-03-12T18:00:00"],
  ["toutes les 15 minutes", "2026-03-12T12:15:00"],
  ["toutes les 45 minutes", "2026-03-12T12:45:00"],
  ["toutes les minutes", "2026-03-12T12:01:00"],
  ["chaque minute", "2026-03-12T12:01:00"],
  ["toutes les 6 heures", "2026-03-12T18:00:00"],
  ["toutes les 6 heures sauf le jeudi", "2026-03-13T00:00:00"],
  ["chaque mois", "2026-04-12T00:00:00"],
  ["tous les mois le 12 à 12h30", "2026-03-12T12:30:00"],
  ["tous les mois le 12 à 18h00", "2026-03-12T18:00:00"],
  ["tous les mois le 13 à 10h00", "2026-03-13T10:00:00"],
  ["tous les mois le 31 à 20h00 sauf le 2026-03-31", "2026-05-31T20:00:00"],
  ["tous les mois le dernier jour à 20h00 sauf le 2026-03-31", "2026-04-30T20:00:00"],
  ["tous les mois le 12 et le 14 à 18h00", "2026-03-12T18:00:00"],
  ["tous les mois le 31 à 20h00 sauf le 2026-03-31 et le 2026-05-31", "2026-07-31T20:00:00"],
  ["tous les mois le deuxième jeudi à 18h00", "2026-03-12T18:00:00"],
  ["tous les mois le deuxième jeudi à 09h00", "2026-04-09T09:00:00"],
  ["tous les mois le troisième vendredi à 08h00", "2026-03-20T08:00:00"],
  ["tous les mois le dernier lundi à 07h15", "2026-03-30T07:15:00"],
  ["tous les mois le cinquième lundi à 09h00", "2026-03-30T09:00:00"],
  ["le 2026-03-12 à 13h00, et tous les jours à 18h00", "2026-03-12T13:00:00"],
  ["tous les jours à 18h00 sauf le jeudi, et tous les jours à 17h00", "2026-03-12T17:00:00"],
  ["tous les jours à 18h00 sauf le vendredi, et le 2026-03-13 à 02h00", "2026-03-12T18:00:00"],
  ["tous les ans le 03-12 à 12h30", "2026-03-12T12:30:00"],
  ["tous les ans le 03-12 à 11h00", "2027-03-12T11:00:00"],
  ["tous les ans le dernier dimanche d'octobre à 23h00", "2026-10-25T23:00:00"],
  ["tous les ans le dernier dimanche de mars et octobre à 23h00", "2026-03-29T23:00:00"],
];

const INVALID_RULES: string[] = [
  "every day at 10:00 until 2026-03-13 except 2026-03-13",
  "every day at 18:00 between 2026-03-12 and 2026-03-12 except 2026-03-12",
];

function assertNextOccurrence(rule: string, expectedPrefix: string): void {
  validate(rule, { now: NOW });
  const got = nextOccurrence(rule, { now: NOW });
  const tz = parseSchedule(rule, TZ).tz;
  const local = DateTime.fromJSDate(got).setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm:ss");
  expect(local, `\nRule: ${rule}\nGot:  ${local}\nExp:  ${expectedPrefix}`).toContain(
    expectedPrefix,
  );
}

describe("next_occurrence (EN)", () => {
  it.each(CASES_EN)("%s -> %s", (rule, expected) => {
    assertNextOccurrence(rule, expected);
  });
});

describe("next_occurrence (FR)", () => {
  it.each(CASES_FR)("%s -> %s", (rule, expected) => {
    assertNextOccurrence(rule, expected);
  });
});

describe("invalid rules", () => {
  it.each(INVALID_RULES)("%s throws", (rule) => {
    expect(() => validate(rule, { now: NOW })).toThrow(InvalidRuleError);
  });
});
