# everwhen

Parse **natural-language recurrence rules** (English **and** French) and compute their
occurrences. Small, dependency-light, strict TypeScript (ESM).

```ts
import { nextOccurrence, validate } from "everwhen";

nextOccurrence("every weekday at 09:00", { now: "2026-03-12T12:00:00" });
// -> Date for 2026-03-13 09:00 (Europe/Paris)

nextOccurrence("tous les mois le dernier vendredi à 18h00", { now: "2026-03-12T12:00:00" });
// -> Date for 2026-03-27 18:00

validate("every day at 10:00 until 2026-03-13 except 2026-03-13"); // throws InvalidRuleError
```

## Install

```bash
npm install everwhen
```

As a git dependency:

```bash
npm install github:coality/everwhen
```

Runtime dependency: [`luxon`](https://moment.github.io/luxon/) (timezone math). Node 18+.

## API

### `nextOccurrence(text, options?) => Date`

Returns the next occurrence **strictly after** `now`.

- `options.now` — reference instant: a `Date` (absolute) or an ISO string (interpreted as
  wall-clock in the schedule's zone). Defaults to the current time.
- `options.tz` — default IANA zone when the rule doesn't specify one (default `Europe/Paris`).
  A rule can override it inline: `… in America/New_York` (EN) or `… (America/New_York)` (FR).

Throws `InvalidRuleError` for empty / unsupported / structurally-invalid rules, and
`NoOccurrenceError` when a well-formed rule has no future occurrence (e.g. its window has passed).

### `validate(text, options?) => true`

Returns `true` when the rule is well-formed and has an occurrence within a ~1-year horizon;
throws `InvalidRuleError` otherwise.

### Parsing (no engine)

- `parseSchedule(text, defaultTz?)` / `parseRule(text)` — auto-detect the language (EN/FR) and
  parse to the IR, falling back to the other grammar on failure.
- `parseScheduleEn` / `parseRuleEn`, `parseScheduleFr` / `parseRuleFr` — force a grammar.
- `detectLanguage(text) => "en" | "fr"`.

All IR types (`IRSchedule`, `IRRule`, …) and the error classes are exported.

## Supported grammar

The same rules work in English and French; the formatters and parser accept either.

| Kind            | English                                                                             | French                                                                                |
| --------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Daily           | `every day at 10:00`                                                                | `tous les jours à 10h00`                                                              |
| Multiple times  | `every day at 09:00 and 18:00`                                                      | `tous les jours à 09h00 et 18h00`                                                     |
| Weekday set     | `every monday and thursday at 18:00`                                                | `tous les lundis et jeudis à 18h00`                                                   |
| Business days   | `every weekday at 09:00`                                                            | `tous les jours ouvrés à 09h00`                                                       |
| Interval        | `every 2 days at 10:00`, `every 3 weeks on monday at 08:30`                         | `tous les 2 jours à 10h00`, `toutes les 3 semaines le lundi à 08h30`                  |
| Sub-day step    | `every day every 2 hours between 09:00 and 17:00`                                   | `tous les jours, toutes les 2 heures entre 09h00 et 17h00`                            |
| Hourly window   | `every hour between 18:00 and 23:00`                                                | `toutes les heures entre 18h00 et 23h00`                                              |
| Minutely/hourly | `every 15 minutes`, `every 6 hours`                                                 | `toutes les 15 minutes`, `toutes les 6 heures`                                        |
| Day of month    | `every month on the 15th at 08:00`, `… on the last day …`                           | `tous les mois le 15 à 08h00`, `… le dernier jour …`                                  |
| Nth weekday     | `every month on the first monday at 09:00`, `… on the first and third monday …`     | `tous les mois le premier lundi à 09h00`, `… le premier et troisième lundi …`         |
| Biweekly        | `every other tuesday at 09:00`, `every other day at 10:00`                          | `un mardi sur deux à 09h00`, `tous les deux jours à 10h00`                            |
| Yearly          | `every year on 03-14 at 10:00`, `every year on the last sunday of october at 23:00` | `tous les ans le 03-14 à 10h00`, `tous les ans le dernier dimanche d'octobre à 23h00` |
| One-shot        | `2026-03-13 at 02:00`                                                               | `le 2026-03-13 à 02h00`                                                               |
| Date window     | `… between 2026-02-01 and 2026-03-31`, `… until 2026-12-31`                         | `… entre le 2026-02-01 et le 2026-03-31`, `… jusqu'au 2026-12-31`                     |
| Exceptions      | `… except thursday`, `… except 2026-03-13`, `… except weekends`                     | `… sauf le jeudi`, `… sauf le 2026-03-13`, `… sauf le week-end`                       |
| Except nth wday | `… except the last tuesday of the month`                                            | `… sauf le dernier mardi du mois`                                                     |
| Weekend shift   | `… if weekend then next monday` / `… next business day`                             | `… si week-end alors lundi suivant` / `… prochain jour ouvré`                         |
| Composed        | `rule A, and rule B` (earliest wins)                                                | `règle A, et règle B`                                                                 |

Times accept `09:00`, `9`, `3PM` (EN) and `09h00`, `9h`, `18h30` (FR). Public-holiday exclusions
(`except public holidays` / `sauf les jours fériés`) are recognized but rejected with a clear error,
since there is no holiday data source.

## Behaviour notes

- All recurrence math is done on naive wall-clock values and the result is materialized into an
  absolute `Date` in the schedule's zone. Comparisons (e.g. "earliest of composed rules") are
  wall-clock, matching the reference implementation.
- Zero/negative intervals and steps, and empty/unparseable rules, are rejected up front rather than
  looping.

## Development

```bash
npm install
npm test          # vitest
npm run build     # tsup -> dist/ (ESM + .d.ts)
npm run lint      # eslint + prettier
```

## Parity

everwhen is a faithful TypeScript port of the [`recpyx`](https://github.com/coality/recpyx) Python
library. Its full engine + robustness test matrix (English, French, timezones, calendar edge cases)
is ported to vitest and passes identically — that parity is the definition of "done".

## License

[MIT](./LICENSE)
