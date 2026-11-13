import {
  CalendarConfiguration,
  CalendarDay,
  CalendarEvent,
  type CalendarSnapshot,
  DailyBackground,
  DailyThought,
  EditorialReview,
  Lesson,
  ScheduledThought,
  SourceReference,
  validateCalendarSnapshot,
} from "@living-orthodox/content-contracts";
import type { z } from "zod";
import { recordDigest, sha256Hex } from "./canonical.ts";
import { readImageInfo } from "./images.ts";
import type { EditorialInput } from "./editorial.ts";

export type Channel = "development" | "production";

export interface Issue {
  /** Stable machine-readable code, e.g. "schema", "unknownSource", "missingReview". */
  code: string;
  /** Where: a file path and record id. */
  at: string;
  message: string;
}

type Thought = z.infer<typeof DailyThought>;
type Background = z.infer<typeof DailyBackground>;
type LessonRecord = z.infer<typeof Lesson>;
type Source = z.infer<typeof SourceReference>;
type Review = z.infer<typeof EditorialReview>;

export interface ValidatedContent {
  sources: Source[];
  thoughts: Thought[];
  backgrounds: Background[];
  lessons: LessonRecord[];
  calendars: CalendarSnapshot[];
  /** The authored (unstripped) record per key, for digests. */
  authored: Map<string, unknown>;
  /** Image assets to ship in the release, by path. */
  assets: Map<string, Uint8Array>;
}

export interface ValidationResult {
  errors: Issue[];
  warnings: Issue[];
  content: ValidatedContent;
}

/**
 * Validates editorial input for a channel. Development builds may contain labeled development
 * content and unreviewed records (reported as warnings). Production requires every published
 * substantive record to be real content, approved by a review bound to its exact digest, and to
 * cite only sources whose rights permit redistribution.
 */
