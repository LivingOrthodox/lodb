import { createHash } from "node:crypto";

/** JSON with object keys sorted at every level and no whitespace; the basis for digests. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return inner;
  });
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The digest a review must carry to approve this exact record. */
export function recordDigest(record: unknown): string {
  return sha256Hex(canonicalJson(record));
}
