/**
 * Minimal RRULE engine ported from the reference implementation's vendored
 * recurrence module.
 *
 * NOTE: that module is NOT real python-dateutil — it is a small, self-contained
 * reimplementation with its own semantics (weekly anchored to the Monday of
 * dtstart's week and stepped by `interval` weeks; monthly/yearly `bysetpos`
 * collected per-month then index-picked; `timeFor` keeps the base H:M when no
 * byhour/byminute is given). Porting it verbatim is what guarantees parity, so
 * this module mirrors the reference structure method-for-method.
 *
 * Operates on `WallTime` (naive wall-clock) — see walltime.ts for why.
 */
import { WallTime, lastDayOfMonth, addMonths } from "./walltime.js";
import type { Frequency } from "./types.js";

// Weekday constants, Monday=0 .. Sunday=6 (matches Python's date.weekday()).
export const MO = 0;
export const TU = 1;
export const WE = 2;
export const TH = 3;
export const FR = 4;
export const SA = 5;
export const SU = 6;

/** Monday of the week containing `wt` (at the same time-of-day). */
function weekStart(wt: WallTime): WallTime {
  return wt.plusDays(-wt.weekday);
}

/** Deduplicate (by wall-clock instant) and sort ascending. */
function sortedUnique(items: WallTime[]): WallTime[] {
  const byMs = new Map<number, WallTime>();
  for (const it of items) byMs.set(it.ms, it);
  return [...byMs.values()].sort((a, b) => a.ms - b.ms);
}

export interface RRuleOptions {
  freq: Frequency;
  interval?: number;
  dtstart: WallTime;
  bymonth?: number[] | null;
  byweekday?: number[] | null;
  bymonthday?: number[] | null;
  bysetpos?: number[] | null;
  byhour?: number | null;
  byminute?: number | null;
}

export class RRule {
  readonly freq: Frequency;
  readonly interval: number;
  readonly dtstart: WallTime;
  readonly bymonth: number[] | null;
  readonly byweekday: number[] | null;
  readonly bymonthday: number[] | null;
  readonly bysetpos: number[] | null;
  readonly byhour: number | null;
  readonly byminute: number | null;

  constructor(opts: RRuleOptions) {
    this.freq = opts.freq;
    this.interval = opts.interval ?? 1;
    // dtstart.replace(second=0, microsecond=0)
    this.dtstart = opts.dtstart.replace({ second: 0 });
    this.bymonth = opts.bymonth && opts.bymonth.length ? [...opts.bymonth] : null;
    this.byweekday = opts.byweekday && opts.byweekday.length ? [...opts.byweekday] : null;
    this.bymonthday = opts.bymonthday && opts.bymonthday.length ? [...opts.bymonthday] : null;
    this.bysetpos = opts.bysetpos && opts.bysetpos.length ? [...opts.bysetpos] : null;
    this.byhour = opts.byhour ?? null;
    this.byminute = opts.byminute ?? null;
  }

  after(dt: WallTime, inc = false): WallTime | null {
    switch (this.freq) {
      case "minutely":
        return this.afterMinutely(dt, inc);
      case "hourly":
        return this.afterHourly(dt, inc);
      case "daily":
        return this.afterDaily(dt, inc);
      case "weekly":
        return this.afterWeekly(dt, inc);
      case "monthly":
        return this.afterMonthly(dt, inc);
      case "yearly":
        return this.afterYearly(dt, inc);
      default:
        throw new Error(`Unsupported frequency: ${this.freq as string}`);
    }
  }

  private timeFor(base: WallTime): WallTime {
    const hour = this.byhour ?? base.hour;
    const minute = this.byminute ?? base.minute;
    return base.replace({ hour, minute, second: 0 });
  }

  private afterMinutely(target: WallTime, inclusive: boolean): WallTime {
    let candidate = this.dtstart;
    while (candidate.isBefore(target) || (!inclusive && candidate.equals(target))) {
      candidate = candidate.plusMinutes(this.interval);
    }
    return candidate;
  }

  private afterHourly(target: WallTime, inclusive: boolean): WallTime {
    let candidate = this.dtstart;
    while (candidate.isBefore(target) || (!inclusive && candidate.equals(target))) {
      candidate = candidate.plusHours(this.interval);
    }
    return candidate;
  }

  private afterDaily(target: WallTime, inclusive: boolean): WallTime {
    let candidate = this.dtstart;
    while (candidate.isBefore(target) || (!inclusive && candidate.equals(target))) {
      candidate = candidate.plusDays(this.interval);
    }
    for (;;) {
      if (this.byweekday === null || this.byweekday.includes(candidate.weekday)) {
        return candidate;
      }
      candidate = candidate.plusDays(this.interval);
    }
  }

