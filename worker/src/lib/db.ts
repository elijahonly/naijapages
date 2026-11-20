export interface DbHealthResult {
  connected: boolean;
  schemaReady: boolean;
  tableCount: number;
  latencyMs: number;
  error?: string;
}

/**
 * Verifies D1 connectivity and checks whether the initial migration tables exist.
 */
export async function checkD1Health(db: D1Database | undefined): Promise<DbHealthResult> {
  const started = Date.now();
  if (!db) {
    return {
      connected: false,
      schemaReady: false,
      tableCount: 0,
      latencyMs: 0,
      error: 'DB binding is not configured',
    };
  }
  try {
    const ping = await db.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    if (ping?.ok !== 1) {
      return {
        connected: false,
        schemaReady: false,
        tableCount: 0,
        latencyMs: Date.now() - started,
        error: 'Unexpected D1 ping response',
      };
    }

    const tables = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'",
      )
      .first<{ count: number }>();

    const tableCount = Number(tables?.count ?? 0);
    return {
      connected: true,
      schemaReady: tableCount >= 18,
      tableCount,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      connected: false,
      schemaReady: false,
      tableCount: 0,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'D1 check failed',
    };
  }
}
