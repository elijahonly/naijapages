import React, { useRef, useState } from 'react';
import { X, ShieldCheck, CheckCircle, Send, Loader2, AlertCircle, Paperclip, Trash2 } from 'lucide-react';
import { Business } from '../types';
import { useAuth } from '../context/AuthContext';
import { useModal } from '../hooks/useModal';
import { CLAIM_ROLES, submitClaim, ValidationError } from '../services/content';
import { deleteMediaFile, uploadMediaFile } from '../services/media';
import { friendlyError } from '../lib/errors';

interface ClaimListingModalProps {
  business: Business | null;
  isOpen: boolean;
  onClose: () => void;
  /** Called after the claim request has been saved for admin review. */
  onSubmitted?: (business: Business) => void;
}

const fieldCls =
  'w-full px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white';
const labelCls = 'block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1';

const ClaimForm: React.FC<ClaimListingModalProps & { business: Business }> = ({ business, onClose, onSubmitted }) => {
  useModal(onClose);
  const { currentUser, userProfile } = useAuth();

  const [ownerName, setOwnerName] = useState(userProfile?.displayName ?? '');
  const [ownerEmail, setOwnerEmail] = useState(currentUser?.email ?? '');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [role, setRole] = useState<string>(CLAIM_ROLES[0]);
  const [proofNote, setProofNote] = useState('');
  const [proofAttachmentUrl, setProofAttachmentUrl] = useState<string | null>(null);
  const [proofFileName, setProofFileName] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);

  const handleProofUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploadingProof(true);
    try {
      const media = await uploadMediaFile({
        file,
        purpose: 'claim_proof',
        replaceKey: proofAttachmentUrl?.replace(/^\/api\/media\//, '') || undefined,
      });
      setProofAttachmentUrl(media.url);
      setProofFileName(media.originalFilename || file.name);
    } catch (err) {
      setError(friendlyError(err, 'Could not upload proof document.'));
    } finally {
      setUploadingProof(false);
    }
  };

  const handleProofRemove = async () => {
    if (!proofAttachmentUrl) return;
    const prev = proofAttachmentUrl;
    setProofAttachmentUrl(null);
    setProofFileName(null);
    await deleteMediaFile(prev).catch(() => {});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || uploadingProof || !currentUser) return;
    setError(null);
    setSubmitting(true);
    try {
      await submitClaim(
        currentUser,
        { id: business.id, name: business.name },
        {
          name: ownerName,
          email: ownerEmail,
          phone: ownerPhone,
          role,
          proofNote,
          proofAttachmentUrl: proofAttachmentUrl || undefined,
        },
      );
      setIsSuccess(true);
      onSubmitted?.(business);
    } catch (err) {
      setError(err instanceof ValidationError ? err.message : friendlyError(err, 'We could not submit your claim. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-title"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-800 to-teal-800 text-white p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <h2 id="claim-title" className="font-extrabold text-lg">Claim {business.name}</h2>
              <p className="text-xs text-emerald-100">Request the official verification badge and owner status.</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isSuccess ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 mx-auto flex items-center justify-center">
              <CheckCircle className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Claim request received</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
              Thanks! Our team will review your ownership claim for <b>{business.name}</b> and contact you using the details you provided.
              The verified badge is added once the review is complete.
            </p>
            <button onClick={onClose} className="mt-2 px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl cursor-pointer">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
              Claims are checked by our team before any badge is awarded, so please include something we can verify (such as your CAC number).
            </div>

            {error && (
              <div role="alert" className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className={labelCls} htmlFor="claim-name">Full Name *</label>
              <input id="claim-name" type="text" required maxLength={100} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="e.g. Emeka Okafor" className={fieldCls} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="claim-email">Official Email *</label>
                <input id="claim-email" type="email" required maxLength={150} value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="contact@business.ng" className={fieldCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="claim-phone">Direct Contact Phone *</label>
                <input id="claim-phone" type="tel" required maxLength={25} value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="08012345678" className={fieldCls} />
              </div>
            </div>

            <div>
              <label className={labelCls} htmlFor="claim-role">Your Role in the Organization</label>
              <select id="claim-role" value={role} onChange={(e) => setRole(e.target.value)} className={fieldCls}>
                {CLAIM_ROLES.map((r) => (
                  <option key={r} value={r}>{r === 'Marketing & PR' ? 'Marketing & PR Representative' : r}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls} htmlFor="claim-proof">Verification details (CAC registration number, utility bill, or website note)</label>
              <textarea id="claim-proof" rows={2} maxLength={1000} value={proofNote} onChange={(e) => setProofNote(e.target.value)} placeholder="CAC RC Number: RC-XXXXXX or other proof…" className={fieldCls} />
            </div>

            <div>
              <span className={labelCls}>Supporting document (Private — JPG, PNG, WebP, or PDF, max 8 MB)</span>
              <input
                ref={proofInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="sr-only"
                onChange={handleProofUpload}
                aria-label="Upload private claim proof document"
              />
              {proofAttachmentUrl ? (
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <Paperclip size={14} className="text-emerald-600 shrink-0" />
                    <span className="font-semibold text-emerald-900 dark:text-emerald-200 truncate">
                      {proofFileName || 'Private proof uploaded'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={uploadingProof}
                      onClick={() => proofInputRef.current?.click()}
                      className="px-2 py-1 text-[11px] font-bold bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-700 rounded-lg cursor-pointer"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={handleProofRemove}
                      aria-label="Remove proof attachment"
                      className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={uploadingProof}
                  onClick={() => proofInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:border-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {uploadingProof ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
                  <span>{uploadingProof ? 'Uploading private document…' : 'Attach CAC certificate or utility bill (optional)'}</span>
                </button>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Stored privately — only you and reviewing administrators can access this file.
              </p>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={submitting || uploadingProof} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-xs px-5 py-2 rounded-xl flex items-center gap-1.5 transition cursor-pointer">
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>{submitting ? 'Submitting…' : 'Submit Claim for Review'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export const ClaimListingModal: React.FC<ClaimListingModalProps> = (props) =>
  props.isOpen && props.business ? <ClaimForm {...props} business={props.business} /> : null;
