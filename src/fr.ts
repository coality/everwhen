/**
 * FR -> IR.
 *
 * Strategy: normalize French surface forms into the supported EN grammar, then
 * reuse the proven EN -> IR parser. This is still "FR -> IR" from the API
 * perspective (returns IR) without running the engine. The ordered list of
 * substitutions mirrors the reference Python source.
 *
 * Note on word boundaries: JavaScript's `\b` is ASCII-only, so the two patterns
 * whose boundary touches an accented letter (`à`, `férié`) use explicit
 * Unicode-aware lookarounds instead. Every other accented token starts and ends
 * on an ASCII letter, so plain `\b` is faithful there.
 */
import * as en from "./en.js";
import type { IRRule, IRSchedule } from "./types.js";

const TIME_H_RE = /(?<!\d)(\d{1,2})h(?:(\d{2}))?(?!\d)/gi;

function frTimeToEn(s: string): string {
  return s.replace(TIME_H_RE, (_m, hh: string, mm: string | undefined) => {
    const h = parseInt(hh, 10);
    const m = parseInt(mm ?? "0", 10);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  });
}

function normSpaces(s: string): string {
  return s.replace(/’/g, "'").replace(/\s+/g, " ").trim();
}

// order matters: longer first
const FR_MONTH_ORD: [string, string][] = [
  ["premier", "first"],
  ["deuxième", "second"],
  ["deuxieme", "second"],
  ["troisième", "third"],
  ["troisieme", "third"],
  ["quatrième", "fourth"],
  ["quatrieme", "fourth"],
  ["cinquième", "fifth"],
  ["cinquieme", "fifth"],
  ["dernier", "last"],
  ["dernière", "last"],
  ["derniere", "last"],
];

const MONTH_MAP: [string, string][] = [
  ["janvier", "january"],
  ["février", "february"],
  ["fevrier", "february"],
  ["mars", "march"],
  ["avril", "april"],
  ["mai", "may"],
  ["juin", "june"],
  ["juillet", "july"],
  ["août", "august"],
  ["aout", "august"],
  ["septembre", "september"],
  ["octobre", "october"],
  ["novembre", "november"],
  ["décembre", "december"],
  ["decembre", "december"],
];

const WD_FR_TO_EN: [string, string][] = [
  ["lundis", "monday"],
  ["lundi", "monday"],
  ["mardis", "tuesday"],
  ["mardi", "tuesday"],
  ["mercredis", "wednesday"],
  ["mercredi", "wednesday"],
  ["jeudis", "thursday"],
  ["jeudi", "thursday"],
  ["vendredis", "friday"],
  ["vendredi", "friday"],
  ["samedis", "saturday"],
  ["samedi", "saturday"],
  ["dimanches", "sunday"],
  ["dimanche", "sunday"],
];

function wdFrToEn(s: string): string {
  let out = s;
  for (const [fr, eng] of WD_FR_TO_EN) {
    out = out.replace(new RegExp(`\\b${fr}\\b`, "gi"), eng);
  }
  return out;
}

/** Map a single French weekday (singular or plural) to its English name. */
function frWeekdayToEn(wd: string): string {
  const w = wd.toLowerCase();
  for (const [fr, eng] of WD_FR_TO_EN) if (fr === w) return eng;
  return wd;
}

