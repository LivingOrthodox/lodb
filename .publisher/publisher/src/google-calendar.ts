import type { CalendarSnapshot } from "@living-orthodox/content-contracts";
import { createHash, createSign } from "node:crypto";
import { canonicalJson } from "./canonical.ts";
import { type FeedOptions, feedItems, nextDay } from "./ical.ts";
import type { Ledger } from "./ledger.ts";

/**
 * Keeps a public Google Calendar in step with a calendar's feed. The lodb content is the source of
 * truth; the Google Calendar is distribution only. Every event the publisher manages carries a private
 * marker and an id derived from its permanent ledger UID, so syncing is idempotent and never touches
 * events added by hand.
 */
export interface GoogleEvent {
  id: string;
  status?: string;
  iCalUID?: string;
  summary?: string;
  description?: string;
  start?: { date?: string };
  end?: { date?: string };
  transparency?: string;
  visibility?: string;
  source?: { title: string; url: string };
  extendedProperties?: { private?: Record<string, string> };
}

export type SyncOperation =
  | { kind: "insert"; event: GoogleEvent }
  | { kind: "update"; event: GoogleEvent }
  | { kind: "delete"; id: string };

const MARKER = "livingOrthodoxManaged";
const BASE32HEX = "0123456789abcdefghijklmnopqrstuv";

/** A Google event id (base32hex, 52 characters) derived from the ledger UID; stable forever. */
export function googleEventId(uid: string): string {
  const bytes = createHash("sha256").update(uid).digest();
  let bits = 0;
  let value = 0;
  let id = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      id += BASE32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) id += BASE32HEX[(value << (5 - bits)) & 31];
  return id;
}

export interface DesiredEvents {
  /** Events that should exist, by id. */
  present: Map<string, GoogleEvent>;
  /** Ids of withdrawn events. */
  withdrawn: Set<string>;
  /** Ids of every event in the ledger; managed events not among them are removed. */
  known: Set<string>;
}

/** The Google Calendar this calendar's feed describes. Tombstoned events are absent, not cancelled copies. */
export function desiredEvents(snapshot: CalendarSnapshot, ledger: Ledger, options: FeedOptions): DesiredEvents {
  const present = new Map<string, GoogleEvent>();
  for (const item of feedItems(snapshot, ledger, options)) {
    if (item.cancelled) continue;
    const id = googleEventId(item.uid);
    present.set(id, {
      id,
      iCalUID: item.uid,
      status: "confirmed",
      summary: item.title,
      description: item.description,
      start: { date: item.date },
      end: { date: nextDay(item.date) },
      transparency: "transparent",
      visibility: "public",
      ...(item.link ? { source: { title: "Living Orthodox", url: item.link } } : {}),
      extendedProperties: { private: { [MARKER]: "1", configurationId: snapshot.configuration.id, eventId: item.eventId } },
    });
  }
  return {
    present,
    withdrawn: new Set(ledger.entries.filter((e) => e.status === "cancelled").map((e) => googleEventId(e.uid))),
    known: new Set(ledger.entries.map((e) => googleEventId(e.uid))),
  };
}

/** The fields the publisher owns; anything else Google adds is ignored when comparing. */
function managed(event: GoogleEvent): string {
  return canonicalJson({
    status: event.status ?? "confirmed",
    summary: event.summary ?? null,
    description: event.description ?? null,
    start: event.start?.date ?? null,
    end: event.end?.date ?? null,
    transparency: event.transparency ?? "opaque",
    visibility: event.visibility ?? "default",
    source: event.source ?? null,
    extendedProperties: event.extendedProperties?.private ?? null,
  });
}

/**
 * The operations that turn the managed events Google holds (listed with deleted events) into the
 * desired ones. Deleted events are restored by update, because Google keeps their ids reserved.
 */
