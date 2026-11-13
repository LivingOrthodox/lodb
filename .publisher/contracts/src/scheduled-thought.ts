import { z } from "zod";
import { absent, assetPath, civilDate, httpsUrl, identifier, locale, text, uniqueList } from "./primitives.ts";

/**
 * Editorial authoring format for a daily thought in the lodb repository: one JSON file per
 * scheduled thought (daily/scheduled/<id>.json). The publisher converts it into a DailyThought and,
 * when an image is given, a DailyBackground assigned to the same date. Never read by the apps.
 */
export const ScheduledThought = z
  .object({
    id: identifier,
    date: civilDate.meta({ description: "The civil date this thought is shown." }),
    locale: locale.default("en"),
    quote: text(2000).meta({ description: "The quotation or reflection text." }),
    author: text(200).meta({ description: "The person who actually wrote or said it." }),
    attribution: text(500).meta({ description: "Full attribution, e.g. work and section." }),
    kind: z.enum(["quotation", "originalReflection"]).default("quotation"),
    publisher: absent(text(200)),
    originalPublicationDate: absent(civilDate),
    sourceIds: uniqueList(identifier, 20).refine((ids) => ids.length >= 1, "At least one source").meta({ minItems: 1 }),
    reflection: absent(text(2000)),
    practicalAction: absent(text(1000)),
    tags: uniqueList(identifier, 20).default([]),
    background: absent(
      z
        .object({
          image: assetPath.meta({ description: "Path of a licensed image in the repository, e.g. assets/backgrounds/x.jpg." }),
          altText: text(300),
          focalPoint: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).default({ x: 0.5, y: 0.5 }),
          photographer: text(200),
          license: text(200),
          licenseUrl: absent(httpsUrl),
          attributionText: text(500),
        })
        .meta({ title: "ScheduledBackground" }),
    ),
    status: z.enum(["published", "withdrawn"]).default("published"),
    isDevelopmentContent: z.boolean().default(false),
  })
  .meta({ title: "ScheduledThought" });

export type ScheduledThought = z.infer<typeof ScheduledThought>;