  private weeklyCandidatesForWeek(ws: WallTime): WallTime[] {
    const weekdays = this.byweekday ?? [this.dtstart.weekday];
    const candidates: WallTime[] = [];
    for (const wd of [...new Set(weekdays)].sort((a, b) => a - b)) {
      const day = ws.plusDays(wd);
      const dt = WallTime.of(day.year, day.month, day.day);
      candidates.push(this.timeFor(dt));
    }
    return candidates.sort((a, b) => a.ms - b.ms);
  }

  private afterWeekly(target: WallTime, inclusive: boolean): WallTime {
    const anchorWeek = weekStart(this.dtstart.startOfDay());
    let weeks = 0;
    for (;;) {
      const ws = anchorWeek.plusDays(this.interval * weeks * 7);
      for (const candidate of this.weeklyCandidatesForWeek(ws)) {
        if (candidate.isAfter(target) || (inclusive && candidate.equals(target))) {
          return candidate;
        }
      }
      weeks += 1;
    }
  }

  private monthCandidates(year: number, month: number): WallTime[] {
    if (this.bymonth && !this.bymonth.includes(month)) return [];

    const candidates: WallTime[] = [];
    if (this.bysetpos && this.byweekday) {
      const matches: { year: number; month: number; day: number }[] = [];
      const lastDay = lastDayOfMonth(year, month);
      // When bymonthday is also present, restrict the candidate days to it
      // (resolving negatives). This is the standard "last/first business day of
      // month" recipe: bymonthday=(-1,-2,-3), byweekday=MO..FR, bysetpos=-1.
      const dayInScope = (day: number): boolean => {
        if (!this.bymonthday) return true;
        return this.bymonthday.some((md) => (md < 0 ? lastDay + md + 1 : md) === day);
      };
      for (let day = 1; day <= lastDay; day++) {
        if (!dayInScope(day)) continue;
        const d = WallTime.of(year, month, day);
        if (this.byweekday.includes(d.weekday)) {
          matches.push({ year, month, day });
        }
      }
      for (const pos of this.bysetpos) {
        if (pos === 0) continue;
        const idx = pos > 0 ? pos - 1 : matches.length + pos;
        const chosen = matches[idx];
        if (!chosen) continue;
        candidates.push(this.timeFor(WallTime.of(chosen.year, chosen.month, chosen.day)));
      }
    } else if (this.bymonthday) {
      const lastDay = lastDayOfMonth(year, month);
      for (const day of this.bymonthday) {
        let d: WallTime;
        if (day === -1) {
          d = WallTime.of(year, month, lastDay);
        } else {
          if (!(day >= 1 && day <= lastDay)) continue;
          d = WallTime.of(year, month, day);
        }
        candidates.push(this.timeFor(d));
      }
    } else {
      candidates.push(this.timeFor(WallTime.of(year, month, this.dtstart.day)));
    }

    return sortedUnique(candidates);
  }

  private afterMonthly(target: WallTime, inclusive: boolean): WallTime {
    const anchorYear = this.dtstart.year;
    const anchorMonth = this.dtstart.month;
    let months = 0;
    for (;;) {
      const [year, month] = addMonths(anchorYear, anchorMonth, this.interval * months);
      for (const candidate of this.monthCandidates(year, month)) {
        if (candidate.isAfter(target) || (inclusive && candidate.equals(target))) {
          return candidate;
        }
      }
      months += 1;
    }
  }

  private yearCandidates(year: number): WallTime[] {
    const months = this.bymonth ?? [this.dtstart.month];
    const candidates: WallTime[] = [];
    for (const month of months) {
      candidates.push(...this.monthCandidates(year, month));
    }
    return candidates.sort((a, b) => a.ms - b.ms);
  }

  private afterYearly(target: WallTime, inclusive: boolean): WallTime {
    const anchorYear = this.dtstart.year;
    let years = 0;
    for (;;) {
      const year = anchorYear + this.interval * years;
      for (const candidate of this.yearCandidates(year)) {
        if (candidate.isAfter(target) || (inclusive && candidate.equals(target))) {
          return candidate;
        }
      }
      years += 1;
    }
  }
}

export class RRuleSet {
  private rules: RRule[] = [];

  rrule(rule: RRule): void {
    this.rules.push(rule);
  }

  after(dt: WallTime, inc = false): WallTime | null {
    let best: WallTime | null = null;
    for (const rule of this.rules) {
      const value = rule.after(dt, inc);
      if (value !== null && (best === null || value.isBefore(best))) {
        best = value;
      }
    }
    return best;
  }
}
