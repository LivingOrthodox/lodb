import { z } from "zod";

// Every rule here is a regex plus a length counted in Unicode code points, so it means
// the same thing in Zod, JSON Schema (which counts code points), Swift and Kotlin.
// Native ports: apps/apple/.../Domain/Validation/ContractRules.swift and
// apps/android/.../domain/validation/ContractRules.kt.

const codePoints = (value: string): number => [...value].length;

/** Lowercase ASCII words joined by single hyphens, at most 80 characters. */
export const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const identifier = z.string().max(80).regex(IDENTIFIER_PATTERN);

/** At least one character; no C0, DEL or C1 control characters (so no newlines or tabs). */
export const TEXT_PATTERN = /^[^\u0000-\u001f\u007f-\u009f]+$/;
export const text = (maxCodePoints: number) =>
  z
    .string()
    .regex(TEXT_PATTERN)
    .refine((value) => codePoints(value) <= maxCodePoints, `At most ${maxCodePoints} characters`)
    .meta({ minLength: 1, maxLength: maxCodePoints });

/** Gregorian civil date YYYY-MM-DD with a year in 1900...2199 (the apps' CivilDate range). */
export const civilDate = z.iso
  .date()
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    return year >= 1900 && year <= 2199;
  }, "Year must be 1900...2199")
  .meta({ description: "Gregorian civil date (YYYY-MM-DD), year 1900-2199. Not a timestamp." });

/**
 * HTTPS URL with a lowercase DNS host, optional :443, and a printable-ASCII path/query.
 * No user info, fragment, backslash, whitespace or raw non-ASCII (percent-encode it).
 */
export const HTTPS_URL_PATTERN =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::443)?(?:[/?][!-"$-\[\]-~]*)?$/;
export const httpsUrl = z.string().max(2048).regex(HTTPS_URL_PATTERN);

/** Optional fields may be omitted or null; both mean absent. */
export const absent = <T extends z.ZodType>(schema: T) => schema.nullish();

/** Language subtag only in v1 (e.g. "en"); region-specific content is not yet supported. */
export const LOCALE_PATTERN = /^[a-z]{2,3}$/;
export const locale = z.string().regex(LOCALE_PATTERN);

/** A bundled or published asset path: lowercase segments under assets/, no "." or ".." segments. */
export const ASSET_PATH_PATTERN = /^assets\/(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.(?:jpg|heic|webp|png)$/;
export const assetPath = z.string().max(200).regex(ASSET_PATH_PATTERN);

export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const sha256 = z.string().regex(SHA256_PATTERN);

/** A list with no repeated values (JSON Schema uniqueItems). */
export const uniqueList = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .refine((values) => new Set(values.map((v) => JSON.stringify(v))).size === values.length, "Values must be unique")
    .meta({ uniqueItems: true });

/** A public Google Calendar that distributes a calendar, e.g. c_0123abcd@group.calendar.google.com. */
export const GOOGLE_CALENDAR_ID_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,119}@group\.calendar\.google\.com$/;
export const googleCalendarId = z.string().regex(GOOGLE_CALENDAR_ID_PATTERN);
