/**
 * Naive wall-clock datetime.
 *
 * The reference Python implementation carries a `tzinfo` on its datetimes but
 * performs *naive* wall-clock arithmetic: `aware_datetime + timedelta` advances
 * the wall-clock fields and keeps the same `tzinfo` (it does NOT normalize
 * across DST). Comparisons in the engine are always between datetimes tagged
 * with the same zone, so they reduce to wall-clock comparisons.
 *
 * We model that exactly with a single epoch-milliseconds value interpreted in
 * **UTC** (which has no DST), used purely as a wall-clock carrier. The real
 * target zone is only applied at the very end, when converting the resulting
 * wall-clock to an absolute `Date` (see engine `toDate`). This reproduces the
 * reference behaviour while keeping the arithmetic trivial and deterministic.
 */
export class WallTime {
  /** Epoch ms of the wall-clock fields interpreted in UTC. */
  readonly ms: number;

  private constructor(ms: number) {
    this.ms = ms;
  }

  static of(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): WallTime {
    return new WallTime(Date.UTC(year, month - 1, day, hour, minute, second, 0));
  }

  static fromMs(ms: number): WallTime {
    return new WallTime(ms);
  }

  get year(): number {
    return new Date(this.ms).getUTCFullYear();
  }
  get month(): number {
    return new Date(this.ms).getUTCMonth() + 1;
  }
  get day(): number {
    return new Date(this.ms).getUTCDate();
  }
  get hour(): number {
    return new Date(this.ms).getUTCHours();
  }
  get minute(): number {
    return new Date(this.ms).getUTCMinutes();
  }
  get second(): number {
    return new Date(this.ms).getUTCSeconds();
  }

  /** Python's `date.weekday()`: Monday=0 .. Sunday=6. */
  get weekday(): number {
    return (new Date(this.ms).getUTCDay() + 6) % 7;
  }

  /** Same calendar date, at 00:00:00. */
  startOfDay(): WallTime {
    return WallTime.of(this.year, this.month, this.day, 0, 0, 0);
  }

  /** Mirrors `datetime.replace(...)`: only the provided fields change. */
  replace(fields: {
    year?: number;
    month?: number;
    day?: number;
    hour?: number;
    minute?: number;
    second?: number;
  }): WallTime {
    return WallTime.of(
      fields.year ?? this.year,
      fields.month ?? this.month,
      fields.day ?? this.day,
      fields.hour ?? this.hour,
      fields.minute ?? this.minute,
      fields.second ?? this.second,
    );
  }

  plusDays(n: number): WallTime {
    return new WallTime(this.ms + n * 86_400_000);
  }
  plusHours(n: number): WallTime {
    return new WallTime(this.ms + n * 3_600_000);
  }
  plusMinutes(n: number): WallTime {
    return new WallTime(this.ms + n * 60_000);
  }
  plusSeconds(n: number): WallTime {
    return new WallTime(this.ms + n * 1_000);
  }

  /** True if this is on a Saturday or Sunday. */
  isWeekend(): boolean {
    return this.weekday >= 5;
  }

  /** ISO-ish wall-clock string, e.g. "2026-03-13T10:00:00". */
  toISO(): string {
    const p = (n: number, w = 2): string => String(n).padStart(w, "0");
    return (
      `${p(this.year, 4)}-${p(this.month)}-${p(this.day)}` +
      `T${p(this.hour)}:${p(this.minute)}:${p(this.second)}`
    );
  }

  equals(other: WallTime): boolean {
    return this.ms === other.ms;
  }
  isBefore(other: WallTime): boolean {
    return this.ms < other.ms;
  }
  isAfter(other: WallTime): boolean {
    return this.ms > other.ms;
  }
  isSameDay(other: WallTime): boolean {
    return this.year === other.year && this.month === other.month && this.day === other.day;
  }
}

/** Last calendar day (28..31) of the given month. */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(
    Date.UTC(month === 12 ? year + 1 : year, month % 12, 1) - 86_400_000,
  ).getUTCDate();
}

/** Add `months` to (year, month); returns the new [year, month] (1-based month). */
export function addMonths(year: number, month: number, months: number): [number, number] {
  const total = year * 12 + (month - 1) + months;
  return [Math.floor(total / 12), (((total % 12) + 12) % 12) + 1];
}
