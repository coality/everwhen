/**
 * everwhen — parse natural-language recurrence rules (English + French) and
 * compute their occurrences.
 */
export { nextOccurrence, validate } from "./engine.js";
export type { OccurrenceOptions } from "./engine.js";

export { parseSchedule, parseRule, detectLanguage } from "./parser.js";

export { parseSchedule as parseScheduleEn, parseRule as parseRuleEn } from "./en.js";

export { parseSchedule as parseScheduleFr, parseRule as parseRuleFr } from "./fr.js";

export { InvalidRuleError, NoOccurrenceError } from "./types.js";

export type {
  IRSchedule,
  IRRule,
  IRTime,
  IRDate,
  IRDateTime,
  IRExcept,
  IRSetposWeekday,
  IRHolidaySpec,
  IRWindowDate,
  IRBetweenTime,
  IRStep,
  Frequency,
  RuleType,
  WeekendShift,
} from "./types.js";
