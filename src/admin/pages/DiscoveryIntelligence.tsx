import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  ExternalLink,
  GitBranch,
  History,
  MapPin,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sliders,
  XCircle,
} from 'lucide-react';
import { friendlyError } from '../../lib/errors';
import {
  actOnMonitoringRecord,
  decideDiscoveryReviewItem,
  DiscoveryBotSettingsRow,
  DiscoveryChangeHistoryRow,
  DiscoveryJobRow,
  DiscoveryMonitoringRow,
  DiscoveryOverviewPayload,
  DiscoveryReviewQueueRow,
  DiscoverySourceRow,
  fetchDiscoveryHistory,
  fetchDiscoveryJobs,
  fetchDiscoveryMonitoring,
  fetchDiscoveryOverview,
  fetchDiscoveryReviewQueue,
  retryDiscoveryJobAdmin,
  runManualDiscoveryJob,
  saveDiscoveryBotSettings,
  updateDiscoverySource,
  useAdminQuery,
} from '../api';
import {
  Btn,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  formatDate,
  inputCls,
  PageHeader,
  SearchBox,
  Spinner,
  Tabs,
  Toggle,
  useConfirm,
  useToast,
} from '../ui';

type SubTab = 'overview' | 'review' | 'sources' | 'monitoring' | 'controls';

const EMPTY_OVERVIEW: DiscoveryOverviewPayload = {
  metrics: {
    totalAuthenticListings: 0,
    memberListings: 0,
    newlyDiscovered: 0,
    businessesPublished: 0,
    awaitingVerification: 0,
    awaitingReview: 0,
    duplicateCandidates: 0,
    potentiallyOutdated: 0,
    confirmedClosures: 0,
    discoveryJobsRunning: 0,
    failedJobs: 0,
    completedJobs: 0,
  },
  sources: [],
  coverage: {
    totalStates: 37,
    statesCovered: 0,
    totalLgasTracked: 0,
    lgasCovered: 0,
    byState: [],
    byCategory: [],
  },
  settings: {
    globalPaused: false,
    discoveryPaused: false,
    monitoringPaused: false,
    dailyJobLimit: 25,
    maxBatchSize: 50,
    autoPublishMinConfidence: 0.85,
    autoPublishMinSources: 2,
    reviewMinConfidence: 0.35,
    closureConfirmThreshold: 3,
    monitoringDefaultDays: 30,
    aiExtractionEnabled: false,
    aiDailyBudgetCalls: 50,
    updatedBy: null,
    updatedAt: 0,
  },
};

function statusTextClass(status: string): string {
  switch (status) {
    case 'approved':
    case 'healthy':
    case 'published':
    case 'completed':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'pending':
    case 'pending_review':
    case 'queued':
    case 'running':
    case 'watch':
    case 'degraded':
    case 'potentially_outdated':
    case 'under_investigation':
    case 'relocated':
    case 'in_review':
      return 'text-amber-700 dark:text-amber-400';
    case 'failed':
    case 'rejected':
    case 'revoked':
    case 'circuit_open':
    case 'archived':
    case 'confirmed_closed':
      return 'text-rose-700 dark:text-rose-400';
    default:
      return 'text-slate-600 dark:text-slate-400';
  }
}

function formatStatusLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

