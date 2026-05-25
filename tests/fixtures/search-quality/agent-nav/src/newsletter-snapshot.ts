export function requireFreshSnapshot(snapshotAgeMs: number) {
  if (snapshotAgeMs > 900000) {
    throw new Error("ERR_NEWSLETTER_SNAPSHOT_STALE: macro snapshot is too old");
  }
  return true;
}
