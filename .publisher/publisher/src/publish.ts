import { ChannelPointer, ReleaseManifest } from "@living-orthodox/content-contracts";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildRelease, type ReleaseOptions } from "./build-release.ts";
import { sha256Hex } from "./canonical.ts";
import type { ValidatedContent } from "./validate.ts";

export type PublishResult =
  | { outcome: "published"; releaseId: string; files: number; previousReleaseId?: string }
  | { outcome: "unchanged"; releaseId: string };

/** What apps actually receive; the release id and timestamp are not part of it. */
function payload(manifest: ReleaseManifest): string {
  const { contractVersion, algorithms, files, coverage, withdrawn } = manifest;
  return JSON.stringify({ contractVersion, algorithms, files, coverage, withdrawn });
}

/** The manifest the channel currently points at, if the pointer and manifest verify; otherwise undefined. */
async function currentManifest(root: string, channel: ReleaseOptions["channel"]): Promise<ReleaseManifest | undefined> {
  try {
    const pointer = ChannelPointer.parse(JSON.parse(await readFile(join(root, "channels", `${channel}.json`), "utf8")));
    const body = await readFile(join(root, pointer.manifestPath), "utf8");
    if (sha256Hex(body) !== pointer.manifestSha256 || pointer.channel !== channel) return undefined;
    return ReleaseManifest.parse(JSON.parse(body));
  } catch {
    return undefined;
  }
}

/**
 * Publishes a release into a content root (the lodb repository checkout) only when what apps would
 * receive differs from the release the channel currently names, so an unchanged push adds nothing.
 * Releases are immutable; the channel pointer is written last so it never names a partial release.
 */
export async function publishRelease(content: ValidatedContent, root: string, options: ReleaseOptions): Promise<PublishResult> {
  const files = buildRelease(content, options);
  const manifest = ReleaseManifest.parse(JSON.parse(files.get(`releases/${options.releaseId}/manifest.json`) as string));
  const current = await currentManifest(root, options.channel);
  if (current && payload(current) === payload(manifest)) return { outcome: "unchanged", releaseId: current.releaseId };

  const releaseDirectory = join(root, "releases", options.releaseId);
  if (await stat(releaseDirectory).catch(() => undefined)) throw new Error(`${releaseDirectory} already exists; releases are immutable.`);
  const ordered = [...files].sort(([a], [b]) => Number(a.startsWith("channels/")) - Number(b.startsWith("channels/")));
  for (const [path, body] of ordered) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
  return { outcome: "published", releaseId: options.releaseId, files: files.size, ...(current ? { previousReleaseId: current.releaseId } : {}) };
}
