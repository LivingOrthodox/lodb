import { z } from "zod";
import { httpsUrl, identifier, locale, text, uniqueList } from "./primitives.ts";

/** The five learning paths. Adding one is a contract change. */
export const LEARNING_PATH_IDS = [
  "discovering-orthodoxy",
  "living-the-faith",
  "wisdom-and-virtue",
  "understanding-the-church",
  "orthodoxy-in-modern-life",
] as const;

const block = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ type: z.literal(type), id: identifier, ...shape }).meta({ title: `${type}Block` });

/**
 * Safe, renderer-neutral lesson content. Apps render these natively; there is no HTML,
 * Markdown, script or remote image. Block ids are stable so reading position survives revisions.
 */
export const ContentBlock = z
  .discriminatedUnion("type", [
    block("paragraph", { text: text(5000) }),
    block("heading", { text: text(200) }),
    block("list", { style: z.enum(["bulleted", "numbered"]), items: z.array(text(1000)).min(1).max(50) }),
    block("quote", { text: text(2000), author: text(200), sourceId: identifier }),
    block("term", { term: text(100), definition: text(1000) }),
    block("lessonReference", { lessonId: identifier, label: text(200) }),
    block("externalLink", { url: httpsUrl, label: text(200) }),
  ])
  .meta({ title: "ContentBlock" });

export const Lesson = z
  .object({
    id: identifier,
    locale,
    pathId: z.enum(LEARNING_PATH_IDS),
    pathOrder: z.int().min(1).max(1000).meta({ description: "Position within the path; ties break by id." }),
    title: text(200),
    summary: text(500),
    objectives: z.array(text(300)).min(1).max(8),
    learn: z
      .array(ContentBlock)
      .min(1)
      .max(200)
      .refine((blocks) => new Set(blocks.map((b) => b.id)).size === blocks.length, "Block ids must be unique"),
    reflect: z.array(text(500)).min(1).max(10).meta({ description: "Questions to consider." }),
    live: z.array(text(500)).min(1).max(10).meta({ description: "Practical applications." }),
    sourceIds: uniqueList(identifier, 30).refine((ids) => ids.length >= 1, "At least one source").meta({ minItems: 1 }),
    relatedLessonIds: uniqueList(identifier, 20),
    difficulty: z.enum(["introductory", "intermediate", "advanced"]),
    status: z.enum(["published", "withdrawn"]),
    revision: z.int().min(1),
    isDevelopmentContent: z.boolean(),
  })
  .meta({ title: "Lesson", description: "A reviewed lesson organized as Learn, Reflect, Live." });

export type Lesson = z.infer<typeof Lesson>;
export type ContentBlock = z.infer<typeof ContentBlock>;
