/**
 * EN -> IR (parser only).
 *
 * Best-effort pragmatic parser. Composed rules split ONLY on ", and" (so we
 * don't break "monday and thursday"). The regex ladder, its ordering, and the
 * suffix-stripping loop mirror the reference Python source exactly.
 */
import {
  type IRRule,
  type IRTime,
  type IRDate,
  type IRExcept,
  type IRWindowDate,
  type Frequency,
  makeExcept,
  makeRule,
  makeWindowDate,
} from "./types.js";

const TIME_RE = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;
const DATE_RE = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/;

export const WEEKDAY_MAP: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};
const WEEKDAYS = new Set(Object.keys(WEEKDAY_MAP));

const ORDINAL: Record<string, number> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
  last: -1,
};

const MONTH_MAP: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

export function parseTime(s: string): IRTime {
  const m = TIME_RE.exec(s.trim());
  if (!m) throw new Error(`Invalid time: '${s}'`);
  let h = parseInt(m[1]!, 10);
  const mi = parseInt(m[2] ?? "0", 10);
  const ampm = (m[3] ?? "").toLowerCase();

  if (!(mi >= 0 && mi <= 59)) throw new Error(`Invalid minute: '${s}'`);

  if (ampm) {
    if (!(h >= 1 && h <= 12)) throw new Error(`Invalid hour for am/pm: '${s}'`);
    if (h === 12) h = 0;
    if (ampm === "pm") h += 12;
  } else {
    if (!(h >= 0 && h <= 23)) throw new Error(`Invalid hour for 24h: '${s}'`);
  }

  return { hour: h, minute: mi };
}

export function parseDate(s: string): IRDate {
  const m = DATE_RE.exec(s.trim());
  if (!m) throw new Error(`Invalid date: '${s}' (expected YYYY-MM-DD)`);
  return { year: parseInt(m[1]!, 10), month: parseInt(m[2]!, 10), day: parseInt(m[3]!, 10) };
}

function requirePositive(n: number, text: string): number {
  // An interval/step of 0 (or less) makes the engine spin forever; reject early.
  if (n < 1) throw new Error(`Invalid interval/step (must be >= 1): '${text}'`);
  return n;
}

export function parseWeekdayList(text: string): string[] {
  const t = text.trim().toLowerCase().replace(/,/g, " ");
  return t
    .split(/\s+/)
    .filter((w) => w && w !== "and")
    .filter((w) => WEEKDAYS.has(w));
}

function normalizeTz(tz: string): string {
  return tz.trim().replace(/\\/g, "/").replace(/\s+/g, "");
}

