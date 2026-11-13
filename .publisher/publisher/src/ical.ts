import type { CalendarSnapshot } from "@living-orthodox/content-contracts";
import type { Ledger } from "./ledger.ts";

export interface FeedOptions {
  /** UTC timestamp of this publication. */
  now: string;
  /** e.g. https://example.org; observance links are <linkBase>/observances/<configurationId>/<eventId>. */
  linkBase?: string;
  sourceTitle: (id: string) => string;
  /** Days before and after `now` to include (defaults 90 and 400). */
  pastDays?: number;
  futureDays?: number;
  /** How long cancellation tombstones stay in the feed after withdrawal (default 400 days). */
  tombstoneDays?: number;
}

const DAY_MS = 86_400_000;

/** RFC 5545 TEXT escaping. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets without splitting a UTF-8 character (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character);
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (octets + size > limit) {
      parts.push(current);
      current = "";
      octets = 0;
    }
    current += character;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const icsDate = (date: string) => date.replaceAll("-", "");
const icsTimestamp = (iso: string) => `${iso.slice(0, 19).replace(/[-:]/g, "")}Z`;
/** The civil date after `date` (YYYY-MM-DD). */
export const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

/** One event as every distribution channel (iCalendar feed, Google Calendar) presents it. */
export interface FeedItem {
  uid: string;
  eventId: string;
  date: string;
  sequence: number;
  created: string;
  lastModified: string;
  cancelled: boolean;
  title: string;
  description: string;
  kind?: string;
  link?: string;
}

/**
 * The events a feed publishes now: active events within the window (90 days back, 400 ahead by
 * default) and cancellation tombstones for 400 days after withdrawal. Identities and timestamps come
 * from the ledger, so the result depends only on the snapshot, the ledger and `now`.
 */
export function feedItems(snapshot: CalendarSnapshot, ledger: Ledger, options: FeedOptions): FeedItem[] {
  const now = Date.parse(options.now);
  const start = new Date(now - (options.pastDays ?? 90) * DAY_MS).toISOString().slice(0, 10);
  const end = new Date(now + (options.futureDays ?? 400) * DAY_MS).toISOString().slice(0, 10);
  const tombstoneMs = (options.tombstoneDays ?? 400) * DAY_MS;
  const events = new Map(snapshot.events.map((e) => [e.id, e]));
  const { configuration } = snapshot;
  const items: FeedItem[] = [];
  for (const entry of ledger.entries) {
    const event = events.get(entry.eventId);
    const date = entry.date;
    if (entry.status === "cancelled") {
      if (!entry.cancelledAt || now - Date.parse(entry.cancelledAt) > tombstoneMs) continue;
    } else if (date < start || date > end || !event) {
      continue;
    }
    const identity = { uid: entry.uid, eventId: entry.eventId, date, sequence: entry.sequence, created: entry.created, lastModified: entry.lastModified };
    if (entry.status === "cancelled" || !event) {
      items.push({ ...identity, cancelled: true, title: event?.title ?? "Withdrawn observance", description: "This observance was withdrawn from the Living Orthodox calendar." });
      continue;
    }
    const link = options.linkBase ? `${options.linkBase}/observances/${configuration.id}/${entry.eventId}` : undefined;
    const description = [
      event.description,
      event.scriptureReferences.length ? `Readings: ${event.scriptureReferences.join("; ")}` : undefined,
      `Source: ${event.sourceIds.map(options.sourceTitle).join("; ")}`,
      link ? `Learn more in Living Orthodox: ${link}` : undefined,
      configuration.isDevelopmentContent ? "Development content — not an authoritative Church calendar." : undefined,
    ].filter(Boolean).join("\n\n");
    items.push({ ...identity, cancelled: false, title: event.title, description, kind: event.kind, ...(link ? { link } : {}) });
  }
  return items;
}

/**
 * Generates the public iCalendar feed for one calendar from its compiled snapshot and updated ledger.
 * All-day events use DATE values (no time zone, no UTC midnight). DTSTAMP and LAST-MODIFIED come from
 * the ledger, so an unchanged rebuild produces byte-identical output. No alarms.
 */
export function generateIcs(snapshot: CalendarSnapshot, ledger: Ledger, options: FeedOptions): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Living Orthodox//Calendar Feed 1.0//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(snapshot.configuration.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H",
  ];
  for (const item of feedItems(snapshot, ledger, options)) {
    lines.push("BEGIN:VEVENT", `UID:${item.uid}`, `DTSTAMP:${icsTimestamp(item.lastModified)}`,
      `CREATED:${icsTimestamp(item.created)}`, `LAST-MODIFIED:${icsTimestamp(item.lastModified)}`, `SEQUENCE:${item.sequence}`,
      `DTSTART;VALUE=DATE:${icsDate(item.date)}`, `DTEND;VALUE=DATE:${icsDate(nextDay(item.date))}`, "TRANSP:TRANSPARENT");
    if (item.cancelled) {
      lines.push("STATUS:CANCELLED", `SUMMARY:${escapeText(item.title)}`, `DESCRIPTION:${escapeText(item.description)}`);
    } else {
      lines.push("STATUS:CONFIRMED", `SUMMARY:${escapeText(item.title)}`, `DESCRIPTION:${escapeText(item.description)}`,
        `CATEGORIES:${escapeText(item.kind!)}`);
      if (item.link) lines.push(`URL;VALUE=URI:${item.link}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
