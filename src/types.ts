/**
 * Intermediate representation (IR) for a parsed recurrence schedule.
 *
 * Mirrors the dataclasses of the reference Python implementation. The parser
 * (EN/FR) produces an `IRSchedule`; the engine consumes it to compute occurrences.
 */

/** Time-of-day, 24h. `hour` 0..23, `minute` 0..59. */
export interface IRTime {
  hour: number;
  minute: number;
}

/** Calendar date (no time). `month` 1..12, `day` 1..31. */
export interface IRDate {
  year: number;
  month: number;
  day: number;
}

/** A one-shot local datetime (tz-naive; localized by the engine). */
export interface IRDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export type Frequency = "minutely" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";

export type RuleType = "rrule" | "oneshot";

export type WeekendShift = "none" | "next_monday" | "next_business_day";

export interface IRHolidaySpec {
  enabled: boolean;
  country: string | null;
}

/** An nth-weekday-of-month selector, e.g. {pos:-1, weekday:1} = "last Tuesday". */
export interface IRSetposWeekday {
  /** 1..5, or -1 for "last". */
  pos: number;
  /** Monday=0 .. Sunday=6. */
  weekday: number;
}

/** An inclusive excluded date range. */
export interface IRDateRange {
  start: IRDate;
  end: IRDate;
}

export interface IRExcept {
  /** Excluded weekdays, Monday=0 .. Sunday=6. */
  weekdays: number[];
  /** Excluded calendar dates. */
  dates: IRDate[];
  /** Excluded nth-weekday-of-month occurrences, e.g. "the last Tuesday of the month". */
  setpos_weekdays: IRSetposWeekday[];
  /** Excluded calendar months, 1..12 (e.g. "except in august"). */
  months: number[];
  /** Excluded days-of-month, 1..31 (e.g. "except the 15th"). */
  monthdays: number[];
  /** Excluded inclusive date ranges (e.g. "except between … and …"). */
  date_ranges: IRDateRange[];
  holidays: IRHolidaySpec;
}

export interface IRWindowDate {
  start: IRDate | null;
  end: IRDate | null;
  until: IRDate | null;
}

export interface IRBetweenTime {
  start: IRTime;
  end: IRTime;
}

export interface IRStep {
  minutes: number | null;
  hours: number | null;
}

export interface IRRule {
  type: RuleType;

  /** One-shot local datetime (only set when `type === "oneshot"`). */
  at: IRDateTime | null;

  // rrule fields
  freq: Frequency | null;
  interval: number;
  bymonth: number[] | null;
  /** Weekday list, Monday=0 .. Sunday=6. */
  byweekday: number[] | null;
  /** Day-of-month list, 1..31 or -1 (last). */
  bymonthday: number[] | null;
  /** Set position, 1..5 or -1 (last). */
  bysetpos: number[] | null;
  times: IRTime[];

  between_time: IRBetweenTime | null;
  step: IRStep | null;

  window_date: IRWindowDate | null;
  except_: IRExcept;
  weekend_shift: WeekendShift;
  /** Repetition limit: stop after this many occurrences from the series start
   *  (window start, else the engine anchor). `null` = unlimited. */
  count: number | null;
}

export interface IRSchedule {
  tz: string;
  rules: IRRule[];
  version: string;
}

/* ------------------------------------------------------------------ */
/* Factories (mirroring the dataclass defaults)                        */
/* ------------------------------------------------------------------ */

export function makeHolidaySpec(): IRHolidaySpec {
  return { enabled: false, country: null };
}

export function makeExcept(): IRExcept {
  return {
    weekdays: [],
    dates: [],
    setpos_weekdays: [],
    months: [],
    monthdays: [],
    date_ranges: [],
    holidays: makeHolidaySpec(),
  };
}

export function makeWindowDate(fields: Partial<IRWindowDate> = {}): IRWindowDate {
  return { start: null, end: null, until: null, ...fields };
}

export function makeRule(fields: Partial<IRRule> & { type: RuleType }): IRRule {
  return {
    at: null,
    freq: null,
    interval: 1,
    bymonth: null,
    byweekday: null,
    bymonthday: null,
    bysetpos: null,
    times: [],
    between_time: null,
    step: null,
    window_date: null,
    except_: makeExcept(),
    weekend_shift: "none",
    count: null,
    ...fields,
  };
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * Raised for empty / unsupported / structurally-invalid rules (zero interval,
 * unsupported public-holiday exclusion, impossible window, no occurrence in
 * horizon). Mirrors the reference `InvalidRuleError` (a `ValueError` subclass).
 */
export class InvalidRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRuleError";
  }
}

/**
 * Raised by `nextOccurrence` when the rule is well-formed but produces no
 * future occurrence (window ended / fully filtered out). Mirrors the
 * `RuntimeError` the reference implementation raises in that case.
 */
export class NoOccurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoOccurrenceError";
  }
}
