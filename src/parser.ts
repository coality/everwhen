/**
 * Language detection (EN/FR) + dispatch with cross-language fallback.
 *
 * The detector counts language-marker hits; ties resolve to English. Whatever
 * the detector picks, we try that parser first and fall back to the other if it
 * raises — so a misdetected rule still parses when the other grammar accepts it.
 */
import * as en from "./en.js";
import * as fr from "./fr.js";
import type { IRRule, IRSchedule } from "./types.js";

// Trailing lookahead (not `\b`) so accented endings like "ouvré" still match —
// JS `\b` is ASCII-only.
const FR_MARKERS =
  /\b(tous|toutes|sauf|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|ouvr[eé]s?|semaine|semaines|mois|ans|an|entre|jusqu(?:'|’)?au|week-?end|janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?![a-zàâäéèêëîïôöùûüç])/gi;

const EN_MARKERS =
  /\b(every|except|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|weekend|between|until|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;

export function detectLanguage(text: string): "en" | "fr" {
  const frHits = (text.match(FR_MARKERS) ?? []).length;
  const enHits = (text.match(EN_MARKERS) ?? []).length;
  if (frHits > enHits) return "fr";
  if (enHits > frHits) return "en";
  return "en";
}

function parseWithFallback<T>(primary: () => T, secondary: () => T): T {
  try {
    return primary();
  } catch (exc) {
    if (exc instanceof Error) return secondary();
    throw exc;
  }
}

export function parseSchedule(text: string, defaultTz = "Europe/Paris"): IRSchedule {
  const lang = detectLanguage(text);
  if (lang === "fr") {
    return parseWithFallback(
      () => fr.parseSchedule(text, defaultTz),
      () => en.parseSchedule(text, defaultTz),
    );
  }
  return parseWithFallback(
    () => en.parseSchedule(text, defaultTz),
    () => fr.parseSchedule(text, defaultTz),
  );
}

export function parseRule(text: string): IRRule {
  const lang = detectLanguage(text);
  if (lang === "fr") {
    return parseWithFallback(
      () => fr.parseRule(text),
      () => en.parseRule(text),
    );
  }
  return parseWithFallback(
    () => en.parseRule(text),
    () => fr.parseRule(text),
  );
}
