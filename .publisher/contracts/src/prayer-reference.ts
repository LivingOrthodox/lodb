import { z } from "zod";
import { absent, identifier, text } from "./primitives.ts";

// Links are only bounded here; each app's PrayerLinkResolver applies the
// allowlists and URL rules before anything can be opened.
const link = absent(text(2048));

export const PrayerReference = z
  .object({
    id: identifier,
    title: text(200),
    validationStatus: z.enum(["pending", "validated", "unavailable"]),
    iosLink: link,
    macosLink: link,
    androidLink: link,
    webFallback: link,
  })
  .meta({
    title: "PrayerReference",
    description: "A provider-independent prayer reference. Only validated references can open anything.",
  });

export type PrayerReference = z.infer<typeof PrayerReference>;
