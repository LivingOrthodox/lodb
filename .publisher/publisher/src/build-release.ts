import { CONTRACT_VERSION, type ChannelPointer, type ReleaseManifest } from "@living-orthodox/content-contracts";
import { canonicalJson, sha256Hex } from "./canonical.ts";
import type { Channel, ValidatedContent } from "./validate.ts";

export interface ReleaseOptions {
  channel: Channel;
  releaseId: string;
  /** UTC timestamp supplied by the caller so builds are reproducible. */
  publishedAt: string;
}

/**
 * Builds a release from validated content. Paths are relative to the content root:
 *   releases/<releaseId>/manifest.json
 *   releases/<releaseId>/content/{sources,daily,library}.json and content/calendars/<id>.json
 *   channels/<channel>.json   (the small pointer apps poll; publish it last)
 * The same input and options always produce byte-identical output.
 */
export function buildRelease(content: ValidatedContent, options: ReleaseOptions): Map<string, string | Uint8Array> {
  const base = `releases/${options.releaseId}`;
  const contentFiles: { path: string; kind: ReleaseManifest["files"][number]["kind"]; body: string | Uint8Array }[] = [
    { path: "content/sources.json", kind: "sources", body: canonicalJson(sortById(content.sources)) },
    { path: "content/daily.json", kind: "daily", body: canonicalJson({ thoughts: sortById(content.thoughts), backgrounds: sortById(content.backgrounds) }) },
    { path: "content/library.json", kind: "library", body: canonicalJson({ lessons: sortById(content.lessons) }) },
    ...[...content.calendars]
      .sort((a, b) => compare(a.configuration.id, b.configuration.id))
      .map((calendar) => ({
        path: `content/calendars/${calendar.configuration.id}.json`,
        kind: "calendar" as const,
        body: canonicalJson({
          configuration: calendar.configuration,
          events: sortById(calendar.events),
          days: [...calendar.days].sort((a, b) => compare(a.date, b.date)),
        }),
      })),
    // Images are shipped as verified assets at the same paths the backgrounds reference.
    ...[...content.assets.keys()].sort(compare).map((path) => ({ path, kind: "asset" as const, body: content.assets.get(path)! })),
  ];

  const withdrawn = [
    ...content.thoughts.filter((t) => t.status === "withdrawn").map((t) => `thought:${t.id}`),
    ...content.lessons.filter((l) => l.status === "withdrawn").map((l) => `lesson:${l.id}`),
    ...content.calendars.flatMap((c) => c.events.filter((e) => e.status === "withdrawn").map((e) => `event:${c.configuration.id}/${e.id}`)),
  ].sort(compare);

  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    contractVersion: CONTRACT_VERSION,
    releaseId: options.releaseId,
    channel: options.channel,
    publishedAt: options.publishedAt,
    algorithms: { daily: "daily-v1", calendar: "calendar-v1" },
    files: contentFiles.map(({ path, kind, body }) => ({ path, kind, sha256: sha256Hex(body), bytes: Buffer.byteLength(body) })),
    coverage: content.calendars
      .map((c) => ({ configurationId: c.configuration.id, start: c.configuration.coverage.start, end: c.configuration.coverage.end }))
      .sort((a, b) => compare(a.configurationId, b.configurationId)),
    withdrawn,
  };
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  const pointer: ChannelPointer = {
    schemaVersion: 1,
    channel: options.channel,
    releaseId: options.releaseId,
    manifestPath: `${base}/manifest.json`,
    manifestSha256: sha256Hex(manifestBody),
  };

  const files = new Map<string, string | Uint8Array>();
  for (const file of contentFiles) files.set(`${base}/${file.path}`, file.body);
  files.set(`${base}/manifest.json`, manifestBody);
  files.set(`channels/${options.channel}.json`, `${JSON.stringify(pointer, null, 2)}\n`);
  return files;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortById = <T extends { id: string }>(records: T[]) => [...records].sort((a, b) => compare(a.id, b.id));
