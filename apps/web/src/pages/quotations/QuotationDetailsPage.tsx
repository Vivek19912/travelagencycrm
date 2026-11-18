import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  Pencil,
  ExternalLink,
  FileText,
  Plus,
  Sparkles,
  TicketCheck,
  Trash2,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  labelForLookup,
  PERMISSIONS,
  resolveQuotationPricing,
  validateQuotationPricing,
} from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  useGenerateQuotationPdf,
  useQuotation,
  useQuotationAction,
  useSendQuotation,
  useUpdateQuotationVersion,
  type PublicLinkPayload,
} from '@/features/quotations/quotations.api';
import { apiClient } from '@/api/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { quotationKeys } from '@/features/quotations/quotations.api';
import { WeblinkVisitors } from '@/features/quotations/WeblinkVisitors';
import { WhatsappSummaryDialog } from './WhatsappSummaryDialog';
import { PricingMethodSelector, pricingModeLabel } from './PricingMethodSelector';
import { formatDateTime12Hour } from '@/utils/dateTime';
import type {
  buildWhatsAppSummary,
} from '@/features/quotations/whatsappSummary';

const field = 'w-full rounded-lg border border-slate-300 bg-card px-3 py-2 text-sm';
export function QuotationDetailsPage() {
  const { quotationId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission, user } = useAuth();
  const query = useQuotation(quotationId);
  const action = useQuotationAction(quotationId);
  const generatePdf = useGenerateQuotationPdf(quotationId);
  const send = useSendQuotation(quotationId);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`/quotations/${quotationId}/permanent`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: quotationKeys.quotations });
      void queryClient.invalidateQueries({ queryKey: quotationKeys.quotation(quotationId) });
      navigate('/quotations', { state: { successMessage: 'Quotation permanently deleted.' } });
    },
    onError: (error: unknown) => {
      setDeleteError(error instanceof Error && error.message ? error.message : 'Unable to delete quotation. Please try again.');
    },
  });
  const [sendOpen, setSendOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [includePdf, setIncludePdf] = useState(true);
  const [includePublicLink, setIncludePublicLink] = useState(true);
  const [pdfError, setPdfError] = useState('');
  const [actionError, setActionError] = useState('');
  // Visible confirmation after a successful finalize (the status flip also
  // removes the button, but the agent should never be left guessing).
  const [actionSuccess, setActionSuccess] = useState('');
  const [pdfChoiceOpen, setPdfChoiceOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [hasAttemptedFinalize, setHasAttemptedFinalize] = useState(false);
  // Pricing method (moved here from the Quotation Builder). Saved to the
  // current version immediately; the backend recomputes the final amount.
  const [pricingMethodError, setPricingMethodError] = useState('');
  // Pricing Method section expand/collapse. Collapsed by default; reset when a
  // different quotation or version loads so the section never opens by itself.
  const [pricingMethodOpen, setPricingMethodOpen] = useState(false);
  // Public weblink URL once provisioned, tagged with the version it belongs to.
  // Reset whenever the current version changes so Copy/Open always target the
  // currently displayed version (never a stale link from an earlier version).
  const [publicLinkUrl, setPublicLinkUrl] = useState<string | null>(null);
  // Staff-preview variant of the weblink: the same URL plus a short-lived
  // signed staff-view signal, so a signed-in employee opening the link from the
  // branded/custom domain is classified HOME rather than as a customer visit.
  // Never used for the shared "Copy Weblink URL" value.
  const [publicStaffViewUrl, setPublicStaffViewUrl] = useState<string | null>(null);
  const [publicLinkVersionId, setPublicLinkVersionId] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pre-provision the public link so the Open Weblink anchor is a real href
  // (the action is idempotent). Re-runs when the current version changes so the
  // cached link never points at an older version. Guarded on query.data so this
  // hook runs unconditionally before any early return.
  useEffect(() => {
    const data = query.data;
    const current =
      data?.versions.find((version) => version.id === data.currentVersionId) ?? data?.versions[0];
    if (!current) {
      setPublicLinkUrl(null);
      setPublicStaffViewUrl(null);
      setPublicLinkVersionId(null);
      return;
    }
    if (publicLinkVersionId === current.id && publicLinkUrl) return;
    setPublicLinkUrl(null);
    setPublicStaffViewUrl(null);
    setPublicLinkVersionId(null);
    action.mutate(
      { path: 'public-link', body: { quotationVersionId: current.id, staffView: true } },
      {
        onSuccess: (result) => {
          const payload = result as PublicLinkPayload;
          const url = payload.url ?? null;
          if (url) {
            setPublicLinkUrl(url);
            setPublicStaffViewUrl(payload.staffViewUrl ?? null);
            setPublicLinkVersionId(current.id);
          }
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, publicLinkVersionId, publicLinkUrl]);

  useEffect(() => {
    setHasAttemptedFinalize(false);
  }, [query.data?.id, query.data?.currentVersionId]);

  // Resolve the current version ahead of the loading early-return so the
  // title/package-heading PATCH hook below never breaks hook ordering.
  const metaCurrent = query.data
    ? (query.data.versions.find((version) => version.id === query.data?.currentVersionId) ??
      query.data.versions[0])
    : undefined;
  const updateMeta = useUpdateQuotationVersion(quotationId, metaCurrent?.id ?? '');
  // Reset transient section state whenever a different quotation or version
  // loads so the Pricing Method section always starts collapsed.
  useEffect(() => {
    setPricingMethodOpen(false);
    setPricingMethodError('');
  }, [query.data?.id, query.data?.currentVersionId]);

  if (query.isLoading) return <div className="h-96 animate-pulse rounded-xl bg-card" />;
  if (!query.data)
    return <div className="rounded-xl bg-card p-12 text-center">Quotation unavailable.</div>;
  const q = query.data;
  const current = q.versions.find((version) => version.id === q.currentVersionId) ?? q.versions[0];
  const pricingIssues = (() => {
    if (!current) return [] as ReturnType<typeof validateQuotationPricing>;
    try {
      return validateQuotationPricing({
        version: current as unknown as Parameters<typeof validateQuotationPricing>[0]['version'],
        quotation: q as unknown as Parameters<typeof validateQuotationPricing>[0]['quotation'],
      });
    } catch {
      return [] as ReturnType<typeof validateQuotationPricing>;
    }
  })();
  // Only show the large incomplete-pricing warning after the user has tried to finalize.
  // Before that, a newly created draft with no pricing is a normal Draft.
  const isDraftIncomplete = current?.status === 'DRAFT' && hasAttemptedFinalize && pricingIssues.length > 0;
  const money = (value: string, currency: string) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(Number(value));
  const createRevision = () => {
    if (!current) return;
    setActionError('');
    setActionSuccess('');
    action.mutate(
      { path: 'versions', body: { sourceVersionId: current.id } },
      {
        onSuccess: () => setActionError(''),
        onError: (error) =>
          setActionError(
            error instanceof Error && error.message
              ? error.message
              : 'Unable to create a revision. Please try again.',
          ),
      },
    );
  };
  /**
   * Finalize the current DRAFT version. The backend runs the authoritative
   * pricing validation (validateQuotationPricing) and a 400/422 carries the
   * exact pricing errors — they MUST reach the agent, never fail silently:
   *  - success: refresh the quotation (status flips to FINALIZED via the
   *    mutation's cache invalidation) and confirm visibly;
   *  - 4xx (validation/permission): show the server's message verbatim;
   *  - 5xx / network: show a friendly, visible error.
   * `action.isPending` keeps the button disabled so a double-click cannot
   * fire a duplicate finalize request.
   */
  const handleFinalize = () => {
    if (!current || action.isPending) return;
    setHasAttemptedFinalize(true);
    setActionError('');
    setActionSuccess('');
    action.mutate(
      { path: `versions/${current.id}/finalize` },
      {
        onSuccess: () => {
          setActionError('');
          setActionSuccess(
            `Version v${current.versionNumber} finalized. You can now generate the PDF or send it to the customer.`,
          );
        },
        onError: (error) => {
          setActionSuccess('');
          setActionError(
            error instanceof Error && error.message
              ? error.message
              : 'Unable to finalize this quotation. Please try again.',
          );
        },
      },
    );
  };
  /** Provision the public weblink for the current version; stores the URL for
   *  both Copy Weblink URL and Open Weblink. Returns the cached URLs only when
   *  they still belong to the current version. `staffView` asks the server for
   *  the signed staff-preview variant (used by Open/Preview only). */
  const ensurePublicLink = (
    options: { staffView?: boolean } = {},
  ): Promise<{ url: string; staffViewUrl: string | null } | null> =>
    new Promise((resolve) => {
      if (!current) return resolve(null);
      if (
        publicLinkUrl &&
        publicLinkVersionId === current.id &&
        (!options.staffView || publicStaffViewUrl)
      ) {
        return resolve({ url: publicLinkUrl, staffViewUrl: publicStaffViewUrl });
      }
      action.mutate(
        {
          path: 'public-link',
          body: {
            quotationVersionId: current.id,
            ...(options.staffView ? { staffView: true } : {}),
          },
        },
        {
          onSuccess: (result) => {
            const payload = result as PublicLinkPayload;
            const url = payload.url ?? null;
            if (url) {
              setPublicLinkUrl(url);
              setPublicStaffViewUrl(payload.staffViewUrl ?? null);
              setPublicLinkVersionId(current.id);
            }
            resolve(url ? { url, staffViewUrl: payload.staffViewUrl ?? null } : null);
          },
          onError: () => resolve(null),
        },
      );
    });
  const copyPublicLink = async () => {
    const link = await ensurePublicLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setLinkCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      // Copy failed — do not show "Copied!".
    }
  };
  const openWhatsappSummary = async () => {
    if (current?.status !== 'DRAFT' && !publicLinkUrl) {
      await ensurePublicLink();
    }
    // The shared dialog builds the message itself from the quotation data.
    setWhatsappOpen(true);
  };
  const generateIntoNewTab = async (style: 'CLASSIC' | 'STYLISH' | 'WEBLINK') => {
    if (!current || generatePdf.isPending) return;
    setPdfError('');
    const pdfTab = window.open('about:blank', '_blank');
    if (!pdfTab) {
      setPdfError('Allow pop-ups for this site so the generated PDF can open in a new tab.');
      return;
    }
    pdfTab.opener = null;
    pdfTab.document.title = 'Generating PDF…';
    pdfTab.document.body.innerHTML =
      '<p style="font:16px system-ui;padding:32px">Generating PDF…</p>';
    // Stylish PDF always uses the automatic/default image selection: the
    // destination master image as hero, the default gallery cards, and any
    // previously saved Page 1 defaults applied by the server.
    generatePdf.mutate(
      {
        versionId: current.id,
        style,
        ...(style === 'STYLISH' ? { coverSource: 'DESTINATION' as const } : {}),
      },
      {
        onSuccess: ({ url }) => {
          if (url) pdfTab.location.replace(url);
        },
        onError: () => {
          pdfTab.close();
          setPdfError('PDF generation failed. Please try again.');
        },
      },
    );
  };
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/quotations" className="shrink-0 rounded-lg p-2 hover:bg-card">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <p className="text-sm text-slate-500">Customer quotations / {q.quotationNumber}</p>
            <h1 className="break-words text-2xl font-semibold">
              {q.customerName}
            </h1>
            {q.customer && (
              <span className="text-xs font-medium text-slate-500">
                {q.customer.customerNumber} customer record
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {q.booking ? (
            <Link to={`/bookings/${q.booking.id}`}>
              <Button variant="secondary">
                <TicketCheck className="h-4 w-4" />
                View {q.booking.bookingNumber}
              </Button>
            </Link>
          ) : (
            q.status === 'ACCEPTED' &&
            hasPermission(PERMISSIONS.BOOKINGS_CONVERT_FROM_QUOTATION) && (
              <Link to={`/quotations/${q.id}/convert-to-booking`}>
                <Button>
                  <TicketCheck className="h-4 w-4" />
                  Convert to booking
                </Button>
              </Link>
            )
          )}
          {current?.status === 'DRAFT' && hasPermission(PERMISSIONS.QUOTATIONS_UPDATE) && (
            <Link to={`/quotations/${q.id}/versions/${current.id}/edit`}>
              <Button variant="secondary">
                <Pencil className="h-4 w-4" />
                Edit quotation
              </Button>
            </Link>
          )}
          {current?.status !== 'DRAFT' && hasPermission(PERMISSIONS.QUOTATIONS_UPDATE) && (
            <Button variant="secondary" disabled={action.isPending} onClick={createRevision}>
              <Plus className="h-4 w-4" />
              Create revision
            </Button>
          )}
          {hasPermission(PERMISSIONS.QUOTATIONS_DELETE) && (
            <Button
              variant="secondary"
              className="text-red-700 hover:bg-red-50 hover:text-red-800"
              onClick={() => {
                setDeleteError('');
                setDeleteConfirmOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete quotation
            </Button>
          )}
        </div>
      </header>
      {deleteError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {deleteError}
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {actionSuccess}
        </div>
      )}
      {isDraftIncomplete && (
        <div
          role="note"
          aria-label="Draft pricing incomplete"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <p className="font-medium">Draft pricing is incomplete. You can preview the quotation, but it cannot be finalized until all required pricing is completed.</p>
          {pricingIssues.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {pricingIssues.map((issue, idx) => (
                <li key={idx}>{issue.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <section className="grid gap-3 sm:grid-cols-2">
        {[
          ['Final amount', current ? money(current.finalAmount, current.currency) : '—'],
        ].map(([label, value]) => (
          <article key={label} className="rounded-xl border bg-card p-4">
            <p className="text-xs uppercase text-slate-500">{label}</p>
            <p className="mt-2 font-semibold">{value}</p>
          </article>
        ))}
      </section>
      <section className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-slate-500">
              Linked lead{' '}
              <Link className="text-brand-700" to={`/queries/${q.query.id}`}>
                {q.query.queryNumber}
              </Link>
            </p>
          </div>
          {/* Stacked full-width on phones — these labels are too long to sit
              side by side under ~640px — and the original inline row from sm up. */}
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            {current?.status === 'DRAFT' && hasPermission(PERMISSIONS.QUOTATIONS_UPDATE) && (
              <Button
                className="w-full sm:w-auto"
                isLoading={action.isPending}
                onClick={handleFinalize}
              >
                {action.isPending
                  ? 'Finalizing…'
                  : `Finalize v${current.versionNumber}`}
              </Button>
            )}
            {current && hasPermission(PERMISSIONS.QUOTATIONS_GENERATE_PDF) && (
                <Button
                  className="w-full sm:w-auto"
                  variant="secondary"
                  isLoading={generatePdf.isPending}
                  onClick={() => setPdfChoiceOpen(true)}
                >
                  <FileText className="h-4 w-4" />
                  {generatePdf.isPending ? 'Generating PDF…' : 'Generate PDF'}
                </Button>
              )}
            {current && (
              <TooltipProvider delayDuration={0}>
                <Tooltip
                  open={linkCopied}
                  onOpenChange={(open) => {
                    if (!open) setLinkCopied(false);
                  }}
                >
                  <TooltipTrigger asChild>
                    <Button
                      className="w-full sm:w-auto"
                      variant="secondary"
                      onClick={() => void copyPublicLink()}
                    >
                      <Copy className="h-4 w-4" />
                      Copy Weblink URL
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{linkCopied ? 'Copied!' : 'Copy Weblink URL'}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {current && (
              <a
                className="w-full sm:w-auto"
                href={publicStaffViewUrl ?? publicLinkUrl ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  if (publicStaffViewUrl ?? publicLinkUrl) return;
                  event.preventDefault();
                  const win = window.open('about:blank', '_blank');
                  if (!win) return;
                  win.opener = null;
                  win.document.title = 'Opening preview…';
                  win.document.body.innerHTML =
                    '<p style="font:16px system-ui;padding:32px">Opening preview…</p>';
                  void ensurePublicLink({ staffView: true }).then((link) => {
                    if (link) win.location.replace(link.staffViewUrl ?? link.url);
                    else win.close();
                  });
                }}
              >
                <Button className="w-full sm:w-auto" variant="secondary">
                  <ExternalLink className="h-4 w-4" />
                  {current.status === 'DRAFT' ? 'Preview Weblink' : 'Open Weblink'}
                </Button>
              </a>
            )}
            {current && (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="w-full sm:w-auto"
                      variant="secondary"
                      onClick={() => void openWhatsappSummary()}
                    >
                      <img
                        src="/whatsapp-logo-green.png"
                        alt=""
                        aria-hidden="true"
                        width={16}
                        height={16}
                        className="h-4 w-4 shrink-0 object-contain"
                      />
                      WhatsApp Message
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>WhatsApp Message</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
        {pdfError && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {pdfError}
          </p>
        )}
      </section>
      {current && (
        <section aria-label="Pricing Method" className="rounded-xl border bg-card p-5">
          {current.status === 'DRAFT' && hasPermission(PERMISSIONS.QUOTATIONS_UPDATE) ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3"
              onClick={() => setPricingMethodOpen((open) => !open)}
            >
              <div className="min-w-0 cursor-pointer">
                <h2 className="font-semibold">Pricing Method</h2>
                <p className="mt-1 text-sm text-slate-500">
                  How the final package price is calculated for this quotation.
                </p>
              </div>
              <button
                type="button"
                aria-expanded={pricingMethodOpen}
                aria-controls="pricing-method-body"
                aria-label={pricingMethodOpen ? 'Collapse pricing method' : 'Expand pricing method'}
                onClick={(event) => {
                  event.stopPropagation();
                  setPricingMethodOpen((open) => !open);
                }}
                className="shrink-0 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${pricingMethodOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold">Pricing Method</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {`Current method: ${pricingModeLabel(current.pricingMode)}. Finalized versions are read-only.`}
                </p>
              </div>
            </div>
          )}
          {current.status === 'DRAFT' &&
          hasPermission(PERMISSIONS.QUOTATIONS_UPDATE) &&
          pricingMethodOpen ? (
            <div id="pricing-method-body" className="mt-4">
              <PricingMethodSelector
                title={null}
                value={current.pricingMode}
                currency={current.currency || 'INR'}
                disabled={updateMeta.isPending}
                resolveGrandTotal={(mode) => {
                  try {
                    return resolveQuotationPricing({
                      version: {
                        ...(current as unknown as Record<string, unknown>),
                        pricingMode: mode,
                        finalAmount: 0,
                      },
                      quotation: q as unknown as Parameters<typeof resolveQuotationPricing>[0]['quotation'],
                    }).grandTotal;
                  } catch {
                    return null;
                  }
                }}
                onSelect={(mode) => {
                  setPricingMethodError('');
                  updateMeta.mutate(
                    { pricingMode: mode },
                    {
                      onError: (error) =>
                        setPricingMethodError(
                          error instanceof Error && error.message
                            ? error.message
                            : 'Unable to save the pricing method. Please try again.',
                        ),
                    },
                  );
                }}
              />
              {pricingMethodError && (
                <p role="alert" className="mt-2 text-sm text-red-700">
                  {pricingMethodError}
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Saved to this version immediately — the final amount updates automatically.
              </p>
            </div>
          ) : null}
        </section>
      )}

      <WeblinkVisitors quotationId={quotationId} />
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Activity timeline</h2>
        <div className="mt-3 space-y-3">
          {q.activityTimeline?.length ? (
            q.activityTimeline.map((entry) => (
              <article key={entry.id} className="border-l-2 border-brand-200 pl-3">
                <p className="text-sm font-medium">{labelForLookup(entry.action)}</p>
                <p className="text-xs text-slate-500">
                  {entry.actorUser?.fullName ?? 'Customer / system'} ·{' '}
                  {formatDateTime12Hour(entry.createdAt)}
                </p>
              </article>
            ))
          ) : (
            <p className="text-sm text-slate-500">No quotation activity recorded yet.</p>
          )}
        </div>
      </section>
      {pdfChoiceOpen && current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pdf-style-title"
            className="w-full max-w-2xl rounded-2xl bg-card p-6 shadow-xl"
          >
            <h2 id="pdf-style-title" className="text-xl font-semibold">
              Choose PDF style
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Select how this quotation should be presented.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                className="rounded-xl border p-5 text-left transition hover:border-brand-400 hover:bg-brand-50"
                onClick={() => {
                  setPdfChoiceOpen(false);
                  void generateIntoNewTab('CLASSIC');
                }}
              >
                <FileText className="h-7 w-7 text-brand-700" />
                <strong className="mt-4 block text-lg">Classic PDF</strong>
                <span className="mt-1 block text-sm text-slate-500">
                  The existing clean quotation PDF currently used by the CRM.
                </span>
              </button>
              <button
                type="button"
                className="rounded-xl border p-5 text-left transition hover:border-brand-400 hover:bg-brand-50"
                onClick={() => {
                  setPdfChoiceOpen(false);
                  void generateIntoNewTab('STYLISH');
                }}
              >
                <Sparkles className="h-7 w-7 text-amber-500" />
                <strong className="mt-4 block text-lg">Stylish PDF</strong>
                <span className="mt-1 block text-sm text-slate-500">
                  A photo-led navy and gold proposal inspired by the supplied design.
                </span>
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <Button variant="secondary" onClick={() => setPdfChoiceOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
      {sendOpen && current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg rounded-xl bg-card p-6 shadow-xl"
          >
            <h2 className="text-lg font-semibold">Send finalized quotation</h2>
            <p className="mt-1 text-sm text-slate-500">
              Version {current.versionNumber} · {money(current.finalAmount, current.currency)}
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium">
                Recipient email
                <input
                  aria-label="Recipient email"
                  className={`${field} mt-1`}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includePdf}
                  onChange={(event) => setIncludePdf(event.target.checked)}
                />
                Include secure PDF download
              </label>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includePublicLink}
                  onChange={(event) => setIncludePublicLink(event.target.checked)}
                />
                Include customer view link
              </label>
              {send.isError && <p className="text-sm text-red-700">{send.error.message}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSendOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!email}
                isLoading={send.isPending}
                onClick={() =>
                  send.mutate(
                    {
                      quotationVersionId: current.id,
                      recipientEmail: email,
                      cc: [],
                      subject: null,
                      message: null,
                      includePdf,
                      includePublicLink,
                    },
                    { onSuccess: () => setSendOpen(false) },
                  )
                }
              >
                Send quotation
              </Button>
            </div>
          </div>
        </div>
      )}
      {whatsappOpen && current && (
        <WhatsappSummaryDialog
          open={whatsappOpen}
          onClose={() => setWhatsappOpen(false)}
          quotation={q as unknown as Parameters<typeof buildWhatsAppSummary>[0]['quotation']}
          version={current as unknown as Parameters<typeof buildWhatsAppSummary>[0]['version']}
          weblinkUrl={publicLinkUrl}
          companyName={user?.company.name ?? 'Travel Agency CRM'}
          preparedByName={
            q.createdBy?.fullName ?? current.createdBy?.fullName ?? user?.fullName ?? null
          }
        />
      )}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-quotation-title"
            className="w-full max-w-lg rounded-xl bg-card p-6 shadow-xl"
          >
            <h2 id="delete-quotation-title" className="text-lg font-semibold text-red-700">
              Delete quotation permanently?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              This will permanently delete quotation <strong>{q.quotationNumber}</strong> and all its versions, documents and files from storage. This action cannot be undone.
            </p>
            <p className="mt-2 text-sm font-medium text-red-700">Deletion is permanent. This cannot be undone.</p>
            {deleteError && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {deleteError}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" disabled={deleteMutation.isPending} onClick={() => setDeleteConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                className="bg-red-600 text-white hover:bg-red-700"
                isLoading={deleteMutation.isPending}
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                <Trash2 className="h-4 w-4" />
                {deleteMutation.isPending ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

