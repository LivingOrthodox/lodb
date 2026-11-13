import { type CalendarSnapshot, resolveCalendarDay } from "@living-orthodox/content-contracts";
import type { Ledger } from "./ledger.ts";
import type { ValidatedContent } from "./validate.ts";

/** Identifiers for verified links; supplied by the owner, never invented. */
export interface AppAssociations {
  /** Apple application identifiers, TEAMID.bundle.id. */
  appleAppIds?: string[];
  android?: { packageName: string; sha256Fingerprints: string[] };
}

export interface SiteOptions {
  /** Ledgers by configuration id, so withdrawn observances keep a page. */
  ledgers?: Map<string, Ledger>;
  associations?: AppAssociations;
}

export class SiteError extends Error {}

const APPLE_APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const ANDROID_PACKAGE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const FINGERPRINT = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

const FOOD_NAMES: Record<string, string> = {
  meat: "meat", dairy: "dairy", eggs: "eggs", fish: "fish", shellfish: "shellfish", wine: "wine", oliveOil: "olive oil", otherOil: "other oils",
};

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} · Living Orthodox</title>
<style>
:root { color-scheme: light dark; --bg: #FAF6EF; --fg: #1C1B19; --muted: #5F5A52; --accent: #203C5D; }
@media (prefers-color-scheme: dark) { :root { --bg: #14171C; --fg: #EDE9E2; --muted: #A9A39A; --accent: #A8C8EF; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 42rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 600; line-height: 1.2; }
.muted, footer { color: var(--muted); }
.note { border-left: 3px solid var(--accent); padding: .25rem .75rem; }
a { color: var(--accent); }
section { margin-top: 2rem; }
</style>
</head>
<body>
<main>
${body}
<footer><p>Living Orthodox is a free, account-free companion. It complements parish life and pastoral guidance.</p></footer>
</main>
</body>
</html>
`;
}

const humanDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

function fastingSummary(snapshot: CalendarSnapshot, date: string): string {
  const resolution = resolveCalendarDay(snapshot, date);
  if (resolution.status !== "covered") return "";
  if (!resolution.fasting) return `<p class="muted">No fasting guidance is published for this day.</p>`;
  const list = (foods: string[]) => foods.map((f) => FOOD_NAMES[f] ?? f).join(", ");
  const parts = [
    resolution.fasting.abstained.length ? `Traditionally abstained: ${list(resolution.fasting.abstained)}.` : "",
    resolution.fasting.permitted.length ? `Permitted: ${list(resolution.fasting.permitted)}.` : "",
    resolution.fasting.unspecified.length ? `Not specified: ${list(resolution.fasting.unspecified)}.` : "",
  ].filter(Boolean);
  return `<h3>Fasting</h3>
<p>${escapeHtml(parts.join(" "))}</p>
<p class="muted">Fasting practices may vary by jurisdiction and personal circumstances. Your priest can help guide your individual practice.</p>`;
}

/**
 * Renders the browser fallback site from validated content: observance pages (including withdrawn
 * ones), a page per covered date with a section per calendar, a landing page, and the verified-link
 * association files when identifiers are supplied. No scripts, trackers or external resources.
 */
export function renderSite(content: ValidatedContent, options: SiteOptions = {}): Map<string, string> {
  const files = new Map<string, string>();
  const sourceTitle = (id: string) => content.sources.find((s) => s.id === id)?.title ?? "Source details unavailable";
  const calendars = [...content.calendars].sort((a, b) => (a.configuration.id < b.configuration.id ? -1 : 1));

  for (const snapshot of calendars) {
    const { configuration } = snapshot;
    const label = configuration.isDevelopmentContent ? `<p class="note">Development content — not an authoritative Church calendar.</p>` : "";
    const eventIds = new Set([...snapshot.events.map((e) => e.id), ...(options.ledgers?.get(configuration.id)?.entries.map((e) => e.eventId) ?? [])]);
    for (const id of [...eventIds].sort()) {
      const event = snapshot.events.find((e) => e.id === id);
      const withdrawn = !event || event.status !== "published";
      const title = event?.title ?? "Withdrawn observance";
      const body = withdrawn
        ? `<h1>${escapeHtml(title)}</h1>
<p class="note">This observance was withdrawn from ${escapeHtml(configuration.name)}. It is kept here so earlier links still explain what happened.</p>`
        : `<p class="muted">${escapeHtml(event.kind[0]!.toUpperCase() + event.kind.slice(1))} · ${escapeHtml(configuration.name)}</p>
<h1>${escapeHtml(event.title)}</h1>
<p>${escapeHtml(humanDate(event.date))}</p>
${label}
${event.description ? `<p>${escapeHtml(event.description)}</p>` : ""}
${event.scriptureReferences.length ? `<section><h2>Readings</h2><ul>${event.scriptureReferences.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul></section>` : ""}
<section><h2>Sources</h2><ul>${event.sourceIds.map((s) => `<li>${escapeHtml(sourceTitle(s))}</li>`).join("")}</ul></section>
<section><p><a href="/calendar/${event.date}/">All observances on this day</a></p>
<p>If Living Orthodox is installed, this link opens it directly. <a href="/calendars/${configuration.id}.ics">Subscribe to ${escapeHtml(configuration.name)}</a>.</p></section>`;
      files.set(`observances/${configuration.id}/${id}/index.html`, page(title, body));
    }
  }

  // One page per covered date, with a section per calendar covering it.
  const dates = new Set<string>();
  for (const snapshot of calendars) for (const day of snapshot.days) dates.add(day.date);
  for (const date of [...dates].sort()) {
    const sections = calendars
      .filter((s) => s.days.some((d) => d.date === date))
      .map((snapshot) => {
        const resolution = resolveCalendarDay(snapshot, date);
        const events = resolution.status === "covered" ? resolution.eventIds.map((id) => snapshot.events.find((e) => e.id === id)!).filter(Boolean) : [];
        return `<section><h2>${escapeHtml(snapshot.configuration.name)}</h2>
${snapshot.configuration.isDevelopmentContent ? `<p class="note">Development content — not an authoritative Church calendar.</p>` : ""}
${events.length ? `<ul>${events.map((e) => `<li><a href="/observances/${snapshot.configuration.id}/${e.id}/">${escapeHtml(e.title)}</a></li>`).join("")}</ul>` : `<p class="muted">No observances listed for this day.</p>`}
${fastingSummary(snapshot, date)}
</section>`;
      });
    files.set(`calendar/${date}/index.html`, page(humanDate(date), `<h1>${escapeHtml(humanDate(date))}</h1>\n${sections.join("\n")}`));
  }

  files.set(
    "index.html",
    page("Calendars", `<h1>Living Orthodox</h1>
<p>The Ancient Faith. Lived Today.</p>
<section><h2>Calendar subscriptions</h2>
${calendars.length ? `<ul>${calendars.map((s) => `<li><a href="/calendars/${s.configuration.id}.ics">${escapeHtml(s.configuration.name)}</a>${s.configuration.isDevelopmentContent ? " (development content)" : ""}</li>`).join("")}</ul>
<p class="muted">Add a calendar by its link in your calendar app. Google Calendar subscriptions are added from a computer web browser.</p>` : `<p class="muted">No calendars are published yet.</p>`}
</section>`),
  );

  const { associations } = options;
  if (associations?.appleAppIds?.length) {
    for (const id of associations.appleAppIds) if (!APPLE_APP_ID.test(id)) throw new SiteError(`Invalid Apple app id ${id}`);
    files.set(
      ".well-known/apple-app-site-association",
      `${JSON.stringify({ applinks: { details: [{ appIDs: associations.appleAppIds, components: [{ "/": "/observances/*" }, { "/": "/calendar/*" }] }] } }, null, 2)}\n`,
    );
  }
  if (associations?.android) {
    const { packageName, sha256Fingerprints } = associations.android;
    if (!ANDROID_PACKAGE.test(packageName)) throw new SiteError(`Invalid Android package ${packageName}`);
    if (!sha256Fingerprints.length || !sha256Fingerprints.every((f) => FINGERPRINT.test(f))) throw new SiteError("Android signing fingerprints must be SHA-256 (32 colon-separated hex bytes)");
    files.set(
      ".well-known/assetlinks.json",
      `${JSON.stringify([{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: sha256Fingerprints } }], null, 2)}\n`,
    );
  }
  return files;
}
