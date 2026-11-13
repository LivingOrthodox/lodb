import { z } from "zod";
import { absent, civilDate, identifier, locale, text, uniqueList } from "./primitives.ts";

export const DailyThought = z
  .object({
    id: identifier,
    locale,
    origin: z.enum(["editorial", "antiochian"]).meta({
      description: "editorial: chosen in the content repository. antiochian: imported under an authorized agreement.",
    }),
    kind: z.enum(["quotation", "originalReflection"]),
    text: text(2000),
    author: text(200).meta({ description: "The person who actually wrote or said it, not the publishing organization." }),
    attribution: text(500),
    publisher: absent(text(200)),
    originalPublicationDate: absent(civilDate).meta({ description: "When it was first published. Distinct from the dates it is displayed." }),
    sourceIds: uniqueList(identifier, 20).refine((ids) => ids.length >= 1, "At least one source").meta({ minItems: 1 }),
    displayDates: uniqueList(civilDate, 366).meta({ description: "Civil dates this thought is assigned to." }),
    fallbackEligible: z.boolean().meta({ description: "May be shown as a Selected reflection on dates with no assignment." }),
    status: z.enum(["published", "withdrawn"]),
    reflection: absent(text(2000)),
    practicalAction: absent(text(1000)),
    isDevelopmentContent: z.boolean().meta({ description: "Synthetic data for development builds. Release packaging rejects it." }),
  })
  .meta({ title: "DailyThought", description: "A thought shown on Today, with its true author and provenance." });

export type DailyThought = z.infer<typeof DailyThought>;
