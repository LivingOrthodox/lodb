import type { CalendarSnapshot } from "@living-orthodox/content-contracts";
import { canonicalJson, sha256Hex } from "./canonical.ts";

/**
 * The persistent identity and revision record for one calendar's public feed. It is published
 * alongside the feed and must be carried forward from every previous publication: UIDs are allocated
 * once and never change, SEQUENCE only increases, and withdrawals become retained tombstones.
 */
export interface LedgerEntry {
  eventId: string;
  uid: string;
  sequence: number;
  /** Digest of the feed-visible fields; a change bumps sequence and lastModified. */
  digest: string;
  date: string;
  created: string;
  lastModified: string;
  status: "active" | "cancelled";
  cancelledAt?: string;
}

export interface Ledger {
  schemaVersion: 1;
  configurationId: string;
  entries: LedgerEntry[];
}

export interface LedgerChange {
  eventId: string;
  change: "added" | "updated" | "cancelled" | "restored";
}

export class LedgerError extends Error {}

/** The fields a subscriber sees; changing any of them is a meaningful change. */
function feedDigest(event: CalendarSnapshot["events"][number], sourceTitles: string[]): string {
  return sha256Hex(
    canonicalJson({
      date: event.date,
      kind: event.kind,
      title: event.title,
      description: event.description ?? null,
      scriptureReferences: event.scriptureReferences,
      sources: sourceTitles,
    }),
  );
}

export interface LedgerOptions {
  /** UTC timestamp of this publication, e.g. 2027-01-01T00:00:00Z. */
  now: string;
  /** Whether a feed for this configuration has ever been published. */
  feedPublished: boolean;
  /** Allocates a new UID; injectable so tests are deterministic. */
  newUid: () => string;
  sourceTitle: (id: string) => string;
}

export function updateLedger(previous: Ledger | undefined, snapshot: CalendarSnapshot, options: LedgerOptions): { ledger: Ledger; changes: LedgerChange[] } {
  const configurationId = snapshot.configuration.id;
  if (!previous && options.feedPublished) {
    throw new LedgerError(`The ledger for ${configurationId} is missing but its feed has been published. Restore the ledger; never regenerate identities.`);
  }
  if (previous && previous.configurationId !== configurationId) throw new LedgerError(`Ledger is for ${previous.configurationId}, not ${configurationId}`);

  const entries = new Map((previous?.entries ?? []).map((entry) => [entry.eventId, { ...entry }]));
  const changes: LedgerChange[] = [];
  const published = new Map(snapshot.events.filter((e) => e.status === "published").map((e) => [e.id, e]));

  for (const event of published.values()) {
    const digest = feedDigest(event, event.sourceIds.map(options.sourceTitle));
    const entry = entries.get(event.id);
    if (!entry) {
      entries.set(event.id, {
        eventId: event.id, uid: options.newUid(), sequence: 0, digest, date: event.date,
        created: options.now, lastModified: options.now, status: "active",
      });
      changes.push({ eventId: event.id, change: "added" });
    } else if (entry.status === "cancelled") {
      Object.assign(entry, { sequence: entry.sequence + 1, digest, date: event.date, lastModified: options.now, status: "active" });
      delete entry.cancelledAt;
      changes.push({ eventId: event.id, change: "restored" });
    } else if (entry.digest !== digest) {
      Object.assign(entry, { sequence: entry.sequence + 1, digest, date: event.date, lastModified: options.now });
      changes.push({ eventId: event.id, change: "updated" });
    }
  }
  // Anything previously published that is now withdrawn or gone becomes a cancellation tombstone.
  for (const entry of entries.values()) {
    if (entry.status === "active" && !published.has(entry.eventId)) {
      Object.assign(entry, { sequence: entry.sequence + 1, lastModified: options.now, status: "cancelled", cancelledAt: options.now });
      changes.push({ eventId: entry.eventId, change: "cancelled" });
    }
  }
  const sorted = [...entries.values()].sort((a, b) => (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
  return { ledger: { schemaVersion: 1, configurationId, entries: sorted }, changes };
}
