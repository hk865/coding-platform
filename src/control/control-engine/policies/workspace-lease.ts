/** Control-owned deterministic domain policy. */
import type { LeaseAdmissibility } from "../../../contracts/workspace-lease.js";



/**
 * FROZEN pure admissibility: a lease is effective ONLY while
 * status === "active" AND (expiresAt === null OR expiresAt > now). An expired
 * lease is not admissible but remains a recorded fact the holder may release
 * (already_expired — zero write).
 */
export function evaluateLeaseAdmissibility(
  lease: { status: "active" | "released"; expiresAt: string | null },
  now: string,
): LeaseAdmissibility {
  if (lease.status !== "active") return { admissible: false, reason: "released" };
  if (lease.expiresAt !== null && lease.expiresAt <= now) return { admissible: false, reason: "expired" };
  return { admissible: true };
}