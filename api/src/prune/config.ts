// Config de retención (ADR-012). Se resuelve una vez al arranque; el
// resto del módulo lee los defaults desde aquí en lugar de tocar
// process.env directamente para que los tests puedan sobrescribir sin
// mutar el entorno del proceso.

export interface PruneConfig {
  dryRun: boolean;
  retentionMonths: number;
  b2: {
    accountId: string;
    accountKey: string;
    bucket: string;
    archivePrefix: string;
  } | null;
  adminToken: string | null;
}

export function loadPruneConfig(env: NodeJS.ProcessEnv = process.env): PruneConfig {
  // Default operativo del ADR-012 D5: dry-run ON hasta que el dueño lo
  // apague explícitamente. Cualquier valor distinto de "false" (case
  // insensitive) mantiene el modo seguro.
  const dryRun = (env.EVENTS_PRUNE_DRY_RUN ?? "true").toLowerCase() !== "false";
  const retentionMonths = Number.parseInt(env.EVENTS_RETENTION_MONTHS ?? "24", 10);

  const accountId = env.B2_ACCOUNT_ID ?? "";
  const accountKey = env.B2_ACCOUNT_KEY ?? "";
  const bucket = env.B2_BUCKET ?? "";
  const b2 = accountId && accountKey && bucket
    ? {
        accountId,
        accountKey,
        bucket,
        archivePrefix: env.B2_ARCHIVE_PREFIX ?? "archive/events",
      }
    : null;

  const adminToken = env.ADMIN_PRUNE_TOKEN ?? null;

  return { dryRun, retentionMonths, b2, adminToken };
}
