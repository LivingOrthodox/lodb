// Usage:
//   node tools/content-publisher/src/cli.ts validate --input <dir> --channel development|production
//   node tools/content-publisher/src/cli.ts build --input <dir> --channel <c> --output <dir> --release-id <id> --published-at <UTC>
//   node tools/content-publisher/src/cli.ts publish --input <dir> --channel <c> --output <content root> --release-id <id> --published-at <UTC>
//       (like build, but writes nothing when the content apps would receive is unchanged)
//   node tools/content-publisher/src/cli.ts build-site --input <dir> --channel <c> --ledgers <dir> --output <site dir> --now <UTC>
//       [--link-base https://host] [--first-publication <configurationId> ...]
//       [--apple-app-id TEAMID.bundle.id ...] [--android-package <name> --android-fingerprint <SHA-256> ...]
//   (build-feeds is an alias of build-site.)
//   node tools/content-publisher/src/cli.ts sync-google --input <dir> --channel <c> --ledgers <dir> --now <UTC>
//       [--link-base https://host] [--first-publication <configurationId> ...] [--dry-run]
//       Syncs each calendar whose configuration names a googleCalendarId into that public Google Calendar,
//       signing in with the service-account key JSON in GOOGLE_SERVICE_ACCOUNT_JSON.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { buildRelease } from "./build-release.ts";
import { loadEditorial } from "./editorial.ts";
import { publishRelease } from "./publish.ts";
import { desiredEvents, GoogleApiError, GoogleCalendarClient, planSync, type ServiceAccount } from "./google-calendar.ts";
import { generateIcs } from "./ical.ts";
import { renderSite, SiteError } from "./render-web.ts";
import { type Ledger, LedgerError, updateLedger } from "./ledger.ts";
import { randomUUID } from "node:crypto";
import { type Channel, type Issue, validateEditorial } from "./validate.ts";

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    input: { type: "string" },
    channel: { type: "string" },
    output: { type: "string" },
    "release-id": { type: "string" },
    "published-at": { type: "string" },
    ledgers: { type: "string" },
    now: { type: "string" },
    "link-base": { type: "string" },
    "first-publication": { type: "string", multiple: true },
    "apple-app-id": { type: "string", multiple: true },
    "android-package": { type: "string" },
    "android-fingerprint": { type: "string", multiple: true },
    "dry-run": { type: "boolean" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const channel = values.channel as Channel | undefined;
if (!values.input || (channel !== "development" && channel !== "production")) {
  fail("Required: --input <dir> --channel development|production");
}
if (!["validate", "build", "publish", "build-site", "build-feeds", "sync-google"].includes(command ?? "")) {
  fail("Command must be validate, build, publish, build-site or sync-google");
}

const report = (label: string, issues: Issue[]) => {
  for (const issue of issues) console.error(`${label} [${issue.code}] ${issue.at}: ${issue.message}`);
};

const result = validateEditorial(await loadEditorial(values.input), channel);
report("warning", result.warnings);
report("error", result.errors);
if (result.errors.length > 0) fail(`${result.errors.length} error(s); nothing was published.`);
console.log(`Valid for ${channel}: ${result.warnings.length} warning(s).`);

if (command === "build") {
  const output = values.output ?? fail("Required: --output <dir>");
  const releaseId = values["release-id"] ?? fail("Required: --release-id <id>");
  const publishedAt = values["published-at"] ?? fail("Required: --published-at <UTC timestamp>");
  const releaseDirectory = join(output, "releases", releaseId);
  // Releases are immutable: never overwrite one that already exists.
  if (await stat(releaseDirectory).catch(() => undefined)) fail(`${releaseDirectory} already exists; releases are immutable.`);
  const files = buildRelease(result.content, { channel, releaseId, publishedAt });
  // Write the release first and the channel pointer last, so a pointer never names a partial release.
  const ordered = [...files].sort(([a], [b]) => Number(a.startsWith("channels/")) - Number(b.startsWith("channels/")));
  for (const [path, body] of ordered) {
    await mkdir(dirname(join(output, path)), { recursive: true });
    await writeFile(join(output, path), body);
  }
  console.log(`Wrote release ${releaseId} (${files.size} files) to ${output}.`);
}

if (command === "publish") {
  const output = values.output ?? fail("Required: --output <content root>");
  const releaseId = values["release-id"] ?? fail("Required: --release-id <id>");
  const publishedAt = values["published-at"] ?? fail("Required: --published-at <UTC timestamp>");
  const published = await publishRelease(result.content, output, { channel, releaseId, publishedAt }).catch((error: Error) => fail(error.message));
  if (published.outcome === "unchanged") console.log(`Unchanged: ${channel} still names release ${published.releaseId}; nothing written.`);
  else console.log(`Published release ${published.releaseId} (${published.files} files) to the ${channel} channel${published.previousReleaseId ? `, replacing ${published.previousReleaseId}` : ""}.`);
}

const sourceTitle = (id: string) => result.content.sources.find((s) => s.id === id)?.title ?? id;

/** Carries a calendar's identity ledger forward (see ledger.ts) and saves it unless this is a dry run. */
async function advanceLedger(snapshot: (typeof result.content.calendars)[number], ledgers: string, now: string, dryRun: boolean): Promise<Ledger> {
  const id = snapshot.configuration.id;
  const ledgerPath = join(ledgers, `${id}.json`);
  const previous = await readFile(ledgerPath, "utf8").then((t) => JSON.parse(t) as Ledger).catch(() => undefined);
  const firstPublication = new Set(values["first-publication"] ?? []);
  let update;
  try {
    // Without a ledger, only an explicitly acknowledged first publication may allocate identities.
    update = updateLedger(previous, snapshot, { now, feedPublished: !previous && !firstPublication.has(id), newUid: () => `${randomUUID()}@living-orthodox`, sourceTitle });
  } catch (error) {
    if (error instanceof LedgerError) fail(`${error.message} (pass --first-publication ${id} only if this calendar has never been published)`);
    throw error;
  }
  if (!dryRun) {
    await mkdir(ledgers, { recursive: true });
    await writeFile(ledgerPath, `${JSON.stringify(update.ledger, null, 2)}\n`);
  }
  console.log(`${id}: ${update.changes.length} ledger change(s)${dryRun ? " (dry run; ledger not saved)" : ""}.`);
  return update.ledger;
}

if (command === "sync-google") {
  const ledgers = values.ledgers ?? fail("Required: --ledgers <dir> (the persistent identity ledgers)");
  const now = values.now ?? fail("Required: --now <UTC timestamp>");
  const linkBase = values["link-base"];
  if (linkBase && !/^https:\/\/[a-z0-9.-]+$/.test(linkBase)) fail("--link-base must be https://host with no path.");
  const dryRun = values["dry-run"] ?? false;
  const calendars = result.content.calendars.filter((c) => c.configuration.googleCalendarId);
  if (calendars.length === 0) {
    console.log("No calendar names a googleCalendarId; nothing to sync.");
  } else {
    const key = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? fail("GOOGLE_SERVICE_ACCOUNT_JSON must hold the service account's JSON key.");
    let account: ServiceAccount;
    try {
      account = JSON.parse(key) as ServiceAccount;
    } catch {
      fail("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
    if (!account.client_email || !account.private_key) fail("GOOGLE_SERVICE_ACCOUNT_JSON needs client_email and private_key.");
    for (const snapshot of calendars) {
      const id = snapshot.configuration.id;
      const ledger = await advanceLedger(snapshot, ledgers, now, dryRun);
      const desired = desiredEvents(snapshot, ledger, { now, sourceTitle, ...(linkBase ? { linkBase } : {}) });
      try {
        const client = await GoogleCalendarClient.connect(account, snapshot.configuration.googleCalendarId!);
        const operations = planSync(desired, await client.listManaged());
        const counts = ["insert", "update", "delete"].map((kind) => `${operations.filter((o) => o.kind === kind).length} ${kind}`).join(", ");
        if (dryRun) {
          console.log(`${id}: would apply ${counts} (dry run).`);
          for (const operation of operations) console.log(`  ${operation.kind} ${operation.kind === "delete" ? operation.id : `${operation.event.id} ${operation.event.start?.date} ${operation.event.summary}`}`);
        } else {
          for (const operation of operations) await client.apply(operation);
          console.log(`${id}: Google Calendar in sync (${counts}).`);
        }
      } catch (error) {
        if (error instanceof GoogleApiError) fail(`${id}: ${error.message}`);
        throw error;
      }
    }
  }
}

if (command === "build-site" || command === "build-feeds") {
  const ledgers = values.ledgers ?? fail("Required: --ledgers <dir> (the persistent identity ledgers)");
  const output = values.output ?? fail("Required: --output <site dir>");
  const now = values.now ?? fail("Required: --now <UTC timestamp>");
  const linkBase = values["link-base"];
  if (channel === "production" && !linkBase) fail("Production feeds require --link-base, the controlled HTTPS domain.");
  if (linkBase && !/^https:\/\/[a-z0-9.-]+$/.test(linkBase)) fail("--link-base must be https://host with no path.");
  const ledgersById = new Map<string, Ledger>();
  for (const snapshot of result.content.calendars) {
    const id = snapshot.configuration.id;
    const ledger = await advanceLedger(snapshot, ledgers, now, false);
    const ics = generateIcs(snapshot, ledger, { now, sourceTitle, ...(linkBase ? { linkBase } : {}) });
    await mkdir(join(output, "calendars"), { recursive: true });
    await writeFile(join(output, "calendars", `${id}.ics`), ics);
    ledgersById.set(id, ledger);
    console.log(`${id}: wrote calendars/${id}.ics.`);
  }
  const androidPackage = values["android-package"];
  let pages;
  try {
    pages = renderSite(result.content, {
      ledgers: ledgersById,
      associations: {
        ...(values["apple-app-id"] ? { appleAppIds: values["apple-app-id"] } : {}),
        ...(androidPackage ? { android: { packageName: androidPackage, sha256Fingerprints: values["android-fingerprint"] ?? [] } } : {}),
      },
    });
  } catch (error) {
    if (error instanceof SiteError) fail(error.message);
    throw error;
  }
  for (const [path, body] of pages) {
    await mkdir(dirname(join(output, path)), { recursive: true });
    await writeFile(join(output, path), body);
  }
  console.log(`Wrote ${pages.size} site files to ${output}.`);
}
