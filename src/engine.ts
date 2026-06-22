/**
 * IR -> next occurrence.
 *
 * Ported from the reference Python engine. All recurrence math runs on naive
 * wall-clock values (see walltime.ts); the target zone is applied only at the
 * boundary — to interpret the caller's `now` and to materialize the result as
 * an absolute `Date`.
 */
import { DateTime } from "luxon";

import {
  type IRRule,
  type IRSchedule,
  type IRWindowDate,
  type IRStep,
  type IRBetweenTime,
  InvalidRuleError,
  NoOccurrenceError,
} from "./types.js";
import { WallTime, lastDayOfMonth } from "./walltime.js";
import { RRule, RRuleSet } from "./rrule.js";
import { parseSchedule } from "./parser.js";

export interface OccurrenceOptions {
  /** Reference instant. A `Date` (absolute) or an ISO string (wall-clock in the
   *  schedule's zone). Defaults to the current time. */
  now?: Date | string;
  /** Default IANA zone used when the rule does not specify one. */
  tz?: string;
}

const DEFAULT_TZ = "Europe/Paris";

/* ------------------------------------------------------------------ */
/* Zone boundary helpers                                               */
/* ------------------------------------------------------------------ */

function nowToWall(now: Date | string | undefined, zone: string): WallTime {
  let dt: DateTime;
  if (now === undefined) {
    dt = DateTime.now().setZone(zone);
  } else if (typeof now === "string") {
    dt = DateTime.fromISO(now, { zone });
  } else {
    dt = DateTime.fromJSDate(now).setZone(zone);
  }
  if (!dt.isValid) throw new InvalidRuleError(`Invalid 'now' or timezone: ${zone}`);
  return WallTime.of(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second);
}

function wallToDate(wt: WallTime, zone: string): Date {
  return DateTime.fromObject(
    {
      year: wt.year,
      month: wt.month,
      day: wt.day,
      hour: wt.hour,
      minute: wt.minute,
      second: wt.second,
    },
    { zone },
  ).toJSDate();
}

/* ------------------------------------------------------------------ */
/* Engine internals (mirror the reference engine)                      */
/* ------------------------------------------------------------------ */

function rejectUnsupported(sched: IRSchedule, text: string): void {
  // Public-holidays exclusion is parseable but the engine has no holiday data
  // source, so it cannot be honoured. Reject up front with a clear error.
  for (const r of sched.rules) {
    if (r.except_.holidays.enabled) {
      throw new InvalidRuleError(
        `Public holidays exclusion is not supported yet for rule '${text}'`,
      );
    }
  }
}

function nextBusinessDay(d: WallTime): WallTime {
  let cur = d;
  while (cur.weekday >= 5) cur = cur.plusDays(1);
  return cur;
}

function windowDatetimes(w: IRWindowDate | null): [WallTime | null, WallTime | null] {
  if (!w) return [null, null];

  let startDt: WallTime | null = null;
  let endDt: WallTime | null = null;

  if (w.start) startDt = WallTime.of(w.start.year, w.start.month, w.start.day, 0, 0, 0);
  if (w.end) endDt = WallTime.of(w.end.year, w.end.month, w.end.day, 23, 59, 0);
  if (w.until) {
    const untilDt = WallTime.of(w.until.year, w.until.month, w.until.day, 23, 59, 0);
    endDt = endDt === null ? untilDt : untilDt.isBefore(endDt) ? untilDt : endDt;
  }

  return [startDt, endDt];
}

