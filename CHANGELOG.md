# Changelog

All notable changes to **everwhen** are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-06-22

### Added

- **Long intervals:** `every N months/years`, `every quarter`, `every 6 months` /
  `every semester`, `every other month/year` — and the French forms
  `tous les N mois/ans`, `tous les trimestres/semestres`, `un mois sur deux`.
- **Weekday & weekend helpers:** `every weekend at …` / `tous les week-ends à …`;
  weekday ranges `every monday to friday` / `du lundi au vendredi`; first/last
  business day of the month `every month on the last/first weekday` /
  `le dernier/premier jour ouvré du mois`.
- **Time words:** `noon` / `midnight` and `midi` / `minuit`; the
  `from X to Y` / `de X à Y` alias for `between … and …`.
- **Enriched exceptions:** `except in <month>` / `sauf en <mois>`,
  `except the <Nth>` / `sauf le <N> du mois`,
  `except between <d1> and <d2>` / `sauf entre le … et le …`.
- **Fortnight & start date:** `every fortnight` / `tous les quinze jours`;
  `starting <date>` / `à partir du <date>`.
- **Repetition limit:** `… N times` / `… N fois`.
- **`occurrences(text, { now, tz, count })`** API returning the next N occurrences,
  honouring windows and repetition limits.

### Internal

- IR gains `IRExcept.months` / `monthdays` / `date_ranges`, `IRExcept.setpos_weekdays`,
  and `IRRule.count`.
- The RRULE engine now supports the combined `bymonthday + byweekday + bysetpos`
  recipe (last/first business day of month).
- 47 new hand-verified tests; the differential fuzzer (4101 checks) still matches
  the reference implementation exactly on the common grammar.

## [0.2.0] - 2026-06-22

### Added

- **Exclude the nth weekday of a month:** `except the last tuesday of the month` /
  `sauf le dernier mardi du mois`.
- **Multiple monthly ordinals:** `every month on the first and third monday` /
  `le premier et troisième lundi`.
- **Exclude weekends:** `except weekends` / `sauf le week-end`.
- **Biweekly:** `every other tuesday/day` / `un mardi sur deux`, `tous les deux jours`.
- A 500-case parity snapshot test frozen from a differential fuzz of 1367 unique
  rules against the reference implementation.

## [0.1.0] - 2026-06-22

### Added

- Initial release: a faithful TypeScript port of the `recpyx` Python library.
- Parse natural-language recurrence rules in **English and French** (with automatic
  language detection and cross-language fallback) into an IR.
- `nextOccurrence(text, { now, tz })` and `validate(text, …)`, plus the explicit
  parsers `parseSchedule` / `parseRule` (and the `…En` / `…Fr` variants).
- Daily / weekly / monthly / yearly recurrences, intervals, nth-weekday
  (`bysetpos`), day-of-month, sub-day steps, hourly windows, date windows,
  exceptions, weekend shift, one-shot and composed rules.
- Full engine + robustness parity matrix ported to vitest, passing identically to
  the reference implementation (English, French, timezones, calendar edge cases).

[0.3.0]: https://github.com/coality/everwhen/releases/tag/v0.3.0
[0.2.0]: https://github.com/coality/everwhen/releases/tag/v0.2.0
[0.1.0]: https://github.com/coality/everwhen/releases/tag/v0.1.0
