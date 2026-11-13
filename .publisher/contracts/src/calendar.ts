import { z } from "zod";
import { absent, civilDate, googleCalendarId, identifier, locale, text, uniqueList } from "./primitives.ts";

/** Food categories in canonical order. Every rule states all of them explicitly. */
export const FOOD_CATEGORIES = ["meat", "dairy", "eggs", "fish", "shellfish", "wine", "oliveOil", "otherOil"] as const;

/** permitted, abstained, or unspecified (no source says). Unknown states reject the record. */
export const FoodStatus = z.enum(["permitted", "abstained", "unspecified"]);

const atLeastOneSource = uniqueList(identifier, 20).refine((ids) => ids.length >= 1, "At least one source").meta({ minItems: 1 });

export const FastingRule = z
  .object({
    foods: z.object(Object.fromEntries(FOOD_CATEGORIES.map((food) => [food, FoodStatus])) as Record<
      (typeof FOOD_CATEGORIES)[number],
      typeof FoodStatus
    >),
    allowances: z
      .array(z.object({ food: z.enum(FOOD_CATEGORIES), note: text(300) }).meta({ title: "FastingAllowance" }))
      .max(8)
      .meta({ description: "Explained variations, e.g. a customary allowance on a feast within a fast." }),
    explanation: absent(text(1000)),
    sourceIds: atLeastOneSource,
  })
  .meta({ title: "FastingRule", description: "Customary fasting guidance from reviewed sources. Not personal direction." });

export const CalendarConfiguration = z
  .object({
    id: identifier,
    jurisdictionId: identifier,
    traditionId: identifier,
    name: text(200),
    locale,
    coverage: z
      .object({ start: civilDate, end: civilDate })
      .refine((range) => range.start <= range.end, "Coverage must not end before it starts")
      .meta({ title: "Coverage", description: "Inclusive range with a reviewed day record for every date." }),
    revision: z.int().min(1),
    isDevelopmentContent: z.boolean(),
    googleCalendarId: absent(googleCalendarId).meta({
      description: "The public Google Calendar the publisher keeps in sync with this calendar; apps offer it for subscription.",
    }),
  })
  .meta({ title: "CalendarConfiguration" });

export const CalendarEvent = z
  .object({
    id: identifier.meta({ description: "Stable occurrence id; never derived from the date or title." }),
    configurationId: identifier,
    date: civilDate,
    kind: z.enum(["feast", "fast", "commemoration", "observance"]),
    title: text(200),
    description: absent(text(2000)),
    scriptureReferences: z.array(text(100)).max(10),
    relatedLessonIds: uniqueList(identifier, 10),
    sourceIds: atLeastOneSource,
    revision: z.int().min(1),
    status: z.enum(["published", "withdrawn"]),
    isDevelopmentContent: z.boolean(),
  })
  .meta({ title: "CalendarEvent" });

export const CalendarDay = z
  .object({
    configurationId: identifier,
    date: civilDate,
    eventIds: uniqueList(identifier, 30).meta({ description: "In display order." }),
    principalEventId: absent(identifier),
    fasting: absent(FastingRule).meta({ description: "Absent means no fasting guidance is published for this day." }),
    revision: z.int().min(1),
    isDevelopmentContent: z.boolean(),
  })
  .refine((day) => day.principalEventId == null || day.eventIds.includes(day.principalEventId), "Principal event must be listed")
  .meta({ title: "CalendarDay", description: "A compiled day; the apps render it, never re-derive it." });

export type FastingRule = z.infer<typeof FastingRule>;
export type CalendarConfiguration = z.infer<typeof CalendarConfiguration>;
export type CalendarEvent = z.infer<typeof CalendarEvent>;
export type CalendarDay = z.infer<typeof CalendarDay>;