export function frToEnRule(frRule: string): string {
  let s = normSpaces(frRule);

  // timezone: "(Europe/Paris)" => "in Europe/Paris"
  let tzSuffix = "";
  const tzm = /\(([^)]+\/[^)]+)\)\s*$/.exec(s);
  if (tzm) {
    const tz = tzm[1]!.trim();
    s = s.slice(0, tzm.index).trim();
    tzSuffix = ` in ${tz}`;
  }

  // "(les) jours fériés" -> "public holidays" BEFORE the generic jours->days rule.
  // Trailing boundary is Unicode-aware because "férié" can end on an accent.
  s = s.replace(
    /\b(?:les\s+|le\s+)?jours?\s+f[ée]ri[ée]s?(?![a-zàâäéèêëîïôöùûüç])/gi,
    "public holidays",
  );

  // "midi" / "minuit" -> 12:00 / 00:00 (before frTimeToEn / à handling)
  s = s.replace(/\bmidi\b/gi, "12:00").replace(/\bminuit\b/gi, "00:00");

  s = frTimeToEn(s);
  // "à" standalone -> " a " (Unicode-aware boundary; JS \b is ASCII-only)
  s = s.replace(/(?<![^\s])à(?![^\s])/gi, " a ");
  // do NOT split "au" (would break words like "sauf")
  s = normSpaces(s);

  // composed rules: ", et " => ", and "
  s = s.replace(/\s*,\s*et\s+/gi, ", and ");

  // date windows
  s = s.replace(
    /\bentre\s+le\s+(\d{4}-\d{2}-\d{2})\s+et\s+le\s+(\d{4}-\d{2}-\d{2})\b/gi,
    "between $1 and $2",
  );
  // time range: "entre 09h00 et 17h00" / "de 09h00 à 17h00" (already HH:MM, à->a)
  s = s.replace(/\bentre\s+(\d{2}:\d{2})\s+et\s+(\d{2}:\d{2})\b/gi, "between $1 and $2");
  s = s.replace(/\bde\s+(\d{2}:\d{2})\s+a\s+(\d{2}:\d{2})\b/gi, "between $1 and $2");
  s = s.replace(/\bjusqu'?au\s+(\d{4}-\d{2}-\d{2})\b/gi, "until $1");
  // "à partir du 2026-04-01" -> "starting 2026-04-01" (à already lowered to "a")
  s = s.replace(/\ba\s+partir\s+du\s+(\d{4}-\d{2}-\d{2})\b/gi, "starting $1");
  // "5 fois" -> "5 times"
  s = s.replace(/\b(\d+)\s+fois\b/gi, "$1 times");

  // weekend shift
  s = s.replace(/\bsi\s+week-?end\s+alors\s+lundi\s+suivant\b/gi, "if weekend then next monday");
  // Trailing boundary is Unicode-aware because "ouvré" can end on an accent.
  s = s.replace(
    /\bsi\s+week-?end\s+alors\s+prochain\s+jour\s+ouvr[eé](?![a-zàâäéèêëîïôöùûüç])/gi,
    "if weekend then next business day",
  );
  // cleanup commas before suffix clauses
  s = s.replace(/,\s*(if\s+weekend\s+then\s+next\s+(?:monday|business\s+day))\b/gi, " $1");
  s = s.replace(/,\s*$/, "");

  // Week-end exclusion vs recurrence (kept distinct so neither touches the
  // "if weekend then ..." produced by the weekend-shift rules above):
  //   "sauf le week-end"     -> "except weekends"
  //   "tous les week-ends …" -> "every weekend …"
  s = s.replace(/\bsauf\s+(?:le|les)\s+week-?ends?\b/gi, "except weekends");
  s = s.replace(/\b(?:tous|toutes)\s+les\s+week-?ends?\b/gi, "every weekend");

  // biweekly: "un mardi sur deux" -> "every 2 weeks on tuesday" (weekday is
  // converted to English further down, so match the FR weekday here).
  s = s.replace(
    /\bun\s+(lundis?|mardis?|mercredis?|jeudis?|vendredis?|samedis?|dimanches?)\s+sur\s+deux\b/gi,
    (_m, wd: string) => `every 2 weeks on ${frWeekdayToEn(wd)}`,
  );
  // "un mois sur deux" -> "every 2 months"; "une semaine sur deux" -> "every 2 weeks".
  s = s.replace(/\bun\s+mois\s+sur\s+deux\b/gi, "every 2 months");
  s = s.replace(/\bune\s+semaines?\s+sur\s+deux\b/gi, "every 2 weeks");

  // "quinze jours" / "quinzaine" -> two weeks (idiomatic fortnight)
  s = s.replace(/\bquinze\s+jours\b/gi, "2 weeks");
  s = s.replace(/\bquinzaines?\b/gi, "2 weeks");

  // "le dernier/premier jour ouvré du mois" -> "every month on the last/first weekday"
  s = s.replace(
    /\b(?:le\s+)?(premier|dernier)\s+jours?\s+ouvr[eé]s?\s+du\s+mois\b/gi,
    (_m, ord: string) =>
      `every month on the ${ord.toLowerCase() === "premier" ? "first" : "last"} weekday`,
  );

  // frequency base phrases
  s = s.replace(/\b(tous|toutes)\s+les\b/gi, "every");
  s = s.replace(/\bchaque\b/gi, "every");
  // biweekly via the French word "deux": "tous les deux jours" -> "every 2 days"
  s = s.replace(/\bevery\s+deux\b/gi, "every 2");
  // calendar-period aliases: map straight onto the "N months" machinery.
  s = s.replace(/\btrimestres?\b/gi, "3 months");
  s = s.replace(/\bsemestres?\b/gi, "6 months");
  s = s.replace(/\bjour\s+ouvr[eé]s\b/gi, "weekday");
  s = s.replace(/\bjours\s+ouvr[eé]s\b/gi, "weekday");
  s = s.replace(/\bjours\b/gi, "days");
  s = s.replace(/\bjour\b/gi, "day");
  s = s.replace(/\bsemaines\b/gi, "weeks");
  s = s.replace(/\bsemaine\b/gi, "week");
  s = s.replace(/\bheures\b/gi, "hours");
  s = s.replace(/\bheure\b/gi, "hour");
  s = s.replace(/\bminutes\b/gi, "minutes");
  s = s.replace(/\bminute\b/gi, "minute");

  // fix plural artefacts
  s = s.replace(/\bevery\s+days\b/gi, "every day");
  s = s.replace(/\bevery\s+weekdays\b/gi, "every weekday");
  s = s.replace(/\bevery\s+hours\b/gi, "every hour");
  s = s.replace(/\bevery\s+minutes\b/gi, "every minute");
  s = s.replace(/\bevery\s+weeks\b/gi, "every week");

  // months / years
  s = s.replace(/\bmois\b/gi, "month");
  s = s.replace(/\bans\b/gi, "years");
  s = s.replace(/\ban\b/gi, "year");

  // singularize after FR->EN unit replacements
  s = s.replace(/\bevery\s+years\b/gi, "every year");
  s = s.replace(/\bevery\s+ann[eé]e\b/gi, "every year");

  // ordinal day-of-month: "1er" -> "1st"
  s = s.replace(/\b1er\b/gi, "1st");

  // "dernier jour" -> "last day"
  s = s.replace(/\bdernier\s+jour\b/gi, "last day");

  // nth weekday in month: "le premier lundi" -> "the first monday"
  for (const [fr, eng] of FR_MONTH_ORD) {
    s = s.replace(new RegExp(`\\b${escapeRe(fr)}\\b`, "gi"), eng);
  }

  // weekdays
  s = wdFrToEn(s);

  // french months (for yearly "of <month>")
  for (const [frM, enM] of MONTH_MAP) {
    s = s.replace(new RegExp(`\\bd['’]${frM}\\b`, "gi"), `of ${enM}`);
    s = s.replace(new RegExp(`\\bde\\s+${frM}\\b`, "gi"), `of ${enM}`);
  }

  // french months with "and" connector: "de mars et octobre" -> "of march and october"
  for (const [frM, enM] of MONTH_MAP) {
    s = s.replace(new RegExp(`\\bde\\s+${frM}\\s+et\\s+`, "gi"), `of ${enM} and `);
  }

  // month exclusion: "en août" -> "in august" (used by "sauf en <mois>")
  for (const [frM, enM] of MONTH_MAP) {
    s = s.replace(new RegExp(`\\ben\\s+${frM}\\b`, "gi"), `in ${enM}`);
  }

  // ensure "every year on the <ordinal> <weekday> of <month>"
  s = s.replace(
    /\bevery\s+year\s+on\s+(first|second|third|fourth|fifth|last)\b/gi,
    "every year on the $1",
  );

  // connectors: "et" between weekdays / times -> "and"
  s = s.replace(/\b(et)\b/gi, "and");

  // convert remaining french months that follow "and"
  for (const [frM, enM] of MONTH_MAP) {
    s = s.replace(new RegExp(`\\band\\s+${frM}\\b`, "gi"), `and ${enM}`);
  }

  // "sauf" -> "except"
  s = s.replace(/\bsauf\b/gi, "except");

  // nth weekday of month exclusion: "le dernier mardi du mois" became
  // "le last tuesday du month" above -> "the last tuesday of the month".
  s = s.replace(
    /\b(?:le\s+)?(first|second|third|fourth|fifth|last)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+du\s+month\b/gi,
    "the $1 $2 of the month",
  );

  // day-of-month exclusion: "le 15 du mois" -> "the 15th of the month"
  s = s.replace(/\ble\s+(\d{1,2})\s+du\s+month\b/gi, "the $1th of the month");

  // normalize commas
  s = s.replace(/\s*,\s*/g, ", ");
  s = normSpaces(s);

  // Handle special patterns:
  // - "every day, every 2 hours between ..." -> "every day every 2 hours between ..."
  s = s.replace(
    /^(every\s+(?:day|weekday))\s*,\s*every\s+(\d+)\s+(hours|minutes)\s+between\b/i,
    "$1 every $2 $3 between",
  );

  // - "every [N] month(s) le X ..." -> "every [N] month on the X ..."
  // (the optional interval supports "every 2 months le 1st ...")
  s = s.replace(/\bevery\s+(\d+\s+)?months?\s+le\b/gi, "every $1month on the");

  // ensure "every [N] month(s)" has "on the" — only when a day spec follows
  // (a number, an ordinal, or "last day"), never before at/between/until.
  s = s.replace(
    /^(every\s+(?:\d+\s+)?months?)\s+(?=\d|first|second|third|fourth|fifth|last\b)/i,
    "$1 on the ",
  );

  // yearly forms (interval-tolerant):
  s = s.replace(/\bevery\s+(\d+\s+)?years?\s+le\b/gi, "every $1year on");

  // "every [N] year le 03-12 a 12:30" -> "every [N] year on 03-12 at 12:30"
  s = s.replace(
    /^(every\s+(?:\d+\s+)?years?)\s+le\s+(\d{2}-\d{2})\s+a\s+(\d{2}:\d{2})$/i,
    "$1 on $2 at $3",
  );

  // one-shot: "le 2026-03-13 a 02:00" -> "2026-03-13 at 02:00"
  s = s.replace(/^le\s+(\d{4}-\d{2}-\d{2})\s+a\s+(\d{2}:\d{2})$/i, "$1 at $2");

  // generic: " a " -> " at "
  s = s.replace(/\sa\s+(\d{2}:\d{2})/gi, " at $1");

  // one-shot: remove leading "le" even inside composed schedules
  s = s.replace(/\ble\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{2}:\d{2})\b/gi, "$1 at $2");

  // "du lundi au vendredi" (weekdays already in English) -> "every monday to friday"
  s = s.replace(
    /^du\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+au\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    "every $1 to $2",
  );

  // "le monday" after conversions: remove "le" when it remains
  s = s.replace(/\ble\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "$1");

  // "every 3 weeks monday at 08:30" needs "on monday"
  s = s.replace(
    /^(every\s+\d+\s+weeks)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    "$1 on $2",
  );

  // final fixups for yearly nth-weekday patterns
  s = s.replace(
    /\bevery\s+year\s+on\s+(first|second|third|fourth|fifth|last)\b/gi,
    "every year on the $1",
  );

  s = normSpaces(s) + tzSuffix;
  return s;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewrap<T>(fn: () => T, frText: string): T {
  try {
    return fn();
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    if (msg.startsWith("Unsupported rule:")) {
      throw new Error(`Unsupported rule: '${frText}'`);
    }
    throw exc;
  }
}

export function parseSchedule(frText: string, defaultTz = "Europe/Paris"): IRSchedule {
  const enText = frToEnRule(frText);
  return rewrap(() => en.parseSchedule(enText, defaultTz), frText);
}

export function parseRule(frText: string): IRRule {
  const enText = frToEnRule(frText);
  return rewrap(() => en.parseRule(enText), frText);
}