function dateEq(a: IRDate, b: IRDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** Collapse all whitespace runs to single spaces and trim. */
function collapse(text: string): string {
  return text.trim().split(/\s+/).join(" ");
}

export function parseSchedule(text: string, defaultTz = "Europe/Paris") {
  let raw = collapse(text);

  let tz = defaultTz;
  const m = /\s+in\s+([A-Za-z_]+\/[A-Za-z_]+)\s*$/.exec(raw);
  if (m) {
    tz = normalizeTz(m[1]!);
    raw = raw.slice(0, m.index).trim();
  }

  // IMPORTANT: split composed rules ONLY on ", and"
  const ruleTexts = raw.split(/\s*,\s*and\s+/i);
  const rules: IRRule[] = ruleTexts
    .map((rt) => rt.trim())
    .filter((rt) => rt.length > 0)
    .map((rt) => parseRule(rt));
  return { tz, rules, version: "1" };
}

export function parseRule(text: string): IRRule {
  let sLower = collapse(text).toLowerCase();

  let weekendShift: IRRule["weekend_shift"] = "none";
  const window: IRWindowDate = makeWindowDate();
  const ex: IRExcept = makeExcept();

  const applyExcept = (exTextRaw: string): void => {
    const exText = exTextRaw.trim().toLowerCase();

    if (exText === "on public holidays" || exText === "public holidays") {
      ex.holidays.enabled = true;
      return;
    }

    for (const w of parseWeekdayList(exText)) {
      const idx = WEEKDAY_MAP[w]!;
      if (!ex.weekdays.includes(idx)) ex.weekdays.push(idx);
    }

    for (const token of exText.split(/[,\s]+/)) {
      if (DATE_RE.test(token)) {
        const d = parseDate(token);
        if (!ex.dates.some((e) => dateEq(e, d))) ex.dates.push(d);
      }
    }
  };

  // ---- strip suffixes in ANY order (loop until nothing changes) ----
  for (;;) {
    let changed = false;
    let mm: RegExpExecArray | null;

    mm = /\s+if\s+weekend\s+then\s+next\s+(monday|business day)\s*$/.exec(sLower);
    if (mm) {
      weekendShift = mm[1] === "monday" ? "next_monday" : "next_business_day";
      sLower = sLower.slice(0, mm.index).trim();
      changed = true;
    }

    mm = /\s+between\s+(\d{4}-\d{2}-\d{2})\s+and\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(sLower);
    if (mm) {
      window.start = parseDate(mm[1]!);
      window.end = parseDate(mm[2]!);
      sLower = sLower.slice(0, mm.index).trim();
      changed = true;
    }

    mm = /\s+until\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(sLower);
    if (mm) {
      window.until = parseDate(mm[1]!);
      sLower = sLower.slice(0, mm.index).trim();
      changed = true;
    }

    mm = /\s+except\s+(.+)$/.exec(sLower);
    if (mm) {
      const exText = mm[1]!.trim();
      // if it contains " at ", it's likely mid-except ("... except X at Y")
      if (/\s+at\s+/.test(exText)) {
        // leave for the mid-except handling below
      } else {
        applyExcept(exText);
        sLower = sLower.slice(0, mm.index).trim();
        changed = true;
      }
    }

    if (!changed) break;
  }

  // ---- mid-except: "... except XXX at ..." ----
  {
    const mm = /\s+except\s+(.+?)\s+at\s+/.exec(sLower);
    if (mm) {
      applyExcept(mm[1]!);
      sLower = sLower.slice(0, mm.index) + " at " + sLower.slice(mm.index + mm[0].length);
      sLower = collapse(sLower);
    }
  }

  const finish = (r: IRRule): IRRule => {
    r.window_date = window.start || window.end || window.until ? window : null;
    r.except_ = ex;
    r.weekend_shift = weekendShift;
    return r;
  };

  const timesFrom = (atPart: string): IRTime[] => {
    const cleaned = atPart.replace(/,/g, " ");
    return cleaned
      .split(/\s+/)
      .filter((c) => c && c.toLowerCase() !== "and")
      .map((c) => parseTime(c));
  };

  let m: RegExpExecArray | null;

  // ---- oneshot: YYYY-MM-DD at TIME ----
  m = /^(\d{4}-\d{2}-\d{2})\s+at\s+(.+)$/.exec(sLower);
  if (m) {
    const d = parseDate(m[1]!);
    const t = parseTime(m[2]!);
    const r = makeRule({
      type: "oneshot",
      at: { year: d.year, month: d.month, day: d.day, hour: t.hour, minute: t.minute },
    });
    r.window_date = { start: d, end: d, until: null };
    r.except_ = ex;
    r.weekend_shift = weekendShift;
    return r;
  }

  // ---- every year on MM-DD at T ----
  m = /^every\s+year\s+on\s+(\d{2})-(\d{2})\s+at\s+(.+)$/.exec(sLower);
  if (m) {
    const mmn = parseInt(m[1]!, 10);
    const dd = parseInt(m[2]!, 10);
    const at = parseTime(m[3]!);
    return finish(
      makeRule({
        type: "rrule",
        freq: "yearly",
        interval: 1,
        bymonth: [mmn],
        bymonthday: [dd],
        times: [at],
      }),
    );
  }

  // ---- every year (without date) ----
  m = /^every\s+year\b(?:\s+at\s+(.+))?$/.exec(sLower);
  if (m) {
    const times = m[1] ? timesFrom(m[1]) : [];
    return finish(makeRule({ type: "rrule", freq: "yearly", interval: 1, times }));
  }

  // ---- step within day: every day/weekday every N hours/minutes between t1 and t2 ----
  m =
    /^every\s+(day|weekday)\s+every\s+(\d+)\s+(hours|minutes)\s+between\s+(.+?)\s+and\s+(.+)$/.exec(
      sLower,
    );
  if (m) {
    const base = m[1]!;
    const n = requirePositive(parseInt(m[2]!, 10), text);
    const unit = m[3]!;
    const t1 = parseTime(m[4]!);
    const t2 = parseTime(m[5]!);
    const bywd = base === "weekday" ? [0, 1, 2, 3, 4] : null;
    const step = unit === "hours" ? { hours: n, minutes: null } : { hours: null, minutes: n };
    return finish(
      makeRule({
        type: "rrule",
        freq: "daily",
        interval: 1,
        byweekday: bywd,
        between_time: { start: t1, end: t2 },
        step,
      }),
    );
  }

  // ---- every N hours between t1 and t2 ----
  m = /^every\s+(\d+)\s+hours\s+between\s+(.+?)\s+and\s+(.+)$/.exec(sLower);
  if (m) {
    const n = requirePositive(parseInt(m[1]!, 10), text);
    const t1 = parseTime(m[2]!);
    const t2 = parseTime(m[3]!);
    return finish(
      makeRule({
        type: "rrule",
        freq: "hourly",
        interval: n,
        between_time: { start: t1, end: t2 },
      }),
    );
  }

  // ---- every hour between t1 and t2 ----
  m = /^every\s+hour\s+between\s+(.+?)\s+and\s+(.+)$/.exec(sLower);
  if (m) {
    const t1 = parseTime(m[1]!);
    const t2 = parseTime(m[2]!);
    return finish(
      makeRule({
        type: "rrule",
        freq: "hourly",
        interval: 1,
        between_time: { start: t1, end: t2 },
      }),
    );
  }

  // ---- every <n> units [on ...] [at ...] ----
  m = /^every\s+(\d+)\s+(minutes|hours|days|weeks)(?:\s+on\s+(.+?))?(?:\s+at\s+(.+))?$/.exec(
    sLower,
  );
  if (m) {
    const n = requirePositive(parseInt(m[1]!, 10), text);
    const unit = m[2]!;
    const onPart = (m[3] ?? "").trim();
    const atPart = (m[4] ?? "").trim();

    const freq: Frequency = (
      { minutes: "minutely", hours: "hourly", days: "daily", weeks: "weekly" } as const
    )[unit as "minutes" | "hours" | "days" | "weeks"];

    let bywd: number[] | null = null;
    if (onPart) {
      const wds = parseWeekdayList(onPart);
      if (wds.length) bywd = wds.map((w) => WEEKDAY_MAP[w]!);
    }

    const times = atPart ? timesFrom(atPart) : [];

    return finish(makeRule({ type: "rrule", freq, interval: n, byweekday: bywd, times }));
  }

  // ---- every minute/hour (singular, without number) ----
  m = /^every\s+(minute|hour)(?:\s+at\s+(.+))?$/.exec(sLower);
  if (m) {
    const unit = m[1]!;
    const freq: Frequency = unit === "minute" ? "minutely" : "hourly";
    const times = m[2] ? timesFrom(m[2]) : [];
    return finish(makeRule({ type: "rrule", freq, interval: 1, times }));
  }

  // ---- every weekday at ... ----
  m = /^every\s+weekday\s+at\s+(.+)$/.exec(sLower);
  if (m) {
    const times = timesFrom(m[1]!);
    return finish(
      makeRule({ type: "rrule", freq: "daily", interval: 1, byweekday: [0, 1, 2, 3, 4], times }),
    );
  }

  // ---- every day at ... ----
  m = /^every\s+day\s+at\s+(.+)$/.exec(sLower);
  if (m) {
    const times = timesFrom(m[1]!);
    return finish(makeRule({ type: "rrule", freq: "daily", interval: 1, times }));
  }

  // ---- every day (without time) ----
  m = /^every\s+day\b(?:\s+at\s+(.+))?$/.exec(sLower);
  if (m) {
    const times = m[1] ? timesFrom(m[1]) : [];
    return finish(makeRule({ type: "rrule", freq: "daily", interval: 1, times }));
  }

  // ---- every <weekday list> at ... ----
  m = /^every\s+(.+?)\s+at\s+(.+)$/.exec(sLower);
  if (m) {
    const daysPart = m[1]!.trim();
    const atPart = m[2]!.trim();
    const tokens = daysPart.split(/[,\s]+/).filter((t) => t && t !== "and");
    if (tokens.length && tokens.every((t) => WEEKDAYS.has(t))) {
      const times = timesFrom(atPart);
      return finish(
        makeRule({
          type: "rrule",
          freq: "weekly",
          interval: 1,
          byweekday: tokens.map((w) => WEEKDAY_MAP[w]!),
          times,
        }),
      );
    }
  }

  // ---- yearly: every year on the <ordinal> <weekday> of <month> [and <month>] at T ----
  m =
    /^every\s+year\s+on\s+the\s+(first|second|third|fourth|fifth|last)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+of\s+(.+?)\s+at\s+(.+)$/.exec(
      sLower,
    );
  if (m) {
    const pos = ORDINAL[m[1]!]!;
    const wd = WEEKDAY_MAP[m[2]!]!;
    const monthsStr = m[3]!.trim();
    const months: number[] = [];
    for (const monthNameRaw of monthsStr.split(/\s+and\s+/)) {
      const monthName = monthNameRaw.trim().toLowerCase();
      if (monthName in MONTH_MAP) months.push(MONTH_MAP[monthName]!);
    }
    if (!months.length) throw new Error(`Unsupported rule: '${text}'`);
    const at = parseTime(m[4]!);
    return finish(
      makeRule({
        type: "rrule",
        freq: "yearly",
        interval: 1,
        bymonth: months,
        byweekday: [wd],
        bysetpos: [pos],
        times: [at],
      }),
    );
  }

  // ---- yearly: every year on the <ordinal> <weekday> of <single month> at T ----
  m =
    /^every\s+year\s+on\s+the\s+(first|second|third|fourth|fifth|last)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+at\s+(.+)$/.exec(
      sLower,
    );
  if (m) {
    const pos = ORDINAL[m[1]!]!;
    const wd = WEEKDAY_MAP[m[2]!]!;
    const mmn = MONTH_MAP[m[3]!]!;
    const at = parseTime(m[4]!);
    return finish(
      makeRule({
        type: "rrule",
        freq: "yearly",
        interval: 1,
        bymonth: [mmn],
        byweekday: [wd],
        bysetpos: [pos],
        times: [at],
      }),
    );
  }

  // ---- every month (without date) ----
  m = /^every\s+month\b(?:\s+at\s+(.+))?$/.exec(sLower);
  if (m) {
    const times = m[1] ? timesFrom(m[1]) : [];
    return finish(makeRule({ type: "rrule", freq: "monthly", interval: 1, times }));
  }

  // ---- every month on the ... at ... ----
  m = /^every\s+month\s+on\s+the\s+(.+?)\s+at\s+(.+)$/.exec(sLower);
  if (m) {
    const onPart = m[1]!.trim();
    const at = parseTime(m[2]!.trim());

    let r: IRRule;
    if (onPart === "last day") {
      r = makeRule({ type: "rrule", freq: "monthly", interval: 1, bymonthday: [-1], times: [at] });
    } else {
      const nums = [...onPart.matchAll(/(\d{1,2})(?:st|nd|rd|th)?/g)].map((mt) => mt[1]!);
      if (nums.length && nums.every((x) => parseInt(x, 10) >= 1 && parseInt(x, 10) <= 31)) {
        r = makeRule({
          type: "rrule",
          freq: "monthly",
          interval: 1,
          bymonthday: nums.map((x) => parseInt(x, 10)),
          times: [at],
        });
      } else {
        const m2 =
          /^(first|second|third|fourth|fifth|last)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.exec(
            onPart,
          );
        if (!m2) throw new Error(`Unsupported rule: '${text}'`);
        const pos = ORDINAL[m2[1]!]!;
        const wd = WEEKDAY_MAP[m2[2]!]!;
        r = makeRule({
          type: "rrule",
          freq: "monthly",
          interval: 1,
          byweekday: [wd],
          bysetpos: [pos],
          times: [at],
        });
      }
    }

    return finish(r);
  }

  throw new Error(`Unsupported rule: '${text}'`);
}
