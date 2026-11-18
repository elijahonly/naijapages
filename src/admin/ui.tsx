import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, Search, X } from 'lucide-react';
import { useModal } from '../hooks/useModal';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatDate(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}

export function shortDate(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function initials(name?: string, fallback = '?'): string {
  const n = (name ?? '').trim();
  if (!n) return fallback;
  const parts = n.split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : n.slice(0, 2)).toUpperCase();
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

type Tone = 'green' | 'amber' | 'red' | 'slate' | 'violet' | 'sky';

const toneCls: Record<Tone, string> = {
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  red: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  slate: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  sky: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
};

export const Badge: React.FC<{ tone?: Tone; children: React.ReactNode; title?: string }> = ({ tone = 'slate', children, title }) => (
  <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${toneCls[tone]}`}>
    {children}
  </span>
);

export const statusTone = (status?: string): Tone => {
  switch (status) {
    case 'approved':
    case 'active':
    case 'resolved':
      return 'green';
    case 'pending':
    case 'open':
    case 'new':
      return 'amber';
    case 'rejected':
    case 'removed':
      return 'red';
    default:
      return 'slate';
  }
};

type BtnVariant = 'primary' | 'danger' | 'outline' | 'ghost' | 'amber' | 'dark';

const btnCls: Record<BtnVariant, string> = {
  primary: 'bg-emerald-600 hover:bg-emerald-700 text-white border-transparent',
  danger: 'bg-rose-600 hover:bg-rose-700 text-white border-transparent',
  amber: 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-transparent',
  dark: 'bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-900 border-transparent',
  outline:
    'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700',
  ghost: 'bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 border-transparent',
};

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'xs' | 'sm' | 'md';
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Btn: React.FC<BtnProps> = ({ variant = 'outline', size = 'sm', loading, icon, children, className = '', disabled, ...rest }) => {
  const sizeCls = size === 'xs' ? 'px-2 py-1 text-[11px]' : size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-bold transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${sizeCls} ${btnCls[variant]} ${className}`}
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : icon}
      {children}
    </button>
  );
};

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm ${className}`}>{children}</div>
);

export const PageHeader: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode }> = ({ title, subtitle, actions }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
    <div>
      <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white">{title}</h1>
      {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 max-w-2xl">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: string; count?: number; alert?: boolean }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 mb-4 p-1 bg-slate-200/60 dark:bg-slate-800/60 rounded-xl w-fit max-w-full overflow-x-auto">
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            value === t.id
              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          {t.label}
          {t.count !== undefined && (
            <span
              className={`px-1.5 rounded-full text-[10px] ${
                t.alert && t.count > 0 ? 'bg-amber-400 text-slate-950' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export const SearchBox: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string; className?: string }> = ({
  value,
  onChange,
  placeholder = 'Search…',
  className = '',
}) => (
  <div className={`relative ${className}`}>
    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-slate-900 dark:text-white"
    />
  </div>
);

export const Spinner: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="py-14 flex flex-col items-center gap-2 text-emerald-600" role="status">
    <Loader2 className="animate-spin" />
    <span className="text-xs text-slate-500">{label}</span>
  </div>
);

export const EmptyState: React.FC<{ icon?: React.ReactNode; title: string; hint?: string }> = ({ icon, title, hint }) => (
  <div className="py-12 px-4 text-center">
    {icon && <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mb-3">{icon}</div>}
    <p className="font-bold text-slate-700 dark:text-slate-200 text-sm">{title}</p>
    {hint && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">{hint}</p>}
  </div>
);

export const ErrorNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div role="alert" className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
    <AlertCircle size={15} className="shrink-0 mt-0.5" />
    <span>{children}</span>
  </div>
);

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export const inputCls =
  'w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-slate-900 dark:text-white';

export const Field: React.FC<{ label: string; hint?: string; htmlFor?: string; children: React.ReactNode }> = ({ label, hint, htmlFor, children }) => (
  <div>
    <label htmlFor={htmlFor} className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
      {label}
    </label>
    {children}
    {hint && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{hint}</p>}
  </div>
);

export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }> = ({
  checked,
  onChange,
  label,
  description,
}) => (
  <div className="flex items-start justify-between gap-4">
    <div>
      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{label}</p>
      {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-md">{description}</p>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 w-11 h-6 rounded-full transition cursor-pointer ${checked ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export const Modal: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}> = ({ title, onClose, children, footer, wide }) => {
  useModal(onClose);
  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full ${wide ? 'max-w-3xl' : 'max-w-md'} rounded-2xl shadow-2xl my-6 max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 flex items-center justify-between border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h2 className="font-extrabold text-slate-900 dark:text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Confirm dialog (promise based, optional "reason" box and extra checkbox)
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  /** Show a text box; its content is returned as `reason`. */
  reason?: { label: string; placeholder?: string; required?: boolean };
  /** Show an extra checkbox; its state is returned as `checked`. */
  checkbox?: { label: string; defaultChecked?: boolean };
}

export interface ConfirmResult {
  ok: boolean;
  reason: string;
  checked: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<ConfirmResult>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

export const useConfirm = (): ConfirmFn => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
};

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const resolver = useRef<((r: ConfirmResult) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setReason('');
    setChecked(!!o.checkbox?.defaultChecked);
    setOpts(o);
    return new Promise<ConfirmResult>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (ok: boolean) => {
    resolver.current?.({ ok, reason: reason.trim(), checked });
    resolver.current = null;
    setOpts(null);
  };

  const needsReason = !!opts?.reason?.required && reason.trim().length < 3;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <Modal
          title={opts.title}
          onClose={() => finish(false)}
          footer={
            <>
              <Btn variant="ghost" onClick={() => finish(false)}>Cancel</Btn>
              <Btn variant={opts.tone === 'danger' ? 'danger' : 'primary'} disabled={needsReason} onClick={() => finish(true)}>
                {opts.confirmLabel ?? 'Confirm'}
              </Btn>
            </>
          }
        >
          {opts.message && <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-3">{opts.message}</div>}
          {opts.reason && (
            <Field label={`${opts.reason.label}${opts.reason.required ? ' *' : ''}`} htmlFor="confirm-reason">
              <textarea
                id="confirm-reason"
                autoFocus
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={opts.reason.placeholder}
                className={inputCls}
              />
            </Field>
          )}
          {opts.checkbox && (
            <label className="mt-3 flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 accent-emerald-600" />
              <span>{opts.checkbox.label}</span>
            </label>
          )}
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface ToastApi {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export const useToast = (): ToastApi => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<{ id: number; kind: 'success' | 'error' | 'info'; msg: string }[]>([]);
  const counter = useRef(0);

  const push = useCallback((kind: 'success' | 'error' | 'info', msg: string) => {
    const id = ++counter.current;
    setToasts((t) => [...t, { id, kind, msg }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({ success: (m) => push('success', m), error: (m) => push('error', m), info: (m) => push('info', m) }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[90] flex flex-col gap-2 max-w-sm" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`flex items-start gap-2 px-4 py-3 rounded-xl shadow-xl border text-xs font-semibold ${
              t.kind === 'error'
                ? 'bg-rose-600 text-white border-rose-700'
                : t.kind === 'success'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-700 dark:border-slate-300'
                  : 'bg-sky-600 text-white border-sky-700'
            }`}
          >
            {t.kind === 'error' ? <AlertCircle size={15} className="shrink-0 mt-0.5" /> : t.kind === 'success' ? <CheckCircle2 size={15} className="shrink-0 mt-0.5 text-emerald-400 dark:text-emerald-600" /> : <Info size={15} className="shrink-0 mt-0.5" />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
