import type { z } from "zod";
import { CalendarConfiguration, CalendarDay, CalendarEvent } from "./calendar.ts";
import { DailyBackground } from "./daily-background.ts";
import { DailyThought } from "./daily-thought.ts";
import { Lesson } from "./lesson.ts";
import { PrayerReference } from "./prayer-reference.ts";
import { ScheduledThought } from "./scheduled-thought.ts";
import { ChannelPointer, EditorialReview, ReleaseManifest } from "./release.ts";
import { SourceReference } from "./source-reference.ts";

export * from "./primitives.ts";
export { CalendarConfiguration, CalendarDay, CalendarEvent, FastingRule, FOOD_CATEGORIES, FoodStatus } from "./calendar.ts";
export * from "./calendar-snapshot.ts";
export { DailyBackground } from "./daily-background.ts";
export { DailyThought } from "./daily-thought.ts";
export { ContentBlock, LEARNING_PATH_IDS, Lesson } from "./lesson.ts";
export { PrayerReference } from "./prayer-reference.ts";
export { ChannelPointer, EditorialReview, RELEASE_FILE_PATTERN, RELEASE_PATH_PATTERN, ReleaseFile, ReleaseManifest } from "./release.ts";
export { ScheduledThought } from "./scheduled-thought.ts";
export { SourceReference } from "./source-reference.ts";

export const CONTRACT_VERSION = 1;

/**
 * Every published contract, keyed by its file name. Each one has a generated
 * contracts/schema/v1/<name>.schema.json and fixtures in contracts/fixtures/{valid,invalid}/<name>.json.
 */
export const contracts = {
  "calendar-configuration": CalendarConfiguration,
  "calendar-day": CalendarDay,
  "calendar-event": CalendarEvent,
  "channel-pointer": ChannelPointer,
  "daily-background": DailyBackground,
  "daily-thought": DailyThought,
  "editorial-review": EditorialReview,
  lesson: Lesson,
  "prayer-reference": PrayerReference,
  "release-manifest": ReleaseManifest,
  "scheduled-thought": ScheduledThought,
  "source-reference": SourceReference,
} as const satisfies Record<string, z.ZodType>;

export type ContractName = keyof typeof contracts;
export * from "./search.ts";
