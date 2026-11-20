import type { Bindings } from '../../types';

export interface DiscoveryRuntimeConfig {
  /** Master kill-switch for discovery processing (default: false). */
  enabled: boolean;
  /** Independent toggle for scheduled cron job creation (default: false). */
  schedulerEnabled: boolean;
  /** When true, jobs run in safe dry-run mode without writing candidate records (default: true). */
  dryRun: boolean;
  /** Hard cap on jobs created/enqueued per scheduled run (default: 5, max: 50). */
  maxJobsPerRun: number;
  /** Maximum attempts allowed per job before permanent failure / DLQ (default: 3, max: 10). */
  maxAttempts: number;
  /** Elapsed time after which a `running` job is considered interrupted/stale (default: 15 min). */
  staleJobTimeoutMs: number;
  /** Maximum total active (`queued` + `running`) jobs permitted before scheduler pauses (default: 100). */
  maxQueuedBacklog: number;
}

export const DISCOVERY_CONFIG_DEFAULTS: DiscoveryRuntimeConfig = {
  enabled: false,
  schedulerEnabled: false,
  dryRun: true,
  maxJobsPerRun: 5,
  maxAttempts: 3,
  staleJobTimeoutMs: 15 * 60 * 1000,
  maxQueuedBacklog: 100,
};

function parseBooleanFlag(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === null) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return defaultValue;
}

function parseBoundedInt(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === null || !raw.trim()) return defaultValue;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(max, Math.max(min, parsed));
}

export function parseDiscoveryConfig(
  env: Partial<
    Pick<
      Bindings,
      | 'DISCOVERY_ENABLED'
      | 'DISCOVERY_SCHEDULER_ENABLED'
      | 'DISCOVERY_DRY_RUN'
      | 'DISCOVERY_MAX_JOBS_PER_RUN'
      | 'DISCOVERY_MAX_ATTEMPTS'
      | 'DISCOVERY_STALE_JOB_TIMEOUT_MS'
      | 'DISCOVERY_MAX_QUEUED_BACKLOG'
    >
  >,
): DiscoveryRuntimeConfig {
  const enabled = parseBooleanFlag(env.DISCOVERY_ENABLED, DISCOVERY_CONFIG_DEFAULTS.enabled);
  const schedulerEnabled =
    enabled &&
    parseBooleanFlag(
      env.DISCOVERY_SCHEDULER_ENABLED,
      DISCOVERY_CONFIG_DEFAULTS.schedulerEnabled,
    );
  const dryRun = parseBooleanFlag(env.DISCOVERY_DRY_RUN, DISCOVERY_CONFIG_DEFAULTS.dryRun);

  return {
    enabled,
    schedulerEnabled,
    dryRun,
    maxJobsPerRun: parseBoundedInt(
      env.DISCOVERY_MAX_JOBS_PER_RUN,
      DISCOVERY_CONFIG_DEFAULTS.maxJobsPerRun,
      1,
      50,
    ),
    maxAttempts: parseBoundedInt(
      env.DISCOVERY_MAX_ATTEMPTS,
      DISCOVERY_CONFIG_DEFAULTS.maxAttempts,
      1,
      10,
    ),
    staleJobTimeoutMs: parseBoundedInt(
      env.DISCOVERY_STALE_JOB_TIMEOUT_MS,
      DISCOVERY_CONFIG_DEFAULTS.staleJobTimeoutMs,
      30_000,
      24 * 60 * 60 * 1000,
    ),
    maxQueuedBacklog: parseBoundedInt(
      env.DISCOVERY_MAX_QUEUED_BACKLOG,
      DISCOVERY_CONFIG_DEFAULTS.maxQueuedBacklog,
      1,
      5_000,
    ),
  };
}