export function validateEditorial(input: EditorialInput, channel: Channel): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const gate = (issue: Issue) => (channel === "production" ? errors : warnings).push(issue);

  const parse = <T extends z.ZodType>(schema: T, value: unknown, at: string): z.infer<T> | undefined => {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    const details = result.error.issues.map((i) => `${i.path.join(".") || "(record)"}: ${i.message}`).join("; ");
    errors.push({ code: "schema", at, message: details });
    return undefined;
  };
  const unique = <T extends { id: string }>(records: T[], kind: string, at: string) => {
    const seen = new Set<string>();
    for (const record of records) {
      if (seen.has(record.id)) errors.push({ code: "duplicateId", at, message: `Duplicate ${kind} id ${record.id}` });
      seen.add(record.id);
    }
  };

  const sources = input.sources.flatMap((v, i) => parse(SourceReference, v, `sources.json[${i}]`) ?? []);
  unique(sources, "source", "sources.json");
  const thoughts = input.thoughts.flatMap((v, i) => parse(DailyThought, v, `daily/thoughts.json[${i}]`) ?? []);
  const backgrounds = input.backgrounds.flatMap((v, i) => parse(DailyBackground, v, `daily/backgrounds.json[${i}]`) ?? []);
  const assets = new Map<string, Uint8Array>();
  const authoredScheduled = new Map<string, unknown>();
  const scheduledDates = new Map<string, string>();
  for (const { file, record } of input.scheduled) {
    const scheduled = parse(ScheduledThought, record, file);
    if (!scheduled) continue;
    authoredScheduled.set(`thought:${scheduled.id}`, record);
    const dateKey = `${scheduled.locale}/${scheduled.date}`;
    if (scheduled.status === "published") {
      const other = scheduledDates.get(dateKey);
      if (other) errors.push({ code: "duplicateScheduledDate", at: file, message: `${scheduled.date} (${scheduled.locale}) is already scheduled for ${other}` });
      scheduledDates.set(dateKey, scheduled.id);
    }
    thoughts.push({
      id: scheduled.id, locale: scheduled.locale, origin: "editorial", kind: scheduled.kind, text: scheduled.quote,
      author: scheduled.author, attribution: scheduled.attribution, publisher: scheduled.publisher,
      originalPublicationDate: scheduled.originalPublicationDate, sourceIds: scheduled.sourceIds, displayDates: [scheduled.date],
      fallbackEligible: false, status: scheduled.status, reflection: scheduled.reflection, practicalAction: scheduled.practicalAction,
      isDevelopmentContent: scheduled.isDevelopmentContent,
    });
    const background = scheduled.background;
    if (!background) continue;
    const bytes = input.assets.get(background.image);
    const info = bytes && readImageInfo(bytes);
    const expected = { jpg: "jpeg", png: "png", webp: "webp" }[background.image.split(".").pop() ?? ""];
    if (!bytes) {
      errors.push({ code: "missingAsset", at: file, message: `${background.image} is missing or larger than 15 MB` });
      continue;
    }
    if (!info || info.format !== expected) {
      errors.push({ code: "invalidAsset", at: file, message: `${background.image} is not a valid ${expected ?? "supported"} image (use JPEG, PNG or WebP)` });
      continue;
    }
    if (info.width < 1 || info.width > 10_000 || info.height < 1 || info.height > 10_000) {
      errors.push({ code: "invalidAsset", at: file, message: `${background.image} is ${info.width}x${info.height}; images must be at most 10000 pixels per side` });
      continue;
    }
    assets.set(background.image, bytes);
    backgrounds.push({
      id: `${scheduled.id}-background`, status: scheduled.status, altText: background.altText,
      variants: [{ path: background.image, width: info.width, height: info.height, sha256: sha256Hex(bytes), format: info.format }],
      focalPoint: background.focalPoint,
      attribution: { photographer: background.photographer, license: background.license, licenseUrl: background.licenseUrl, attributionText: background.attributionText },
      tags: scheduled.tags, assignedDates: [scheduled.date], isDevelopmentContent: scheduled.isDevelopmentContent,
    });
  }
  unique(thoughts, "thought", "daily/");
  unique(backgrounds, "background", "daily/");
  const lessons = input.lessons.flatMap(({ file, record }) => parse(Lesson, record, file) ?? []);
  unique(lessons, "lesson", "lessons/");
  const reviews = input.reviews.flatMap((v, i) => parse(EditorialReview, v, `reviews.json[${i}]`) ?? []);

  const authored = new Map<string, unknown>();
  input.thoughts.forEach((v) => authored.set(`thought:${(v as { id?: string }).id}`, v));
  // Scheduled thoughts are reviewed as authored, including their image metadata.
  for (const [key, record] of authoredScheduled) authored.set(key, record);
  input.lessons.forEach(({ record }) => authored.set(`lesson:${(record as { id?: string }).id}`, record));

  const calendars: CalendarSnapshot[] = [];
  for (const raw of input.calendars) {
    const configuration = parse(CalendarConfiguration, raw.configuration, `${raw.directory}/configuration.json`);
    const events = raw.events.flatMap((v, i) => parse(CalendarEvent, v, `${raw.directory}/events.json[${i}]`) ?? []);
    const days = raw.days.flatMap((v, i) => parse(CalendarDay, v, `${raw.directory}/days.json[${i}]`) ?? []);
    if (!configuration) continue;
    if (raw.directory !== `calendars/${configuration.id}`) {
      errors.push({ code: "calendarDirectory", at: raw.directory, message: `Directory must be calendars/${configuration.id}` });
    }
    const snapshot: CalendarSnapshot = { configuration, events, days };
    for (const problem of validateCalendarSnapshot(snapshot)) {
      errors.push({ code: `calendar.${problem}`, at: raw.directory, message: `Calendar snapshot: ${problem}` });
    }
    calendars.push(snapshot);
    // A calendar is reviewed as a whole: its configuration, events and days together.
    authored.set(`calendar:${configuration.id}`, { configuration: raw.configuration, events: raw.events, days: raw.days });
  }

  // References.
  const sourceIds = new Set(sources.map((s) => s.id));
  const lessonIds = new Set(lessons.filter((l) => l.status === "published").map((l) => l.id));
  const requireSources = (ids: string[], at: string) => {
    for (const id of ids) if (!sourceIds.has(id)) errors.push({ code: "unknownSource", at, message: `Unknown source ${id}` });
  };
  const requireLessons = (ids: string[], at: string) => {
    for (const id of ids) if (!lessonIds.has(id)) errors.push({ code: "unknownLesson", at, message: `Unknown or unpublished lesson ${id}` });
  };
  thoughts.forEach((t) => requireSources(t.sourceIds, `thought:${t.id}`));
  for (const lesson of lessons) {
    const at = `lesson:${lesson.id}`;
    requireSources(lesson.sourceIds, at);
    requireLessons(lesson.relatedLessonIds, at);
    for (const block of lesson.learn) {
      if (block.type === "quote") requireSources([block.sourceId], `${at}/${block.id}`);
      if (block.type === "lessonReference") requireLessons([block.lessonId], `${at}/${block.id}`);
    }
  }
  for (const calendar of calendars) {
    const at = `calendar:${calendar.configuration.id}`;
    for (const event of calendar.events) {
      requireSources(event.sourceIds, `${at}/${event.id}`);
      requireLessons(event.relatedLessonIds, `${at}/${event.id}`);
    }
    for (const day of calendar.days) if (day.fasting) requireSources(day.fasting.sourceIds, `${at}/${day.date}`);
  }

  // Channel gates for published substantive records.
  const reviewsByKey = new Map<string, Review[]>();
  for (const review of reviews) reviewsByKey.set(review.recordKey, [...(reviewsByKey.get(review.recordKey) ?? []), review]);
  const sourcesById = new Map(sources.map((s) => [s.id, s]));
  const gated: { key: string; development: boolean; published: boolean; sourceIds: string[] }[] = [
    ...thoughts.map((t) => ({ key: `thought:${t.id}`, development: t.isDevelopmentContent, published: t.status === "published", sourceIds: t.sourceIds })),
    ...lessons.map((l) => ({
      key: `lesson:${l.id}`,
      development: l.isDevelopmentContent,
      published: l.status === "published",
      sourceIds: [...l.sourceIds, ...l.learn.flatMap((b) => (b.type === "quote" ? [b.sourceId] : []))],
    })),
    ...calendars.map((c) => ({
      key: `calendar:${c.configuration.id}`,
      development: c.configuration.isDevelopmentContent || c.events.some((e) => e.isDevelopmentContent) || c.days.some((d) => d.isDevelopmentContent),
      published: true,
      sourceIds: [...c.events.flatMap((e) => e.sourceIds), ...c.days.flatMap((d) => d.fasting?.sourceIds ?? [])],
    })),
  ];
  for (const record of gated.filter((r) => r.published)) {
    if (record.development) gate({ code: "developmentContent", at: record.key, message: "Development content cannot be published to production" });
    const digest = recordDigest(authored.get(record.key));
    const approved = (reviewsByKey.get(record.key) ?? []).some((r) => r.status === "approved" && r.digest === digest);
    if (!approved) {
      const stale = (reviewsByKey.get(record.key) ?? []).some((r) => r.status === "approved");
      gate({
        code: stale ? "staleReview" : "missingReview",
        at: record.key,
        message: stale ? "Approved review does not match the current record; it was edited after review" : "No approved review for this record",
      });
    }
    for (const id of new Set(record.sourceIds)) {
      const source = sourcesById.get(id);
      if (source && !source.allowedUses.redistribution) {
        gate({ code: "rightsRedistribution", at: record.key, message: `Source ${id} does not permit redistribution` });
      }
    }
  }
  if (!gated.some((r) => r.published)) {
    gate({ code: "noContent", at: "release", message: "Nothing is published yet; production releases need at least one published record" });
  }
  for (const background of backgrounds.filter((b) => b.status === "published" && b.isDevelopmentContent)) {
    gate({ code: "developmentContent", at: `background:${background.id}`, message: "Development content cannot be published to production" });
  }

  return { errors, warnings, content: { sources, thoughts, backgrounds, lessons, calendars, authored, assets } };
}
