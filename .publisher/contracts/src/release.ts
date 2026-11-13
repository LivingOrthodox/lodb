import { z } from "zod";
import { civilDate, identifier, sha256, text } from "./primitives.ts";

/** A path inside a release: lowercase segments, .json, no "." or ".." segments. */
export const RELEASE_PATH_PATTERN = /^(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.json$/;
const releasePath = z.string().max(200).regex(RELEASE_PATH_PATTERN);
/** A release file: a JSON content file or an image asset under assets/. */
export const RELEASE_FILE_PATTERN = /^(?:(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.json|assets\/(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.(?:jpg|heic|webp|png))$/;

export const ReleaseFile = z
  .object({
    path: z.string().max(200).regex(RELEASE_FILE_PATTERN).meta({ description: "Relative to the release directory." }),
    kind: z.enum(["sources", "daily", "library", "calendar", "asset"]),
    sha256,
    bytes: z.int().min(1).max(20_000_000),
  })
  .refine(
    (f) => (f.kind === "asset" ? f.path.startsWith("assets/") && !f.path.endsWith(".json") : !f.path.startsWith("assets/") && f.path.endsWith(".json")),
    "Assets are images under assets/; content files are JSON outside it",
  )
  .meta({ title: "ReleaseFile" });

/** Describes one immutable content release. Apps verify every file's size and hash before activation. */
export const ReleaseManifest = z
  .object({
    schemaVersion: z.literal(1),
    contractVersion: z.int().min(1),
    releaseId: identifier,
    channel: z.enum(["development", "production"]),
    publishedAt: z.iso.datetime({ offset: false }).meta({ description: "UTC timestamp, e.g. 2026-10-13T12:00:00Z." }),
    algorithms: z.object({ daily: z.literal("daily-v1"), calendar: z.literal("calendar-v1") }).meta({ title: "ReleaseAlgorithms" }),
    files: z
      .array(ReleaseFile)
      .min(1)
      .max(200)
      .refine((files) => new Set(files.map((f) => f.path)).size === files.length, "File paths must be unique"),
    coverage: z.array(z.object({ configurationId: identifier, start: civilDate, end: civilDate }).meta({ title: "ReleaseCoverage" })).max(50),
    withdrawn: z.array(z.string().max(200)).max(10_000).meta({ description: "Record keys withdrawn in this release, e.g. thought:some-id." }),
  })
  .meta({ title: "ReleaseManifest" });

/** The small mutable file an app polls; it names one immutable release. */
export const ChannelPointer = z
  .object({
    schemaVersion: z.literal(1),
    channel: z.enum(["development", "production"]),
    releaseId: identifier,
    manifestPath: releasePath.meta({ description: "Relative to the content root, e.g. releases/<id>/manifest.json." }),
    manifestSha256: sha256,
  })
  .meta({ title: "ChannelPointer" });

/** Editorial-side only; never published to apps. Approval is bound to the exact record digest. */
export const EditorialReview = z
  .object({
    recordKey: z.string().regex(/^(?:thought|lesson|calendar):[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
    digest: sha256.meta({ description: "SHA-256 of the record's canonical JSON; any edit invalidates the approval." }),
    status: z.enum(["approved", "changesRequested"]),
    reviewerRole: text(100),
    reviewerReference: identifier.meta({ description: "Opaque reference to the reviewer's authorization record. No names." }),
    authority: z.enum(["doctrine", "commentary", "jurisdictionalCustom", "pastoralGuidance", "devotionalTradition", "historicalAccount"]),
    reviewedOn: civilDate,
    evidenceReference: identifier,
  })
  .meta({ title: "EditorialReview" });

export type ReleaseManifest = z.infer<typeof ReleaseManifest>;
export type ChannelPointer = z.infer<typeof ChannelPointer>;
export type EditorialReview = z.infer<typeof EditorialReview>;
