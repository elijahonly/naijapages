import React, { useState } from 'react';
import { Flag, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { REPORT_REASONS, ReportReason, ReportTargetType } from '../types';
import { useAuth } from '../context/AuthContext';
import { useModal } from '../hooks/useModal';
import { submitReport, ValidationError } from '../services/content';
import { friendlyError } from '../lib/errors';

export interface ReportTarget {
  type: ReportTargetType;
  id: string;
  title: string;
}

interface ReportModalProps {
  target: ReportTarget | null;
  onClose: () => void;
}

const typeLabel: Record<ReportTargetType, string> = {
  business: 'business listing',
  ad: 'marketplace ad',
  review: 'review',
};

const ReportForm: React.FC<{ target: ReportTarget; onClose: () => void }> = ({ target, onClose }) => {
  useModal(onClose);
  const { currentUser, userProfile } = useAuth();
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || submitting) return;
    if (!reason) return setError('Please choose a reason.');
    setError(null);
    setSubmitting(true);
    try {
      await submitReport(currentUser, userProfile?.displayName, target, reason, details);
      setDone(true);
    } catch (err) {
      setError(err instanceof ValidationError ? err.message : friendlyError(err, 'We could not send your report. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden my-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <Flag size={18} />
            </div>
            <div>
              <h2 id="report-title" className="font-extrabold text-slate-900 dark:text-white text-base">Report this {typeLabel[target.type]}</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">{target.title}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>

        {done ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 mx-auto flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-white">Thank you. Report received.</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Our team will look into it. Reports are confidential: the owner is not told who reported them.
            </p>
            <button onClick={onClose} className="px-5 py-2 text-xs font-bold bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl">Close</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {error && (
              <div role="alert" className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <fieldset>
              <legend className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">What’s wrong?</legend>
              <div className="space-y-1.5">
                {REPORT_REASONS.map((r) => (
                  <label key={r} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs cursor-pointer transition ${reason === r ? 'border-rose-400 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 font-semibold' : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                    <input type="radio" name="report-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-rose-600" />
                    <span>{r}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="report-details" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">More details (optional)</label>
              <textarea id="report-details" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Tell us what happened so we can act quickly…" className="w-full px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-rose-400 text-slate-900 dark:text-white" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl">Cancel</button>
              <button type="submit" disabled={submitting} className="px-5 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white rounded-xl flex items-center gap-1.5">
                {submitting && <Loader2 size={14} className="animate-spin" />}
                <span>Send report</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export const ReportModal: React.FC<ReportModalProps> = ({ target, onClose }) =>
  target ? <ReportForm target={target} onClose={onClose} /> : null;