function applyWeekendShift(dt: WallTime, mode: IRRule["weekend_shift"]): WallTime {
  if (mode === "none") return dt;
  if (!dt.isWeekend()) return dt;
  if (mode === "next_monday") {
    let d = dt;
    while (d.weekday !== 0) d = d.plusDays(1);
    return dt.replace({ year: d.year, month: d.month, day: d.day });
  }
  if (mode === "next_business_day") {
    const d2 = nextBusinessDay(dt);
    return dt.replace({ year: d2.year, month: d2.month, day: d2.day });
  }
  return dt;
}

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/** Ordinal key for a calendar date, for cheap comparisons. */
function dayKey(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

/** True if `dt`'s calendar date is within [start, end] inclusive. */
function dateInRange(
  dt: WallTime,
  start: { year: number; month: number; day: number },
  end: { year: number; month: number; day: number },
): boolean {
  const k = dayKey(dt.year, dt.month, dt.day);
  return (
    k >= dayKey(start.year, start.month, start.day) && k <= dayKey(end.year, end.month, end.day)
  );
}

/** True if `dt` matches an excluded nth-weekday-of-month (e.g. "last Tuesday"). */
function isExcludedSetpos(dt: WallTime, rule: IRRule): boolean {
  for (const sw of rule.except_.setpos_weekdays) {
    if (dt.weekday !== sw.weekday) continue;
    if (sw.pos === -1) {
      if (dt.day + 7 > lastDayOfMonth(dt.year, dt.month)) return true;
    } else {
      const nth = Math.floor((dt.day - 1) / 7) + 1;
      if (nth === sw.pos) return true;
    }
  }
  return false;
}

function excluded(dt: WallTime, rule: IRRule): boolean {
  // hourly filter window (HOURLY + between_time only)
  if (rule.type === "rrule" && rule.freq === "hourly" && rule.between_time && rule.step === null) {
    const t = minutesOfDay(dt.hour, dt.minute);
    const lo = minutesOfDay(rule.between_time.start.hour, rule.between_time.start.minute);
    const hi = minutesOfDay(rule.between_time.end.hour, rule.between_time.end.minute);
    if (!(lo <= t && t <= hi)) return true;
  }

  if (rule.except_.weekdays.includes(dt.weekday)) return true;
  if (
    rule.except_.dates.some((d) => d.year === dt.year && d.month === dt.month && d.day === dt.day)
  )
    return true;
  if (isExcludedSetpos(dt, rule)) return true;
  if (rule.except_.months.includes(dt.month)) return true;
  if (rule.except_.monthdays.includes(dt.day)) return true;
  if (rule.except_.date_ranges.some((r) => dateInRange(dt, r.start, r.end))) return true;

  if (rule.except_.holidays.enabled) {
    throw new Error("Public holidays exclusion not implemented (plug holidays here).");
  }

  return false;
}

function buildRruleset(rule: IRRule, now: WallTime, wStart: WallTime | null): RRuleSet {
  const rs = new RRuleSet();
  let dtstart = (wStart ?? now).replace({ second: 0 });

  // Anchor nth-weekday monthly/yearly to the period start to avoid the
  // "first monday after now" bug.
  if ((rule.freq === "monthly" || rule.freq === "yearly") && rule.bysetpos && rule.byweekday) {
    if (rule.freq === "monthly") {
      dtstart = dtstart.replace({ day: 1, hour: 0, minute: 0 });
    } else {
      dtstart = dtstart.replace({ month: 1, day: 1, hour: 0, minute: 0 });
    }
  }

  const freq = rule.freq!;

  const addRr = (dt0: WallTime, hour: number | null = null, minute: number | null = null): void => {
    rs.rrule(
      new RRule({
        freq,
        interval: rule.interval,
        dtstart: dt0,
        bymonth: rule.bymonth,
        byweekday: rule.byweekday,
        bymonthday: rule.bymonthday,
        bysetpos: rule.bysetpos,
        byhour: hour,
        byminute: minute,
      }),
    );
  };

  // Step-within-day: base DAILY, expanded later
  if (rule.step !== null && rule.between_time !== null && rule.freq === "daily") {
    addRr(dtstart);
    return rs;
  }

  // Normal rules: 1 rrule per time
  if (rule.times.length) {
    for (const t of rule.times) {
      addRr(dtstart.replace({ hour: t.hour, minute: t.minute }), t.hour, t.minute);
    }
  } else {
    if (rule.freq === "daily") dtstart = dtstart.replace({ hour: 0, minute: 0 });
    addRr(dtstart);
  }

  return rs;
}

function stepAdvance(step: IRStep): (wt: WallTime) => WallTime {
  // A non-positive step never advances -> the step loop would run forever.
  if (step.hours !== null) {
    if (step.hours < 1) throw new InvalidRuleError("Invalid step: hours must be >= 1");
    const h = step.hours;
    return (wt) => wt.plusHours(h);
  }
  if (step.minutes !== null) {
    if (step.minutes < 1) throw new InvalidRuleError("Invalid step: minutes must be >= 1");
    const m = step.minutes;
    return (wt) => wt.plusMinutes(m);
  }
  throw new Error("Invalid step: missing hours/minutes");
}

function expandStepWithinDay(
  baseDt: WallTime,
  step: IRStep,
  between: IRBetweenTime,
  afterDt: WallTime,
): WallTime | null {
  const advance = stepAdvance(step);
  let cur = WallTime.of(
    baseDt.year,
    baseDt.month,
    baseDt.day,
    between.start.hour,
    between.start.minute,
  );
  const endDt = WallTime.of(
    baseDt.year,
    baseDt.month,
    baseDt.day,
    between.end.hour,
    between.end.minute,
  );

  while (!cur.isAfter(endDt)) {
    if (cur.isAfter(afterDt)) return cur;
    cur = advance(cur);
  }
  return null;
}

function nextOccurrenceWall(text: string, now: WallTime, defaultTz: string): WallTime {
  const sched: IRSchedule = parseSchedule(text, defaultTz);
  if (!sched.rules.length) throw new InvalidRuleError(`Empty or unsupported rule: '${text}'`);
  rejectUnsupported(sched, text);

  const candidates: WallTime[] = [];

  for (const r of sched.rules) {
    const [wStart, wEnd] = windowDatetimes(r.window_date);

    // oneshot
    if (r.type === "oneshot") {
      const at = r.at!;
      const dt = WallTime.of(at.year, at.month, at.day, at.hour, at.minute, 0);
      if (dt.isAfter(now) && !excluded(dt, r)) candidates.push(dt);
      continue;
    }

    // Non-positive interval makes the rrule loop spin forever; reject defensively.
    if ((r.interval || 0) < 1) {
      throw new InvalidRuleError(`Invalid interval (must be >= 1) for rule '${text}'`);
    }

    const rs = buildRruleset(r, now, wStart);

    // Repetition limit: the count-th occurrence from the series start caps the
    // effective window end (count applies to plain rrule rules, not step rules).
    let effectiveEnd = wEnd;
    if (r.count !== null && !(r.step && r.between_time)) {
      let cp = (wStart ?? now).replace({ second: 0 }).plusSeconds(-1);
      let cutoff: WallTime | null = null;
      for (let k = 0; k < r.count; k++) {
        const o = rs.after(cp, false);
        if (o === null) break;
        cutoff = o;
        cp = o;
      }
      if (cutoff !== null) {
        effectiveEnd = effectiveEnd && effectiveEnd.isBefore(cutoff) ? effectiveEnd : cutoff;
      }
    }

    let probe = now;
    let found = false;
    for (let i = 0; i < 500; i++) {
      const base = rs.after(probe, false);
      if (base === null) break;

      let dt = base;

      // Step-within-day
      if (r.step && r.between_time) {
        // If the rrule jumped to the next day, try the same-day base once.
        if (!dt.isSameDay(probe)) {
          const dayProbe = probe.replace({ hour: 0, minute: 0, second: 0 }).plusSeconds(-1);
          const baseToday = rs.after(dayProbe, false);
          if (baseToday !== null && baseToday.isSameDay(probe)) {
            dt = baseToday;
          }
        }

        const dt2 = expandStepWithinDay(dt, r.step, r.between_time, probe);
        if (dt2 === null) {
          const nextDay = dt.plusDays(1);
          probe = WallTime.of(nextDay.year, nextDay.month, nextDay.day, 0, 0, 0);
          continue;
        }
        dt = dt2;
      }

      dt = applyWeekendShift(dt, r.weekend_shift);

      if (wStart && dt.isBefore(wStart)) {
        probe = wStart.plusSeconds(-1);
        continue;
      }
      if (effectiveEnd && dt.isAfter(effectiveEnd)) break;

      if (excluded(dt, r)) {
        probe = dt.plusSeconds(1);
        continue;
      }

      candidates.push(dt);
      found = true;
      break;
    }
    void found;
  }

  if (!candidates.length) {
    throw new NoOccurrenceError("No next occurrence found (rules ended or filtered out).");
  }

  return candidates.reduce((a, b) => (a.isBefore(b) ? a : b));
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Compute the next occurrence strictly after `now`.
 *
 * Throws {@link InvalidRuleError} for empty / unsupported / structurally invalid
 * rules and {@link NoOccurrenceError} when a well-formed rule yields no future
 * occurrence. Returns an absolute `Date`.
 */
export function nextOccurrence(text: string, options: OccurrenceOptions = {}): Date {
  const defaultTz = options.tz ?? DEFAULT_TZ;
  const zone = parseSchedule(text, defaultTz).tz;
  const now = nowToWall(options.now, zone);
  const wall = nextOccurrenceWall(text, now, defaultTz);
  return wallToDate(wall, zone);
}

/**
 * Return up to `options.count` upcoming occurrences (default 10), each strictly
 * after the previous one. Stops early when the rule is exhausted (e.g. a window
 * ended or a repetition limit was reached).
 */
export function occurrences(
  text: string,
  options: OccurrenceOptions & { count?: number } = {},
): Date[] {
  const max = Math.max(0, Math.min(options.count ?? 10, 1000));
  const defaultTz = options.tz ?? DEFAULT_TZ;
  const zone = parseSchedule(text, defaultTz).tz;
  let cursor = nowToWall(options.now, zone);
  const out: Date[] = [];
  for (let i = 0; i < max; i++) {
    let dt: WallTime;
    try {
      dt = nextOccurrenceWall(text, cursor, defaultTz);
    } catch (exc) {
      if (exc instanceof NoOccurrenceError) break;
      throw exc;
    }
    out.push(wallToDate(dt, zone));
    cursor = dt;
  }
  return out;
}

/**
 * Validate that a rule is well-formed and has at least one occurrence within a
 * reasonable horizon. Returns `true` on success; throws {@link InvalidRuleError}
 * otherwise.
 */
export function validate(text: string, options: OccurrenceOptions = {}): true {
  const defaultTz = options.tz ?? DEFAULT_TZ;
  const sched: IRSchedule = parseSchedule(text, defaultTz);
  if (!sched.rules.length) throw new InvalidRuleError(`Empty or unsupported rule: '${text}'`);
  rejectUnsupported(sched, text);

  const zone = sched.tz;
  const now = nowToWall(options.now, zone).replace({ second: 0 });

  for (const r of sched.rules) {
    const [wStart, wEnd] = windowDatetimes(r.window_date);
    if (wStart && wEnd && wEnd.isBefore(wStart)) {
      throw new InvalidRuleError(`Invalid window: end < start for rule '${text}'`);
    }

    if (r.type === "oneshot") {
      const at = r.at!;
      const dt = WallTime.of(at.year, at.month, at.day, at.hour, at.minute, 0);
      if (r.except_.weekdays.includes(dt.weekday)) {
        throw new InvalidRuleError(`One-shot excluded by weekday exception for rule '${text}'`);
      }
      if (
        r.except_.dates.some((d) => d.year === dt.year && d.month === dt.month && d.day === dt.day)
      ) {
        throw new InvalidRuleError(`One-shot excluded by date exception for rule '${text}'`);
      }
      if (isExcludedSetpos(dt, r)) {
        throw new InvalidRuleError(
          `One-shot excluded by month-position exception for rule '${text}'`,
        );
      }
      if (
        r.except_.months.includes(dt.month) ||
        r.except_.monthdays.includes(dt.day) ||
        r.except_.date_ranges.some((rg) => dateInRange(dt, rg.start, rg.end))
      ) {
        throw new InvalidRuleError(`One-shot excluded by an exception for rule '${text}'`);
      }
      if (wStart && dt.isBefore(wStart)) {
        throw new InvalidRuleError(`One-shot before window start for rule '${text}'`);
      }
      if (wEnd && dt.isAfter(wEnd)) {
        throw new InvalidRuleError(`One-shot after window end for rule '${text}'`);
      }
      continue;
    }

    const horizonEnd = wEnd ?? now.plusDays(366);
    let dt: WallTime;
    try {
      dt = nextOccurrenceWall(text, now, defaultTz);
    } catch (exc) {
      if (exc instanceof NoOccurrenceError) {
        throw new InvalidRuleError(`No occurrence exists in horizon for rule '${text}'`);
      }
      throw exc;
    }

    if (dt.isAfter(horizonEnd)) {
      throw new InvalidRuleError(`No occurrence exists in horizon for rule '${text}'`);
    }
  }

  return true;
}
