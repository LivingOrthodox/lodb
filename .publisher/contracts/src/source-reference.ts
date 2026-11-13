import { z } from "zod";
import { absent, civilDate, httpsUrl, identifier, text } from "./primitives.ts";

export const AllowedUses = z
  .object({
    offlineStorage: z.boolean(),
    redistribution: z.boolean(),
    feedExcerpts: z.boolean(),
    sharing: z.boolean(),
  })
  .meta({
    title: "AllowedUses",
    description: "What the rights evidence permits. Every use is explicit; nothing is implied by omission.",
  });

export const SourceReference = z
  .object({
    id: identifier,
    publisher: text(200),
    title: text(300),
    canonicalUrl: absent(httpsUrl),
    locator: absent(text(200)),
    edition: absent(text(200)),
    translation: absent(text(200)),
    retrievedOn: absent(civilDate),
    rightsReference: identifier.meta({
      description: "ID of the rights/permission record. The evidence itself stays out of public payloads.",
    }),
    allowedUses: AllowedUses,
  })
  .meta({
    title: "SourceReference",
    description: "Where a piece of content comes from and what its rights allow.",
  });

export type SourceReference = z.infer<typeof SourceReference>;
