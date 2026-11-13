import { ASSET_PATH_PATTERN } from "@living-orthodox/content-contracts";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * The editorial repository layout (all files optional; collections are JSON arrays):
 *   sources.json                     SourceReference[]
 *   daily/scheduled/<id>.json        ScheduledThought (one per file; the usual way to author thoughts)
 *   daily/thoughts.json              DailyThought[]
 *   daily/backgrounds.json           DailyBackground[]
 *   assets/...                       licensed images referenced by scheduled thoughts
 *   lessons/<id>.json                Lesson (one per file)
 *   calendars/<id>/configuration.json, events.json, days.json
 *   reviews.json                     EditorialReview[] (never published)
 * Records are kept exactly as authored so review digests bind to what was written.
 */
/** Images larger than this are rejected; publish optimized mobile images. */
export const MAX_ASSET_BYTES = 15_000_000;

export interface RawCalendar {
  directory: string;
  configuration: unknown;
  events: unknown[];
  days: unknown[];
}

export interface EditorialInput {
  /** The repository root, for reading referenced assets. */
  root: string;
  sources: unknown[];
  scheduled: { file: string; record: unknown }[];
  /** Bytes of assets referenced by scheduled thoughts, by repository path (undefined if missing or too large). */
  assets: Map<string, Uint8Array | undefined>;
  thoughts: unknown[];
  backgrounds: unknown[];
  lessons: { file: string; record: unknown }[];
  calendars: RawCalendar[];
  reviews: unknown[];
}

async function readJson(path: string): Promise<unknown | undefined> {
  const text = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${path}: invalid JSON (${(error as Error).message})`);
  }
}

async function readArray(path: string): Promise<unknown[]> {
  const value = await readJson(path);
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${path}: expected a JSON array`);
  return value;
}

async function list(directory: string): Promise<string[]> {
  return (await readdir(directory).catch(() => [] as string[])).sort();
}

export async function loadEditorial(root: string): Promise<EditorialInput> {
  const lessons: EditorialInput["lessons"] = [];
  for (const file of (await list(join(root, "lessons"))).filter((f) => f.endsWith(".json"))) {
    lessons.push({ file: `lessons/${file}`, record: await readJson(join(root, "lessons", file)) });
  }
  const calendars: RawCalendar[] = [];
  for (const directory of await list(join(root, "calendars"))) {
    const base = join(root, "calendars", directory);
    calendars.push({
      directory: `calendars/${directory}`,
      configuration: await readJson(join(base, "configuration.json")),
      events: await readArray(join(base, "events.json")),
      days: await readArray(join(base, "days.json")),
    });
  }
  const scheduled: EditorialInput["scheduled"] = [];
  for (const file of (await list(join(root, "daily", "scheduled"))).filter((f) => f.endsWith(".json"))) {
    scheduled.push({ file: `daily/scheduled/${file}`, record: await readJson(join(root, "daily", "scheduled", file)) });
  }
  const assets = new Map<string, Uint8Array | undefined>();
  for (const { record } of scheduled) {
    const image = (record as { background?: { image?: unknown } } | null)?.background?.image;
    // Only well-formed asset paths are read, so nothing outside assets/ can be referenced.
    if (typeof image !== "string" || !ASSET_PATH_PATTERN.test(image) || assets.has(image)) continue;
    const info = await stat(join(root, image)).catch(() => undefined);
    assets.set(image, info?.isFile() && info.size <= MAX_ASSET_BYTES ? new Uint8Array(await readFile(join(root, image))) : undefined);
  }
  return {
    root,
    sources: await readArray(join(root, "sources.json")),
    scheduled,
    assets,
    thoughts: await readArray(join(root, "daily", "thoughts.json")),
    backgrounds: await readArray(join(root, "daily", "backgrounds.json")),
    lessons,
    calendars,
    reviews: await readArray(join(root, "reviews.json")),
  };
}
