import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Globe,
  MessageCircle,
  Pencil,
  QrCode,
  RotateCcw,
  X,
} from 'lucide-react';
import { Business } from '../types';
import { useModal } from '../hooks/useModal';
import {
  buildQrFileName,
  formatCompactUrl,
  QrTargetType,
  resolveBusinessQrTargets,
} from '../lib/qrCode';

interface QrCodeModalProps {
  business: Business | null;
  isOpen: boolean;
  onClose: () => void;
  onEditBusiness?: (business: Business) => void;
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
        if (lines.length === maxLines) {
          const lastIdx = lines.length - 1;
          let trimmed = lines[lastIdx];
          while (trimmed.length > 3 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
            trimmed = trimmed.slice(0, -1);
          }
          lines[lastIdx] = `${trimmed}…`;
          return lines;
        }
      }
      current = word;
    }
  }

  if (current) {
    if (lines.length < maxLines) {
      lines.push(current);
    } else {
      const lastIdx = lines.length - 1;
      let trimmed = lines[lastIdx];
      while (trimmed.length > 3 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
        trimmed = trimmed.slice(0, -1);
      }
      lines[lastIdx] = `${trimmed}…`;
    }
  }

  return lines;
}

function triggerFileDownload(href: string, filename: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Could not encode PNG image'));
      }
    }, 'image/png');
  });
}

function renderQrToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  options: QRCode.QRCodeRenderersOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    QRCode.toCanvas(canvas, text, options, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

const QrCodeDialog: React.FC<QrCodeModalProps & { business: Business }> = ({
  business,
  onClose,
  onEditBusiness,
}) => {
  useModal(onClose);

  const initialResolution = useMemo(() => resolveBusinessQrTargets(business), [business]);
  const [selectedTarget, setSelectedTarget] = useState<QrTargetType>(
    initialResolution.defaultTarget ?? 'whatsapp',
  );
  const [includeGreeting, setIncludeGreeting] = useState(true);
  const [greetingText, setGreetingText] = useState(initialResolution.defaultGreeting);
  const [includeCardLabel, setIncludeCardLabel] = useState(true);
  const [copied, setCopied] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const resolution = useMemo(
    () =>
      resolveBusinessQrTargets(business, {
        includeGreeting,
        greeting: greetingText,
      }),
    [business, includeGreeting, greetingText],
  );

  // Keep active tab valid if business prop changes
  const activeTargetType: QrTargetType | null = useMemo(() => {
    if (!resolution.hasAnyTarget) return null;
    if (resolution.targets[selectedTarget].available) return selectedTarget;
    return resolution.defaultTarget;
  }, [resolution, selectedTarget]);

  const activeTarget = activeTargetType ? resolution.targets[activeTargetType] : null;
  const activeUrl = activeTarget?.url ?? null;

  useEffect(() => {
    if (!activeUrl || !canvasRef.current) return;
    let cancelled = false;
    setRenderError(null);

    void renderQrToCanvas(canvasRef.current, activeUrl, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    }).catch(() => {
      if (!cancelled) {
        setRenderError('Could not render QR code for this link. Please check the contact details.');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeUrl]);

  const handleCopyLink = async () => {
    if (!activeUrl) return;
    try {
      await navigator.clipboard.writeText(activeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      setExportStatus('Clipboard access unavailable in this browser.');
      setTimeout(() => setExportStatus(null), 2600);
    }
  };

  const handleDownloadPng = async () => {
    if (!activeUrl || !activeTargetType || !activeTarget) return;
    const filename = buildQrFileName(business.name, activeTargetType, 'png');

    try {
      if (!includeCardLabel) {
        const plainCanvas = document.createElement('canvas');
        await renderQrToCanvas(plainCanvas, activeUrl, {
          width: 640,
          margin: 3,
          errorCorrectionLevel: 'M',
          color: { dark: '#0f172a', light: '#ffffff' },
        });
        const blob = await canvasToPngBlob(plainCanvas);
        const blobUrl = URL.createObjectURL(blob);
        triggerFileDownload(blobUrl, filename);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
        setExportStatus(`Saved ${filename}`);
        setTimeout(() => setExportStatus(null), 2600);
        return;
      }

      const cardWidth = 800;
      const cardHeight = 980;
      const offscreen = document.createElement('canvas');
      offscreen.width = cardWidth;
      offscreen.height = cardHeight;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return;

      // Clean white printable surface
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cardWidth, cardHeight);

      // Top brand accent strip
      ctx.fillStyle = activeTargetType === 'whatsapp' ? '#047857' : '#0f172a';
      ctx.fillRect(0, 0, cardWidth, 24);

      // Subtle card outline
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, cardWidth - 4, cardHeight - 4);

      // Directory kicker
      ctx.textAlign = 'center';
      ctx.fillStyle = '#047857';
      ctx.font = '700 20px system-ui, -apple-system, sans-serif';
      ctx.fillText(
        business.isVerified ? 'NAIJAPAGES VERIFIED BUSINESS' : 'NAIJAPAGES BUSINESS QR',
        cardWidth / 2,
        78,
      );

      // Business name
      ctx.fillStyle = '#0f172a';
      ctx.font = '800 38px system-ui, -apple-system, sans-serif';
      const titleLines = wrapCanvasText(ctx, business.name, cardWidth - 110, 2);
      titleLines.forEach((line, idx) => {
        ctx.fillText(line, cardWidth / 2, 130 + idx * 46);
      });

      // Location & category line
      const subtitleY = 130 + titleLines.length * 46 + 8;
      ctx.fillStyle = '#475569';
      ctx.font = '500 22px system-ui, -apple-system, sans-serif';
      const locationText = `${business.category} • ${business.lga ? `${business.lga}, ` : ''}${business.state} State`;
      const subtitleLines = wrapCanvasText(ctx, locationText, cardWidth - 120, 1);
      ctx.fillText(subtitleLines[0] || locationText, cardWidth / 2, subtitleY);

      // Render high-res QR code onto a temp canvas
      const qrSize = 520;
      const qrCanvas = document.createElement('canvas');
      await renderQrToCanvas(qrCanvas, activeUrl, {
        width: qrSize,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#0f172a', light: '#ffffff' },
      });

      const qrTop = subtitleY + 34;
      const qrLeft = Math.round((cardWidth - qrSize) / 2);

      // Quiet zone frame
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 3;
      ctx.fillRect(qrLeft - 18, qrTop - 18, qrSize + 36, qrSize + 36);
      ctx.strokeRect(qrLeft - 18, qrTop - 18, qrSize + 36, qrSize + 36);
      ctx.drawImage(qrCanvas, qrLeft, qrTop, qrSize, qrSize);

      // Scan call-to-action
      const ctaY = qrTop + qrSize + 72;
      ctx.fillStyle = activeTargetType === 'whatsapp' ? '#15803d' : '#0f172a';
      ctx.font = '800 30px system-ui, -apple-system, sans-serif';
      ctx.fillText(
        activeTargetType === 'whatsapp'
          ? 'Scan to chat on WhatsApp'
          : 'Scan to open official website',
        cardWidth / 2,
        ctaY,
      );

      // Direct display value
      ctx.fillStyle = '#475569';
      ctx.font = '600 22px ui-monospace, SFMono-Regular, Menlo, monospace';
      const valueText = activeTarget.displayValue || formatCompactUrl(activeUrl);
      const valueLines = wrapCanvasText(ctx, valueText, cardWidth - 110, 1);
      ctx.fillText(valueLines[0] || valueText, cardWidth / 2, ctaY + 42);

      const blob = await canvasToPngBlob(offscreen);
      const blobUrl = URL.createObjectURL(blob);
      triggerFileDownload(blobUrl, filename);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      setExportStatus(`Saved ${filename}`);
      setTimeout(() => setExportStatus(null), 2600);
    } catch {
      setExportStatus('Could not export PNG. Please try again.');
      setTimeout(() => setExportStatus(null), 2600);
    }
  };

  const handleDownloadSvg = async () => {
    if (!activeUrl || !activeTargetType) return;
    const filename = buildQrFileName(business.name, activeTargetType, 'svg');
    try {
      const svgMarkup = await QRCode.toString(activeUrl, {
        type: 'svg',
        width: 512,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      triggerFileDownload(blobUrl, filename);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
      setExportStatus(`Saved ${filename}`);
      setTimeout(() => setExportStatus(null), 2600);
    } catch {
      setExportStatus('Could not export SVG. Please try again.');
      setTimeout(() => setExportStatus(null), 2600);
    }
  };

  const whatsappOption = resolution.targets.whatsapp;
  const websiteOption = resolution.targets.website;
  const isGreetingModified = greetingText.trim() !== resolution.defaultGreeting.trim();

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-emerald-900 text-white px-5 py-4 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-800 border border-emerald-600/60 flex items-center justify-center shrink-0 mt-0.5">
              <QrCode className="w-5 h-5 text-emerald-200" />
            </div>
            <div className="min-w-0">
              <h2 id="qr-modal-title" className="font-extrabold text-base sm:text-lg leading-tight truncate">
                Business QR Code
              </h2>
              <p className="text-xs text-emerald-200/90 truncate mt-0.5">
                {business.name} • {business.state} State
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR code generator"
            className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {!resolution.hasAnyTarget ? (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-slate-200/80 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto">
                <QrCode className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  No WhatsApp or Website Link Yet
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
                  Add a WhatsApp number, phone number, or website URL to <b>{business.name}</b> to generate a scannable direct-action QR code.
                </p>
              </div>
              {onEditBusiness && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEditBusiness(business);
                  }}
                  className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer whitespace-nowrap"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Add Contact Details</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Destination Segmented Control */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Scan Action Destination
                </p>
                <div
                  role="tablist"
                  aria-label="QR code destination"
                  className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTargetType === 'whatsapp'}
                    disabled={!whatsappOption.available}
                    title={whatsappOption.unavailableReason}
                    onClick={() => setSelectedTarget('whatsapp')}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                      activeTargetType === 'whatsapp'
                        ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs border border-slate-200/80 dark:border-slate-700 cursor-pointer'
                        : whatsappOption.available
                          ? 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer'
                          : 'text-slate-400 dark:text-slate-500 opacity-55 cursor-not-allowed'
                    }`}
                  >
                    <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>WhatsApp Chat</span>
                  </button>

                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTargetType === 'website'}
                    disabled={!websiteOption.available}
                    title={websiteOption.unavailableReason}
                    onClick={() => setSelectedTarget('website')}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                      activeTargetType === 'website'
                        ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs border border-slate-200/80 dark:border-slate-700 cursor-pointer'
                        : websiteOption.available
                          ? 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer'
                          : 'text-slate-400 dark:text-slate-500 opacity-55 cursor-not-allowed'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5 shrink-0" />
                    <span>Official Website</span>
                  </button>
                </div>

                {(!whatsappOption.available || !websiteOption.available) && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {!whatsappOption.available
                      ? 'WhatsApp is unavailable because no WhatsApp or phone number is listed.'
                      : 'Website QR is unavailable because no website URL is listed for this business.'}
                  </p>
                )}
              </div>

              {/* Scannable QR Preview Card — pure white surface even in dark mode for reliable camera scanning */}
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 p-4 flex flex-col items-center text-center gap-3">
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  {renderError ? (
                    <div className="w-[240px] h-[240px] flex items-center justify-center text-xs text-rose-600 px-4">
                      {renderError}
                    </div>
                  ) : (
                    <canvas
                      ref={canvasRef}
                      data-testid="business-qr-canvas"
                      aria-label={`QR code for ${business.name} ${activeTargetType === 'whatsapp' ? 'WhatsApp' : 'website'}`}
                      className="block w-[220px] h-[220px] sm:w-[240px] sm:h-[240px]"
                    />
                  )}
                </div>

                <div className="space-y-1 max-w-full">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center justify-center gap-1.5">
                    {activeTargetType === 'whatsapp' ? (
                      <>
                        <MessageCircle className="w-3.5 h-3.5 text-[#25D366]" />
                        <span>Scan with any phone camera to open WhatsApp immediately</span>
                      </>
                    ) : (
                      <>
                        <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>Scan with any phone camera to open website immediately</span>
                      </>
                    )}
                  </p>
                  {activeTarget?.displayValue && (
                    <p
                      data-testid="qr-destination-display"
                      className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400 break-all"
                    >
                      {activeTarget.displayValue}
                    </p>
                  )}
                </div>
              </div>

              {/* WhatsApp Pre-filled Greeting Controls */}
              {activeTargetType === 'whatsapp' && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="qr-include-greeting"
                      className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer select-none"
                    >
                      <input
                        id="qr-include-greeting"
                        type="checkbox"
                        checked={includeGreeting}
                        onChange={(e) => setIncludeGreeting(e.target.checked)}
                        className="rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Include pre-filled WhatsApp greeting</span>
                    </label>

                    {includeGreeting && isGreetingModified && (
                      <button
                        type="button"
                        onClick={() => setGreetingText(resolution.defaultGreeting)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Reset</span>
                      </button>
                    )}
                  </div>

                  {includeGreeting && (
                    <div>
                      <label htmlFor="qr-greeting-input" className="sr-only">
                        Pre-filled WhatsApp message
                      </label>
                      <input
                        id="qr-greeting-input"
                        type="text"
                        maxLength={240}
                        value={greetingText}
                        onChange={(e) => setGreetingText(e.target.value)}
                        placeholder="Type the message customers see when they scan..."
                        className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:border-emerald-500"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Encoded URL & Direct Test / Copy Bar */}
              {activeUrl && (
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-3 py-2">
                  <span
                    data-testid="qr-encoded-url"
                    className="flex-1 min-w-0 text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate"
                    title={activeUrl}
                  >
                    {activeUrl}
                  </span>

                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Link</span>
                      </>
                    )}
                  </button>

                  <a
                    href={activeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 transition shrink-0 whitespace-nowrap"
                  >
                    <span>Test</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {/* Printable Label Option & Download Actions */}
              <div className="space-y-3 pt-1">
                <label
                  htmlFor="qr-include-card-label"
                  className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none"
                >
                  <input
                    id="qr-include-card-label"
                    type="checkbox"
                    checked={includeCardLabel}
                    onChange={(e) => setIncludeCardLabel(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Include printable business name &amp; scan label on PNG download</span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={handleDownloadPng}
                    className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 px-4 rounded-xl shadow-xs transition cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    <span>Download PNG</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadSvg}
                    className="inline-flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold text-xs py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 transition cursor-pointer whitespace-nowrap"
                  >
                    <FileCode2 className="w-4 h-4 shrink-0" />
                    <span>Download SVG</span>
                  </button>
                </div>

                {exportStatus && (
                  <p role="status" className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 text-center">
                    {exportStatus}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export const QrCodeModal: React.FC<QrCodeModalProps> = (props) =>
  props.isOpen && props.business ? (
    <QrCodeDialog key={props.business.id} {...props} business={props.business} />
  ) : null;
