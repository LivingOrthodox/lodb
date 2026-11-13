import { z } from "zod";
import { absent, assetPath, civilDate, httpsUrl, identifier, sha256, text, uniqueList } from "./primitives.ts";

const unitInterval = z.number().min(0).max(1);
const pixels = z.int().min(1).max(10000);

export const ImageVariant = z
  .object({
    path: assetPath,
    width: pixels,
    height: pixels,
    sha256,
    format: z.enum(["jpeg", "heic", "webp", "png"]),
  })
  .meta({ title: "ImageVariant" });

export const ImageAttribution = z
  .object({
    photographer: text(200),
    license: text(200),
    licenseUrl: absent(httpsUrl),
    attributionText: text(500),
  })
  .meta({ title: "ImageAttribution", description: "Image credit, kept separate from any thought's provenance." });

export const DailyBackground = z
  .object({
    id: identifier,
    status: z.enum(["published", "withdrawn"]),
    altText: text(300),
    variants: z.array(ImageVariant).min(1).max(6),
    focalPoint: z.object({ x: unitInterval, y: unitInterval }).meta({ title: "FocalPoint" }),
    attribution: ImageAttribution,
    tags: uniqueList(identifier, 20),
    assignedDates: uniqueList(civilDate, 366),
    isDevelopmentContent: z.boolean(),
  })
  .meta({ title: "DailyBackground", description: "A licensed nature photograph for Today." });

export type DailyBackground = z.infer<typeof DailyBackground>;