export function planSync(desired: DesiredEvents, existing: GoogleEvent[]): SyncOperation[] {
  const current = new Map(existing.filter((e) => e.extendedProperties?.private?.[MARKER] === "1").map((e) => [e.id, e]));
  const operations: SyncOperation[] = [];
  for (const [id, event] of [...desired.present].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const held = current.get(id);
    if (!held) operations.push({ kind: "insert", event });
    else if (managed(held) !== managed(event)) operations.push({ kind: "update", event });
  }
  for (const [id, held] of [...current].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (held.status === "cancelled" || desired.present.has(id)) continue;
    // Withdrawn events and events this calendar's ledger never had are removed. Active events outside
    // the feed window (older history, or not yet in range) are left as they are.
    if (desired.withdrawn.has(id) || !desired.known.has(id)) operations.push({ kind: "delete", id });
  }
  return operations;
}

// --- Google APIs ---

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  status: number;
  ok: boolean;
  text(): Promise<string>;
}>;

export class GoogleApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const base64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** A signed service-account assertion (RFC 7523), valid for ten minutes from `now` (seconds). */
export function serviceAccountAssertion(account: ServiceAccount, now: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: account.client_email, scope: SCOPE, aud: account.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 600,
  }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.private_key);
  return `${header}.${claims}.${base64url(signature)}`;
}

export interface ClientOptions {
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Attempts per request for 429 and 5xx responses. */
  attempts?: number;
}

export class GoogleCalendarClient {
  readonly #fetch: Fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #attempts: number;
  readonly #calendarId: string;
  readonly #token: string;

  private constructor(calendarId: string, token: string, options: ClientOptions) {
    this.#calendarId = calendarId;
    this.#token = token;
    this.#fetch = options.fetch ?? (fetch as unknown as Fetch);
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#attempts = options.attempts ?? 4;
  }

  static async connect(account: ServiceAccount, calendarId: string, options: ClientOptions = {}): Promise<GoogleCalendarClient> {
    const request = options.fetch ?? (fetch as unknown as Fetch);
    const response = await request(account.token_uri ?? "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: serviceAccountAssertion(account, Math.floor(Date.now() / 1000)),
      }).toString(),
    });
    const body = await response.text();
    if (!response.ok) throw new GoogleApiError(`Google sign-in failed (${response.status}): ${errorMessage(body)}`, response.status);
    const token = (JSON.parse(body) as { access_token?: string }).access_token;
    if (!token) throw new GoogleApiError("Google sign-in returned no access token", response.status);
    return new GoogleCalendarClient(calendarId, token, options);
  }

  #url(path = "", query?: Record<string, string>): string {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.#calendarId)}/events${path}`;
    return query ? `${url}?${new URLSearchParams(query).toString()}` : url;
  }

  async #request(method: string, url: string, body?: unknown, allow: number[] = []): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      const response = await this.#fetch(url, {
        method,
        headers: { authorization: `Bearer ${this.#token}`, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      if (response.ok || allow.includes(response.status)) return text;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= this.#attempts) {
        throw new GoogleApiError(`Google Calendar ${method} failed (${response.status}): ${errorMessage(text)}`, response.status);
      }
      await this.#sleep(1000 * 2 ** (attempt - 1));
    }
  }

  /** Every managed event, including deleted ones (Google keeps their ids reserved). */
  async listManaged(): Promise<GoogleEvent[]> {
    const events: GoogleEvent[] = [];
    let pageToken: string | undefined;
    do {
      const query: Record<string, string> = { showDeleted: "true", maxResults: "2500", privateExtendedProperty: `${MARKER}=1` };
      if (pageToken) query.pageToken = pageToken;
      const page = JSON.parse(await this.#request("GET", this.#url("", query))) as { items?: GoogleEvent[]; nextPageToken?: string };
      events.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return events;
  }

  async apply(operation: SyncOperation): Promise<void> {
    if (operation.kind === "insert") await this.#request("POST", this.#url(), operation.event);
    else if (operation.kind === "update") await this.#request("PUT", this.#url(`/${operation.event.id}`), operation.event);
    else await this.#request("DELETE", this.#url(`/${operation.id}`), undefined, [404, 410]);
  }
}

/** Google's error message only; responses never include the token, but keep output short anyway. */
function errorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; error_description?: string };
    if (typeof parsed.error === "object" && parsed.error?.message) return parsed.error.message;
    return parsed.error_description ?? String(parsed.error ?? "unknown error");
  } catch {
    return body.slice(0, 200);
  }
}