export default function DiscoveryIntelligence() {
  const toast = useToast();
  const confirm = useConfirm();

  const [tab, setTab] = useState<SubTab>('overview');
  const [stateSearch, setStateSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState<string>('ALL');
  const [reviewStatusFilter, setReviewStatusFilter] = useState<string>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Manual job form state
  const [jobSourceId, setJobSourceId] = useState('openstreetmap_overpass');
  const [jobState, setJobState] = useState('Lagos');
  const [jobLga, setJobLga] = useState('');
  const [jobCategory, setJobCategory] = useState('');
  const [jobMaxResults, setJobMaxResults] = useState(50);
  const [jobEndpointUrl, setJobEndpointUrl] = useState('');
  const [runningJob, setRunningJob] = useState(false);

  // Inline candidate edit state
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    category: string;
    state: string;
    lga: string;
    address: string;
    phone: string;
    website: string;
    email: string;
  }>({
    name: '',
    category: '',
    state: '',
    lga: '',
    address: '',
    phone: '',
    website: '',
    email: '',
  });

  // Queries
  const overview = useAdminQuery(fetchDiscoveryOverview, EMPTY_OVERVIEW, []);
  const reviewQueue = useAdminQuery<DiscoveryReviewQueueRow[]>(
    () => fetchDiscoveryReviewQueue(reviewStatusFilter, 80),
    [],
    [reviewStatusFilter],
  );
  const jobs = useAdminQuery<DiscoveryJobRow[]>(() => fetchDiscoveryJobs(80), [], []);
  const monitoring = useAdminQuery<DiscoveryMonitoringRow[]>(
    () => fetchDiscoveryMonitoring(80),
    [],
    [],
  );
  const history = useAdminQuery<DiscoveryChangeHistoryRow[]>(() => fetchDiscoveryHistory(100), [], []);

  // Bot settings local editor
  const [settingsDraft, setSettingsDraft] = useState<DiscoveryBotSettingsRow | null>(null);
  const activeSettings = settingsDraft ?? overview.data.settings;
  const [savingSettings, setSavingSettings] = useState(false);

  const filteredStates = useMemo(() => {
    const q = stateSearch.trim().toLowerCase();
    return overview.data.coverage.byState.filter((row) => {
      if (zoneFilter !== 'ALL' && row.zone !== zoneFilter) return false;
      if (!q) return true;
      return (
        row.state.toLowerCase().includes(q) ||
        row.capital.toLowerCase().includes(q) ||
        row.zone.toLowerCase().includes(q)
      );
    });
  }, [overview.data.coverage.byState, stateSearch, zoneFilter]);

  const approvedSources = useMemo(
    () => overview.data.sources.filter((s) => s.permissionStatus === 'approved' && s.enabled),
    [overview.data.sources],
  );

  const reloadAll = () => {
    overview.reload();
    reviewQueue.reload();
    jobs.reload();
    monitoring.reload();
    history.reload();
  };

  const handleReviewDecision = async (
    item: DiscoveryReviewQueueRow,
    action:
      | 'approve_publish'
      | 'reject'
      | 'merge_duplicate'
      | 'keep_separate_branch'
      | 'edit_candidate'
      | 'request_verification'
      | 'confirm_relocation'
      | 'confirm_closure'
      | 'restore_archived',
  ) => {
    let note: string | undefined;
    if (action === 'reject' || action === 'confirm_closure' || action === 'merge_duplicate') {
      const c = await confirm({
        title:
          action === 'confirm_closure'
            ? 'Confirm permanent closure'
            : action === 'merge_duplicate'
              ? 'Merge as duplicate'
              : 'Reject candidate',
        message:
          action === 'confirm_closure'
            ? `Archive "${item.candidate?.name ?? item.id}" from public search? Historical evidence and audit trails are preserved and can be restored anytime.`
            : `Record your decision for "${item.candidate?.name ?? item.id}".`,
        confirmLabel:
          action === 'confirm_closure'
            ? 'Archive listing'
            : action === 'merge_duplicate'
              ? 'Mark duplicate'
              : 'Reject candidate',
        tone: action === 'reject' || action === 'confirm_closure' ? 'danger' : 'primary',
        reason: {
          label: 'Decision note',
          placeholder: 'Optional rationale for the immutable audit log',
          required: false,
        },
      });
      if (!c.ok) return;
      note = c.reason || undefined;
    }

    setBusyId(item.id);
    try {
      await decideDiscoveryReviewItem(item.id, {
        action,
        note,
        edits: editingReviewId === item.id ? editDraft : undefined,
      });
      if (editingReviewId === item.id) setEditingReviewId(null);
      toast.success(`Review decision "${formatStatusLabel(action)}" saved.`);
      reloadAll();
    } catch (err) {
      toast.error(friendlyError(err, 'Could not save review decision.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleSource = async (
    source: DiscoverySourceRow,
    patch: {
      permissionStatus?: DiscoverySourceRow['permissionStatus'];
      enabled?: boolean;
      resetCircuitBreaker?: boolean;
    },
  ) => {
    setBusyId(source.id);
    try {
      await updateDiscoverySource(source.id, patch);
      toast.success(`Updated source "${source.name}".`);
      overview.reload();
    } catch (err) {
      toast.error(friendlyError(err, 'Could not update source configuration.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleRunManualJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunningJob(true);
    try {
      const res = await runManualDiscoveryJob({
        sourceId: jobSourceId,
        state: jobState,
        lga: jobLga.trim() || undefined,
        category: jobCategory.trim() || undefined,
        maxResults: jobMaxResults,
        endpointUrl: jobEndpointUrl.trim() || undefined,
      });
      toast.success(
        res.enqueued
          ? `Discovery job ${res.job.id} created and queued.`
          : `Discovery job ${res.job.id} created in D1 (queue unbound in local mode).`,
      );
      jobs.reload();
      overview.reload();
    } catch (err) {
      toast.error(friendlyError(err, 'Could not start manual discovery job.'));
    } finally {
      setRunningJob(false);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    setBusyId(jobId);
    try {
      await retryDiscoveryJobAdmin(jobId);
      toast.success(`Job ${jobId} re-queued.`);
      jobs.reload();
      overview.reload();
    } catch (err) {
      toast.error(friendlyError(err, 'Could not retry discovery job.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleMonitoringAction = async (
    row: DiscoveryMonitoringRow,
    action: 'confirm_closure' | 'confirm_relocation' | 'restore_archived' | 'mark_healthy',
  ) => {
    setBusyId(row.id);
    try {
      await actOnMonitoringRecord(row.id, action);
      toast.success(`Updated "${row.businessName}" (${formatStatusLabel(action)}).`);
      monitoring.reload();
      overview.reload();
      history.reload();
    } catch (err) {
      toast.error(friendlyError(err, 'Could not apply monitoring action.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const saved = await saveDiscoveryBotSettings({
        globalPaused: activeSettings.globalPaused,
        discoveryPaused: activeSettings.discoveryPaused,
        monitoringPaused: activeSettings.monitoringPaused,
        dailyJobLimit: activeSettings.dailyJobLimit,
        maxBatchSize: activeSettings.maxBatchSize,
        autoPublishMinConfidence: activeSettings.autoPublishMinConfidence,
        autoPublishMinSources: activeSettings.autoPublishMinSources,
        reviewMinConfidence: activeSettings.reviewMinConfidence,
        closureConfirmThreshold: activeSettings.closureConfirmThreshold,
        monitoringDefaultDays: activeSettings.monitoringDefaultDays,
        aiExtractionEnabled: activeSettings.aiExtractionEnabled,
        aiDailyBudgetCalls: activeSettings.aiDailyBudgetCalls,
      });
      setSettingsDraft(saved);
      toast.success('Bot controls saved to Cloudflare D1.');
      overview.reload();
    } catch (err) {
      toast.error(friendlyError(err, 'Could not save bot controls.'));
    } finally {
      setSavingSettings(false);
    }
  };

  const startEditCandidate = (item: DiscoveryReviewQueueRow) => {
    if (!item.candidate) return;
    setEditingReviewId(item.id);
    setEditDraft({
      name: item.candidate.name ?? '',
      category: item.candidate.category ?? '',
      state: item.candidate.state ?? '',
      lga: item.candidate.lga ?? '',
      address: item.candidate.address ?? '',
      phone: item.candidate.phone ?? '',
      website: item.candidate.website ?? '',
      email: item.candidate.email ?? '',
    });
  };

  const m = overview.data.metrics;
  const cov = overview.data.coverage;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Business Intelligence"
        subtitle="Nationwide authentic business discovery, multi-source verification, deduplication, and continuous lifecycle monitoring across all 36 states and FCT."
        actions={
          <div className="flex items-center gap-2">
            <Btn
              variant={activeSettings.globalPaused ? 'amber' : 'outline'}
              size="sm"
              icon={activeSettings.globalPaused ? <Play size={14} /> : <PauseCircle size={14} />}
              onClick={async () => {
                try {
                  const saved = await saveDiscoveryBotSettings({
                    globalPaused: !activeSettings.globalPaused,
                  });
                  setSettingsDraft(saved);
                  toast.info(
                    saved.globalPaused
                      ? 'Bot globally paused. No automated jobs will execute.'
                      : 'Global bot pause lifted.',
                  );
                  overview.reload();
                } catch (err) {
                  toast.error(friendlyError(err, 'Could not toggle global pause.'));
                }
              }}
            >
              {activeSettings.globalPaused ? 'Resume Bot' : 'Pause All Bot Jobs'}
            </Btn>
            <Btn size="sm" icon={<RefreshCw size={14} />} onClick={reloadAll}>
              Refresh
            </Btn>
          </div>
        }
      />

      {overview.error && <ErrorNote>{overview.error}</ErrorNote>}

      <Tabs<SubTab>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'overview', label: 'Overview & Coverage' },
          {
            id: 'review',
            label: 'Review Queue',
            count: m.awaitingReview,
            alert: m.awaitingReview > 0,
          },
          {
            id: 'sources',
            label: 'Sources & Jobs',
            count: m.failedJobs > 0 ? m.failedJobs : undefined,
            alert: m.failedJobs > 0,
          },
          {
            id: 'monitoring',
            label: 'Monitoring & History',
            count: m.potentiallyOutdated > 0 ? m.potentiallyOutdated : undefined,
            alert: m.potentiallyOutdated > 0,
          },
          { id: 'controls', label: 'Bot Controls' },
        ]}
      />

      {/* =================================================================== */}
      {/* TAB 1: OVERVIEW & NATIONAL COVERAGE                                 */}
      {/* =================================================================== */}
      {tab === 'overview' && (
        <div className="space-y-5">
          {overview.loading ? (
            <Spinner label="Loading national discovery intelligence…" />
          ) : (
            <>
              {/* High-signal KPI strip (flat 1px borders, tabular numerals) */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card className="p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Authentic Public Listings
                  </p>
                  <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                    {m.totalAuthenticListings.toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                    {m.memberListings.toLocaleString()} member · {m.businessesPublished.toLocaleString()} discovered
                  </p>
                </Card>

                <Card className="p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Staging & Review Queue
                  </p>
                  <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                    {m.awaitingReview.toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                    {m.newlyDiscovered.toLocaleString()} discovered · {m.duplicateCandidates.toLocaleString()} duplicates
                  </p>
                </Card>

                <Card className="p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    National Coverage
                  </p>
                  <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                    {cov.statesCovered} / {cov.totalStates}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                    States active · {cov.lgasCovered} / {cov.totalLgasTracked} tracked LGAs
                  </p>
                </Card>

                <Card className="p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Monitoring & Jobs
                  </p>
                  <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                    {m.potentiallyOutdated.toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                    Outdated · {m.confirmedClosures} archived · {m.failedJobs} failed jobs
                  </p>
                </Card>
              </div>

              {/* 37-State Coverage Gap Table */}
              <Card className="overflow-hidden">
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                      <MapPin size={15} className="text-emerald-600" />
                      36 States + FCT Coverage Matrix (Sorted by Underserved Priority)
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Higher gap scores indicate underserved states prioritized next by the discovery scheduler.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Filter by geopolitical zone"
                      value={zoneFilter}
                      onChange={(e) => setZoneFilter(e.target.value)}
                      className="px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
                    >
                      <option value="ALL">All 6 zones</option>
                      <option value="NC">North Central (NC)</option>
                      <option value="NE">North East (NE)</option>
                      <option value="NW">North West (NW)</option>
                      <option value="SE">South East (SE)</option>
                      <option value="SS">South South (SS)</option>
                      <option value="SW">South West (SW)</option>
                    </select>
                    <SearchBox
                      value={stateSearch}
                      onChange={setStateSearch}
                      placeholder="Filter state or capital…"
                      className="w-48"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5 font-bold">State</th>
                        <th className="px-4 py-2.5 font-bold">Zone</th>
                        <th className="px-4 py-2.5 font-bold text-right">LGAs Active</th>
                        <th className="px-4 py-2.5 font-bold text-right">Member</th>
                        <th className="px-4 py-2.5 font-bold text-right">Discovered</th>
                        <th className="px-4 py-2.5 font-bold text-right">Published Bot</th>
                        <th className="px-4 py-2.5 font-bold text-right">Gap Priority</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredStates.map((row) => (
                        <tr
                          key={row.state}
                          className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                        >
                          <td className="px-4 py-2.5 font-bold text-slate-900 dark:text-white">
                            {row.state}{' '}
                            <span className="font-normal text-slate-400">({row.capital})</span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400">
                            {row.zone}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                            {row.lgasWithListings} / {row.totalLgasTracked}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                            {row.memberListings}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                            {row.discoveredCandidates}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                            {row.publishedBotListings}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                            {row.coverageGapScore.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Category Coverage Table */}
              <Card className="overflow-hidden">
                <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                  <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                    Category Coverage (Least-Covered First)
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 sm:gap-px bg-slate-100 dark:bg-slate-800">
                  {cov.byCategory.slice(0, 18).map((c) => (
                    <div
                      key={c.category}
                      className="bg-white dark:bg-slate-900 px-4 py-2.5 flex items-center justify-between text-xs"
                    >
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate pr-2">
                        {c.category}
                      </span>
                      <span className="tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                        <strong className="text-slate-900 dark:text-white">
                          {c.totalAuthenticListings}
                        </strong>{' '}
                        live · {c.discoveredCandidates} staged
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: REVIEW QUEUE                                                 */}
      {/* =================================================================== */}
      {tab === 'review' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(['pending', 'in_review', 'approved', 'merged', 'rejected', 'all'] as const).map(
                (st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setReviewStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                      reviewStatusFilter === st
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {formatStatusLabel(st)}
                  </button>
                ),
              )}
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {reviewQueue.data.length} task{reviewQueue.data.length === 1 ? '' : 's'}
            </span>
          </div>

          {reviewQueue.error && <ErrorNote>{reviewQueue.error}</ErrorNote>}

          {reviewQueue.loading ? (
            <Spinner label="Loading bot review queue…" />
          ) : reviewQueue.data.length === 0 ? (
            <Card>
              <EmptyState
                icon={<ShieldCheck size={22} />}
                title="No candidates in this review queue"
                hint="Bot-discovered candidates requiring human verification, duplicate arbitration, relocation confirmation, or closure review appear here with full evidence trails."
              />
            </Card>
          ) : (
            <div className="space-y-4">
              {reviewQueue.data.map((item) => {
                const cand = item.candidate;
                const isEditing = editingReviewId === item.id;
                const pct = Math.round(item.confidenceScore * 100);
                return (
                  <Card key={item.id} className="p-4 sm:p-5 space-y-4">
                    {/* Top row */}
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
                          <span className={statusTextClass(item.reviewStatus)}>
                            {formatStatusLabel(item.reviewStatus)}
                          </span>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="text-slate-600 dark:text-slate-300">
                            Reason: {formatStatusLabel(item.reviewReason)}
                          </span>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="text-slate-500 dark:text-slate-400">
                            Suggested: {formatStatusLabel(item.suggestedAction)}
                          </span>
                        </div>
                        <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                          {cand?.name || `Task ${item.id}`}
                        </h3>
                        {cand && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {cand.category || 'Uncategorized'} · {cand.lga ? `${cand.lga}, ` : ''}
                            {cand.state || 'Nigeria'} · Tier:{' '}
                            <span className="font-semibold text-slate-700 dark:text-slate-300">
                              {formatStatusLabel(cand.verificationTier)}
                            </span>{' '}
                            · {cand.corroboratingSourceCount} source
                            {cand.corroboratingSourceCount === 1 ? '' : 's'}
                          </p>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          Confidence
                        </p>
                        <p className="text-lg font-black tabular-nums text-slate-900 dark:text-white">
                          {pct}%
                        </p>
                        <div className="w-24 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 mt-1 overflow-hidden">
                          <div
                            className={`h-full ${
                              pct >= 80
                                ? 'bg-emerald-600'
                                : pct >= 45
                                  ? 'bg-amber-500'
                                  : 'bg-rose-500'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Candidate details or inline edit form */}
                    {cand && !isEditing && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                        <div>
                          <span className="text-slate-400 block">Address</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {cand.address || 'Not provided'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Phone</span>
                          <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                            {cand.phone || 'Not published'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Website / Email</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200 break-all">
                            {cand.website || cand.email || 'Not published'}
                          </span>
                        </div>
                      </div>
                    )}

                    {cand && isEditing && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                        <Field label="Business Name">
                          <input
                            className={inputCls}
                            value={editDraft.name}
                            onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                          />
                        </Field>
                        <Field label="Category">
                          <input
                            className={inputCls}
                            value={editDraft.category}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, category: e.target.value })
                            }
                          />
                        </Field>
                        <Field label="State">
                          <input
                            className={inputCls}
                            value={editDraft.state}
                            onChange={(e) => setEditDraft({ ...editDraft, state: e.target.value })}
                          />
                        </Field>
                        <Field label="LGA">
                          <input
                            className={inputCls}
                            value={editDraft.lga}
                            onChange={(e) => setEditDraft({ ...editDraft, lga: e.target.value })}
                          />
                        </Field>
                        <Field label="Address">
                          <input
                            className={inputCls}
                            value={editDraft.address}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, address: e.target.value })
                            }
                          />
                        </Field>
                        <Field label="Phone">
                          <input
                            className={inputCls}
                            value={editDraft.phone}
                            onChange={(e) => setEditDraft({ ...editDraft, phone: e.target.value })}
                          />
                        </Field>
                        <Field label="Website">
                          <input
                            className={inputCls}
                            value={editDraft.website}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, website: e.target.value })
                            }
                          />
                        </Field>
                        <Field label="Email">
                          <input
                            className={inputCls}
                            value={editDraft.email}
                            onChange={(e) => setEditDraft({ ...editDraft, email: e.target.value })}
                          />
                        </Field>
                        <div className="sm:col-span-2 flex justify-end gap-2">
                          <Btn size="xs" variant="ghost" onClick={() => setEditingReviewId(null)}>
                            Cancel edit
                          </Btn>
                          <Btn
                            size="xs"
                            variant="primary"
                            loading={busyId === item.id}
                            onClick={() => handleReviewDecision(item, 'edit_candidate')}
                          >
                            Save field edits
                          </Btn>
                        </div>
                      </div>
                    )}

                    {/* Duplicate Comparison */}
                    {item.duplicateCandidates.length > 0 && (
                      <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs space-y-1.5">
                        <p className="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                          <GitBranch size={13} /> Duplicate / Branch Comparison
                        </p>
                        {item.duplicateCandidates.map((dup, idx) => (
                          <div
                            key={idx}
                            className="flex flex-wrap items-center justify-between gap-2 text-slate-700 dark:text-slate-300"
                          >
                            <span>
                              <strong>{dup.targetName || dup.candidateId}</strong> (
                              {formatStatusLabel(dup.classification || 'possible_duplicate')})
                            </span>
                            <span className="tabular-nums font-semibold">
                              Match score: {Math.round((dup.score ?? 0) * 100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Evidence Trail */}
                    {item.evidence.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          Traceable Evidence ({item.evidence.length})
                        </p>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden text-xs">
                          {item.evidence.slice(0, 6).map((ev) => (
                            <div
                              key={ev.id}
                              className="px-3 py-2 bg-slate-50/50 dark:bg-slate-800/30 flex flex-wrap items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <span className="font-bold text-slate-800 dark:text-slate-200">
                                  {ev.source_id}
                                </span>{' '}
                                <span className="text-slate-500">
                                  ({formatStatusLabel(ev.evidence_type)}
                                  {ev.field_name ? ` · ${ev.field_name}` : ''})
                                </span>
                                {ev.evidence_value && (
                                  <span className="text-slate-600 dark:text-slate-300 ml-2 break-all">
                                    {ev.evidence_value}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0 text-[11px] text-slate-400">
                                <span className="tabular-nums">
                                  {Math.round(ev.confidence * 100)}%
                                </span>
                                {ev.source_url && (
                                  <a
                                    href={ev.source_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-0.5"
                                  >
                                    Source <ExternalLink size={10} />
                                  </a>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <Btn
                        size="xs"
                        variant="primary"
                        loading={busyId === item.id}
                        icon={<CheckCircle2 size={13} />}
                        onClick={() => handleReviewDecision(item, 'approve_publish')}
                      >
                        Approve & Publish
                      </Btn>
                      <Btn
                        size="xs"
                        variant="outline"
                        loading={busyId === item.id}
                        icon={<GitBranch size={13} />}
                        onClick={() => handleReviewDecision(item, 'keep_separate_branch')}
                      >
                        Keep Separate Branch
                      </Btn>
                      <Btn
                        size="xs"
                        variant="outline"
                        loading={busyId === item.id}
                        onClick={() => handleReviewDecision(item, 'merge_duplicate')}
                      >
                        Merge Duplicate
                      </Btn>
                      {cand && !isEditing && (
                        <Btn size="xs" variant="outline" onClick={() => startEditCandidate(item)}>
                          Edit Fields
                        </Btn>
                      )}
                      <Btn
                        size="xs"
                        variant="outline"
                        loading={busyId === item.id}
                        onClick={() => handleReviewDecision(item, 'request_verification')}
                      >
                        Request Verification
                      </Btn>
                      <Btn
                        size="xs"
                        variant="outline"
                        loading={busyId === item.id}
                        onClick={() => handleReviewDecision(item, 'confirm_relocation')}
                      >
                        Confirm Relocation
                      </Btn>
                      <Btn
                        size="xs"
                        variant="danger"
                        loading={busyId === item.id}
                        icon={<Archive size={13} />}
                        onClick={() => handleReviewDecision(item, 'confirm_closure')}
                      >
                        Confirm Closure
                      </Btn>
                      <Btn
                        size="xs"
                        variant="ghost"
                        loading={busyId === item.id}
                        icon={<XCircle size={13} />}
                        onClick={() => handleReviewDecision(item, 'reject')}
                      >
                        Reject
                      </Btn>
                      {cand?.lifecycleStatus === 'archived' && (
                        <Btn
                          size="xs"
                          variant="amber"
                          loading={busyId === item.id}
                          icon={<RotateCcw size={13} />}
                          onClick={() => handleReviewDecision(item, 'restore_archived')}
                        >
                          Restore Archived
                        </Btn>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: SOURCES & JOBS                                               */}
      {/* =================================================================== */}
      {tab === 'sources' && (
        <div className="space-y-5">
          {/* Discovery Sources Registry */}
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Database size={15} className="text-emerald-600" />
                Registered Discovery Sources & Circuit Breakers
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Sources start disabled (`pending_review`) and require explicit legal approval before enabling.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-bold">Source</th>
                    <th className="px-4 py-2.5 font-bold">Licence & Attribution</th>
                    <th className="px-4 py-2.5 font-bold">Permission</th>
                    <th className="px-4 py-2.5 font-bold">Health</th>
                    <th className="px-4 py-2.5 font-bold text-right">Rate Limit</th>
                    <th className="px-4 py-2.5 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {overview.data.sources.map((src) => (
                    <tr key={src.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-900 dark:text-white">{src.name}</p>
                        <p className="font-mono text-[11px] text-slate-500">{src.id}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        <p className="font-semibold">{src.licenceName}</p>
                        {src.attributionText && (
                          <p className="text-[11px] text-slate-400">{src.attributionText}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-bold ${statusTextClass(src.permissionStatus)}`}>
                          {formatStatusLabel(src.permissionStatus)}
                        </span>
                        <span className="block text-[11px] text-slate-400">
                          {src.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-bold ${statusTextClass(src.healthStatus)}`}>
                          {formatStatusLabel(src.healthStatus)}
                        </span>
                        {src.consecutiveFailures > 0 && (
                          <span className="block text-[11px] text-rose-500 tabular-nums">
                            {src.consecutiveFailures} consecutive failure
                            {src.consecutiveFailures === 1 ? '' : 's'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {src.rateLimitPerMinute}/min
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          {src.permissionStatus !== 'approved' ? (
                            <Btn
                              size="xs"
                              variant="primary"
                              loading={busyId === src.id}
                              onClick={() =>
                                handleToggleSource(src, {
                                  permissionStatus: 'approved',
                                  enabled: true,
                                })
                              }
                            >
                              Approve & Enable
                            </Btn>
                          ) : (
                            <Btn
                              size="xs"
                              variant={src.enabled ? 'outline' : 'primary'}
                              loading={busyId === src.id}
                              onClick={() => handleToggleSource(src, { enabled: !src.enabled })}
                            >
                              {src.enabled ? 'Disable' : 'Enable'}
                            </Btn>
                          )}
                          {(src.healthStatus === 'circuit_open' || src.consecutiveFailures > 0) && (
                            <Btn
                              size="xs"
                              variant="amber"
                              loading={busyId === src.id}
                              onClick={() =>
                                handleToggleSource(src, { resetCircuitBreaker: true })
                              }
                            >
                              Reset Circuit
                            </Btn>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Manual Bounded Discovery Job Runner */}
          <Card className="p-4 sm:p-5">
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
              <Play size={15} className="text-emerald-600" />
              Run Manual Bounded Discovery Job
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Dispatches a single bounded state/LGA sweep to the Cloudflare Queue for an approved, enabled source.
            </p>
            <form onSubmit={handleRunManualJob} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Approved Source">
                <select
                  className={inputCls}
                  value={jobSourceId}
                  onChange={(e) => setJobSourceId(e.target.value)}
                >
                  {(approvedSources.length > 0 ? approvedSources : overview.data.sources).map(
                    (s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.enabled ? 'Enabled' : 'Disabled'})
                      </option>
                    ),
                  )}
                </select>
              </Field>

              <Field label="Nigerian State">
                <select
                  className={inputCls}
                  value={jobState}
                  onChange={(e) => setJobState(e.target.value)}
                >
                  {overview.data.coverage.byState
                    .slice()
                    .sort((a, b) => a.state.localeCompare(b.state))
                    .map((s) => (
                      <option key={s.state} value={s.state}>
                        {s.state} ({s.capital})
                      </option>
                    ))}
                </select>
              </Field>

              <Field label="LGA (optional)">
                <input
                  className={inputCls}
                  placeholder="Defaults to state capital LGA"
                  value={jobLga}
                  onChange={(e) => setJobLga(e.target.value)}
                />
              </Field>

              <Field label="Category (optional)">
                <input
                  className={inputCls}
                  placeholder="e.g. Healthcare, Retail"
                  value={jobCategory}
                  onChange={(e) => setJobCategory(e.target.value)}
                />
              </Field>

              <Field label="Max Results (1–200)">
                <input
                  type="number"
                  min={1}
                  max={200}
                  className={inputCls}
                  value={jobMaxResults}
                  onChange={(e) => setJobMaxResults(Number(e.target.value) || 50)}
                />
              </Field>

              <Field label="Target HTTPS URL (Website / Feed sources)">
                <input
                  type="url"
                  className={inputCls}
                  placeholder="Optional for OSM; required for website/feed"
                  value={jobEndpointUrl}
                  onChange={(e) => setJobEndpointUrl(e.target.value)}
                />
              </Field>

              <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
                <Btn type="submit" variant="primary" loading={runningJob} icon={<Play size={14} />}>
                  Enqueue Bounded Discovery Job
                </Btn>
              </div>
            </form>
          </Card>

          {/* Job History */}
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                Recent Discovery Jobs ({jobs.data.length})
              </h2>
            </div>
            {jobs.loading ? (
              <Spinner label="Loading discovery jobs…" />
            ) : jobs.data.length === 0 ? (
              <EmptyState title="No discovery jobs recorded yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-bold">Source / Scope</th>
                      <th className="px-4 py-2.5 font-bold">Status</th>
                      <th className="px-4 py-2.5 font-bold text-right">Found / Accepted / Dup</th>
                      <th className="px-4 py-2.5 font-bold">Created</th>
                      <th className="px-4 py-2.5 font-bold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {jobs.data.map((job) => (
                      <tr key={job.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2.5">
                          <p className="font-bold text-slate-900 dark:text-white">
                            {job.sourceId} · {job.state || 'Nigeria'}
                            {job.lga ? ` / ${job.lga}` : ''}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono">
                            {job.id} ({job.jobType}, attempt {job.attempts})
                          </p>
                          {job.errorMessage && (
                            <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5 max-w-md truncate">
                              {job.errorMessage}
                            </p>
                          )}
                        </td>
                        <td className={`px-4 py-2.5 font-bold ${statusTextClass(job.status)}`}>
                          {formatStatusLabel(job.status)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                          {job.discoveredCount} / {job.acceptedCount} / {job.duplicateCount}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                          {formatDate(job.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {(job.status === 'failed' || job.status === 'partially_completed') && (
                            <Btn
                              size="xs"
                              variant="outline"
                              loading={busyId === job.id}
                              icon={<RotateCcw size={12} />}
                              onClick={() => handleRetryJob(job.id)}
                            >
                              Retry
                            </Btn>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 4: MONITORING & CHANGE HISTORY                                  */}
      {/* =================================================================== */}
      {tab === 'monitoring' && (
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Activity size={15} className="text-emerald-600" />
                Business Health & Closure Protection Monitor ({monitoring.data.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Single probe failures enter Watch status and never falsely close a listing. Confirmed closures archive listings while preserving full history.
              </p>
            </div>
            {monitoring.loading ? (
              <Spinner label="Loading monitoring records…" />
            ) : monitoring.data.length === 0 ? (
              <EmptyState
                icon={<Activity size={22} />}
                title="No businesses currently under automated monitoring"
                hint="Published discovered listings are automatically enrolled in tiered periodic health checks."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-bold">Business</th>
                      <th className="px-4 py-2.5 font-bold">Health</th>
                      <th className="px-4 py-2.5 font-bold text-right">Failures / Closure Signals</th>
                      <th className="px-4 py-2.5 font-bold">Next Check</th>
                      <th className="px-4 py-2.5 font-bold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {monitoring.data.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2.5">
                          <p className="font-bold text-slate-900 dark:text-white">
                            {row.businessName}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {row.lga ? `${row.lga}, ` : ''}
                            {row.state} · Tier: {row.monitoringTier} ({row.checkIntervalDays}d)
                          </p>
                          {row.monitoringNotes && (
                            <p className="text-[11px] text-slate-400 mt-0.5 max-w-md truncate">
                              {row.monitoringNotes}
                            </p>
                          )}
                        </td>
                        <td className={`px-4 py-2.5 font-bold ${statusTextClass(row.healthStatus)}`}>
                          {formatStatusLabel(row.healthStatus)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                          {row.consecutiveFailures} fails · {row.closureSignalCount} closure
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                          {formatDate(row.nextCheckAt)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-1.5">
                            {row.healthStatus === 'archived' ? (
                              <Btn
                                size="xs"
                                variant="amber"
                                loading={busyId === row.id}
                                onClick={() => handleMonitoringAction(row, 'restore_archived')}
                              >
                                Restore
                              </Btn>
                            ) : (
                              <>
                                <Btn
                                  size="xs"
                                  variant="outline"
                                  loading={busyId === row.id}
                                  onClick={() => handleMonitoringAction(row, 'mark_healthy')}
                                >
                                  Mark Healthy
                                </Btn>
                                <Btn
                                  size="xs"
                                  variant="outline"
                                  loading={busyId === row.id}
                                  onClick={() => handleMonitoringAction(row, 'confirm_relocation')}
                                >
                                  Confirm Relocation
                                </Btn>
                                <Btn
                                  size="xs"
                                  variant="danger"
                                  loading={busyId === row.id}
                                  onClick={() => handleMonitoringAction(row, 'confirm_closure')}
                                >
                                  Archive Closed
                                </Btn>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Immutable Bot Change History */}
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <History size={15} className="text-emerald-600" />
                Immutable Bot & Admin Change History ({history.data.length})
              </h2>
            </div>
            {history.loading ? (
              <Spinner label="Loading change history…" />
            ) : history.data.length === 0 ? (
              <EmptyState title="No bot changes logged yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-bold">Field / Target</th>
                      <th className="px-4 py-2.5 font-bold">Transition</th>
                      <th className="px-4 py-2.5 font-bold">Source / Actor</th>
                      <th className="px-4 py-2.5 font-bold">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {history.data.map((h) => (
                      <tr key={h.id}>
                        <td className="px-4 py-2.5">
                          <p className="font-bold text-slate-900 dark:text-white">
                            {h.fieldChanged}
                          </p>
                          <p className="font-mono text-[11px] text-slate-400">
                            {h.discoveredBusinessId || h.businessId || '—'}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300 max-w-sm">
                          <span className="line-through text-slate-400 mr-1.5">
                            {h.oldValue ? h.oldValue.slice(0, 60) : '∅'}
                          </span>
                          → <span className="font-semibold">{h.newValue?.slice(0, 80) || '—'}</span>
                          {h.reason && (
                            <p className="text-[11px] text-slate-400 mt-0.5">{h.reason}</p>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                          <span className="font-semibold">
                            {formatStatusLabel(h.changeSource)}
                          </span>
                          {h.actorEmail && (
                            <span className="block text-[11px] text-slate-400">{h.actorEmail}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                          {formatDate(h.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 5: BOT CONTROLS                                                 */}
      {/* =================================================================== */}
      {tab === 'controls' && (
        <Card className="p-5 sm:p-6">
          <form onSubmit={handleSaveSettings} className="space-y-6">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Sliders size={15} className="text-emerald-600" />
                Runtime Safety Switches & Verification Thresholds
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Persisted in Cloudflare D1 (`discovery_bot_settings`) and enforced by both the Cron Scheduler and Queue Consumer.
              </p>
            </div>

            <div className="space-y-4 pb-5 border-b border-slate-200 dark:border-slate-800">
              <Toggle
                checked={activeSettings.globalPaused}
                onChange={(v) => setSettingsDraft({ ...activeSettings, globalPaused: v })}
                label="Global Bot Emergency Pause"
                description="Immediately pauses all scheduled discovery sweeps, queue execution, and automated monitoring."
              />
              <Toggle
                checked={activeSettings.discoveryPaused}
                onChange={(v) => setSettingsDraft({ ...activeSettings, discoveryPaused: v })}
                label="Pause Automated Discovery Sweeps"
                description="Halts new discovery candidate ingestion while allowing existing admin reviews."
              />
              <Toggle
                checked={activeSettings.monitoringPaused}
                onChange={(v) => setSettingsDraft({ ...activeSettings, monitoringPaused: v })}
                label="Pause Continuous Health Monitoring"
                description="Temporarily pauses periodic website/source re-verification checks."
              />
              <Toggle
                checked={activeSettings.aiExtractionEnabled}
                onChange={(v) => setSettingsDraft({ ...activeSettings, aiExtractionEnabled: v })}
                label="Enable Optional Structured AI Extraction Assist"
                description="Disabled by default. Deterministic rules handle 95%+ of extraction; AI never fabricates missing fields."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="Daily Job Limit (1–500)">
                <input
                  type="number"
                  min={1}
                  max={500}
                  className={inputCls}
                  value={activeSettings.dailyJobLimit}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...activeSettings,
                      dailyJobLimit: Number(e.target.value) || 25,
                    })
                  }
                />
              </Field>

              <Field label="Max Batch Size per Job (1–500)">
                <input
                  type="number"
                  min={1}
                  max={500}
                  className={inputCls}
                  value={activeSettings.maxBatchSize}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...activeSettings,
                      maxBatchSize: Number(e.target.value) || 50,
                    })
                  }
                />
              </Field>

              <Field label="Auto-Publish Min Confidence (0.50–1.00)">
                <input
                  type="number"
                  step={0.01}
                  min={0.5}
                  max={1}
                  className={inputCls}
                  value={activeSettings.autoPublishMinConfidence}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...activeSettings,
                      autoPublishMinConfidence: Number(e.target.value) || 0.85,
                    })
                  }
                />
              </Field>

              <Field label="Auto-Publish Min Corroborating Sources">
                <input
                  type="number"
                  min={1}
                  max={10}
                  className={inputCls}
                  value={activeSettings.autoPublishMinSources}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...activeSettings,
                      autoPublishMinSources: Number(e.target.value) || 2,
                    })
                  }
                />
              </Field>

              <Field label="Closure Confirmation Signal Threshold (≥2)">
                <input
                  type="number"
                  min={2}
                  max={10}
                  className={inputCls}
                  value={activeSettings.closureConfirmThreshold}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...activeSettings,
                      closureConfirmThreshold: Number(e.target.value) || 3,
                    })
                  }
                />
              </Field>

              <Field label="Default Monitoring Interval (Days)">
                <input
                  type="number"
                  min={1}
                  max={365}
                  className={inputCls}
                  value={activeSettings.monitoringDefaultDays}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...activeSettings,
                      monitoringDefaultDays: Number(e.target.value) || 30,
                    })
                  }
                />
              </Field>

              <Field label="Daily AI Budget Cap (Calls)">
                <input
                  type="number"
                  min={0}
                  max={5000}
                  className={inputCls}
                  value={activeSettings.aiDailyBudgetCalls}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...activeSettings,
                      aiDailyBudgetCalls: Number(e.target.value) || 0,
                    })
                  }
                />
              </Field>
            </div>

            {activeSettings.updatedBy && (
              <p className="text-[11px] text-slate-400">
                Last updated by {activeSettings.updatedBy} on {formatDate(activeSettings.updatedAt)}.
              </p>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <AlertTriangle size={14} className="text-amber-500" />
                <span>Automated discovery never awards Owner Verified badges or invents fields.</span>
              </div>
              <Btn type="submit" variant="primary" loading={savingSettings}>
                Save Bot Controls
              </Btn>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
