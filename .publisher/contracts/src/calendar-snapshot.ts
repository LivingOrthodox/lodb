import type { CalendarConfiguration, CalendarDay, CalendarEvent } from "./calendar.ts";
import { FOOD_CATEGORIES } from "./calendar.ts";

/** One configuration's compiled calendar, as published to the apps. */
export interface CalendarSnapshot {
  configuration: CalendarConfiguration;
  events: CalendarEvent[];
  days: CalendarDay[];
}

/** Cross-record problems; any one makes the snapshot unusable (apps keep their last good one). */
export type CalendarSnapshotError =
  | "configurationMismatch"
  | "dayOutsideCoverage"
  | "duplicateDay"
  | "duplicateEvent"
  | "eventDateMismatch"
  | "missingCoverageDay"
  | "unknownEventReference"
  | "withdrawnEventReference";

const DAY_MS = 86_400_000;
const datesBetween = (start: string, end: string): string[] => {
  const result: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += DAY_MS) {
    result.push(new Date(t).toISOString().slice(0, 10));
  }
  return result;
};

/** Algorithm calendar-v1; Swift and Kotlin ports are checked against contracts/fixtures/behavior/calendar.json. */
export function validateCalendarSnapshot(snapshot: CalendarSnapshot): CalendarSnapshotError[] {
  const errors = new Set<CalendarSnapshotError>();
  const { configuration, events, days } = snapshot;
  const eventsById = new Map<string, CalendarEvent>();
  for (const event of events) {
    if (eventsById.has(event.id)) errors.add("duplicateEvent");
    eventsById.set(event.id, event);
    if (event.configurationId !== configuration.id) errors.add("configurationMismatch");
  }
  const dayDates = new Set<string>();
  for (const day of days) {
    if (dayDates.has(day.date)) errors.add("duplicateDay");
    dayDates.add(day.date);
    if (day.configurationId !== configuration.id) errors.add("configurationMismatch");
    if (day.date < configuration.coverage.start || day.date > configuration.coverage.end) errors.add("dayOutsideCoverage");
    for (const id of day.eventIds) {
      const event = eventsById.get(id);
      if (!event) errors.add("unknownEventReference");
      else if (event.status !== "published") errors.add("withdrawnEventReference");
      else if (event.date !== day.date) errors.add("eventDateMismatch");
    }
  }
  for (const date of datesBetween(configuration.coverage.start, configuration.coverage.end)) {
    if (!dayDates.has(date)) {
      errors.add("missingCoverageDay");
      break;
    }
  }
  return [...errors].sort();
}

export type FastingSummary = Record<"abstained" | "permitted" | "unspecified", string[]>;

export type DayResolution =
  | { status: "outsideCoverage" | "missingRecord" }
  | { status: "covered"; eventIds: string[]; principalEventId: string | null; fasting: FastingSummary | null };

/** What a date shows in a valid snapshot. */
export function resolveCalendarDay(snapshot: CalendarSnapshot, date: string): DayResolution {
  const { start, end } = snapshot.configuration.coverage;
  if (date < start || date > end) return { status: "outsideCoverage" };
  const day = snapshot.days.find((d) => d.date === date);
  if (!day) return { status: "missingRecord" };
  let fasting: FastingSummary | null = null;
  if (day.fasting) {
    fasting = { abstained: [], permitted: [], unspecified: [] };
    for (const food of FOOD_CATEGORIES) fasting[day.fasting.foods[food]].push(food);
  }
  return { status: "covered", eventIds: day.eventIds, principalEventId: day.principalEventId ?? null, fasting };
}
