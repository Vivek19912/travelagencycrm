import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowUpDown,
  Calendar,
  CalendarRange,
  ChartPie,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  Flame,
  Globe,
  Home,
  Loader2,
  Mail,
  MapPin,
  MoreVertical,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { InlineLeadField } from './InlineLeadField';
import {
  useDeleteLead,
  useLeadAnalytics,
  useLeadExport,
  useLeadLookups,
  useLeads,
  type Lead,
} from '@/features/queries/queries.api';
import { useQuotationWeblinkAnalytics } from '@/features/quotations/quotations.api';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { labelForLookup } from '@interscale/shared';
import type { LeadDateFilterType } from '@interscale/shared';
import { LeadServicesCell } from '@/features/queries/LeadServicesCell';
import { formatTravelMonthYear } from '@/features/quotations/travel-dates';
import { cn } from '@/utils/cn';
import { LeadImportModal } from './LeadImportModal';
import './leads.css';

/** Format a monetary value using the app's standard en-IN currency style. */
const formatCurrency = (value: string | number, currency: string) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(n);
  } catch {
    return String(n);
  }
};

/**
 * Quotation amount for the Amount column: the latest quotation's final amount.
 * Shown whenever a positive final amount exists, independent of the recorded
 * net cost (a quotation can carry a selling price with zero recorded cost).
 * Returns '' otherwise so the cell falls back to the lead's expected amount.
 */
const quotationAmountFor = (lead: Lead): string => {
  const summary = lead.quotationSummary;
  const amount = summary?.latestVersionAmount;
  const currency = summary?.currency ?? lead.currency;
  if (!summary || !amount) return '';
  if (Number(amount) <= 0) return '';
  return formatCurrency(amount, currency);
};

/**
 * Quotation margin for the Margin column: the latest quotation's stored
 * margin. A stored margin that merely echoes the final amount means no
 * margin was ever recorded — the pricing engine persists final-minus-zero
 * when no costs exist — so the cell keeps the empty-state dash instead of
 * presenting the amount as a margin. A genuinely recorded margin always
 * differs from the final amount (or the final amount is absent), and is
 * shown as stored. Returns '' when the cell should fall through to the
 * existing empty-state behavior.
 */
const quotationMarginFor = (lead: Lead): string => {
  const summary = lead.quotationSummary;
  const margin = summary?.marginAmount;
  const currency = summary?.currency ?? lead.currency;
  if (!summary || margin === null || margin === undefined || margin === '') return '';
  const final = summary?.latestVersionAmount;
  if (
    final !== null &&
    final !== undefined &&
    final !== '' &&
    Number(margin) === Number(final)
  )
    return '';
  const formatted = formatCurrency(margin, currency);
  return formatted === '' ? '' : formatted;
};

const leadDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(
        new Date(value),
      )
    : null;

/** Keep the stored query number intact while hiding its year in the lead list. */
const leadListId = (value: string) => value.replace(/^([^-]+)-\d{4}-/, '$1-');

// The Booking column is temporarily hidden from the Leads table. Set this back
// to true to restore it; booking data, hooks and BookingCell are untouched.
const SHOW_BOOKING_COLUMN_IN_LEADS_TABLE = false;

/** Local calendar-day string (YYYY-MM-DD) for a Date, avoiding UTC drift. */
function localDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Compact "01 Aug 2026" style label for the active date-filter summary. */
function formatDateSummary(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

const LEAD_DATE_TYPE_LABELS: Record<LeadDateFilterType, string> = {
  CREATED_DATE: 'Created Date',
  TRAVEL_DATE: 'Travel Date',
};

/** Quick date-range presets (today / yesterday / last 7 days / this month). */
const LEAD_DATE_PRESETS: Array<{ label: string; from: () => string; to: () => string }> = [
  { label: 'Today', from: () => localDateInput(new Date()), to: () => localDateInput(new Date()) },
  {
    label: 'Yesterday',
    from: () => localDateInput(new Date(Date.now() - 86_400_000)),
    to: () => localDateInput(new Date(Date.now() - 86_400_000)),
  },
  {
    label: 'Last 7 Days',
    from: () => localDateInput(new Date(Date.now() - 6 * 86_400_000)),
    to: () => localDateInput(new Date()),
  },
  {
    label: 'This Month',
    from: () => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    },
    to: () => localDateInput(new Date()),
  },
];

function LeadInfoCell({ lead }: { lead: Lead }) {
  const email = lead.email ?? lead.customer?.email;
  return (
    <div className="min-w-44">
      <Link className="leads-name block" to={`/queries/${lead.id}`}>
        {lead.customerName}
      </Link>
      <span className="leads-meta">
        <Phone className="h-3 w-3 shrink-0" aria-hidden="true" /> {lead.phone}
      </span>
      {email && (
        <span className="leads-meta text-brand-600">
          <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate" title={email}>
            {email}
          </span>
        </span>
      )}
    </div>
  );
}

function DestinationCell({ lead }: { lead: Lead }) {
  const totalNights = lead.itinerary.reduce((sum, item) => sum + item.nights, 0);
  if (!lead.itinerary.length) return <span className="leads-cell-muted">—</span>;
  return (
    <div className="leads-dest-wrap">
      <span className="leads-nights-badge">{totalNights}N Total</span>
      {lead.itinerary.map((item) => (
        <div key={item.id} className="leads-dest-card">
          <p className="leads-dest-name">{item.destination}</p>
          <p className="leads-dest-nights">{item.nights}N</p>
          {item.country && <p className="leads-dest-country">{item.country}</p>}
        </div>
      ))}
    </div>
  );
}

function displayTravellerSummary(summary: string | null | undefined): string {
  if (!summary) return '';
  return summary
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^\d+\s*Room/i.test(part))
    .join(', ');
}

function TravellersInfoCell({ lead }: { lead: Lead }) {
  // No departure city (null/undefined/empty/whitespace): render no city badge
  // at all rather than an "N/A" placeholder. Dates and counts are untouched.
  const departureCity = lead.departureCity?.trim() ? lead.departureCity : '';
  return (
    <div className="leads-traveller">
      {departureCity && (
        <span className="leads-traveller-block leads-traveller-block--city">
          <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" /> {departureCity}
        </span>
      )}
        <span className="leads-traveller-block leads-traveller-block--date">
          <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
          {[
            leadDate(lead.travelStartDate),
            formatTravelMonthYear(lead.travelMonth, lead.travelYear),
          ]
            .filter(Boolean)
            .join(' • ') || 'Flexible dates'}
        </span>
      <span className="leads-traveller-block leads-traveller-block--rooms">
        {displayTravellerSummary(lead.travellerSummary) || 'No traveller details'}
      </span>
    </div>
  );
}

function QuotationCell({ lead }: { lead: Lead }) {
  const summary = lead.quotationSummary;
  if (lead.quotationSummary === undefined) return <span className="leads-cell-muted">—</span>;
  if (!summary)
    return lead.actions?.canCreateQuotation ? (
      <Link
        className="leads-quote-view"
        to={`/queries/${lead.id}/quotations/new`}
        title={`Create quotation for ${lead.queryNumber}`}
      >
        + New
      </Link>
    ) : (
      <span className="text-xs text-slate-400">None</span>
    );
  // The Quotation column is a compact action column only: status and amount are
  // not shown here (amount/margin live in the dedicated Amount/Margin columns).
  return (
    <Link
      className="leads-quote-view"
      to={`/quotations/${summary.quotationId}`}
      title={`View quotation for ${lead.queryNumber}`}
    >
      <Eye className="h-3 w-3" aria-hidden="true" /> View
    </Link>
  );
}

function BookingCell({ lead, canCreateBooking }: { lead: Lead; canCreateBooking: boolean }) {
  const summary = lead.bookingSummary;
  if (lead.bookingSummary === undefined) return <span className="leads-cell-muted">—</span>;
  if (!summary) {
    // Hot + a finalized quotation + no booking → offer the lead-based booking
    // flow. Booking creation confirms the lead itself, so no particular stage
    // is required; terminal leads are excluded. The backend re-validates.
    const quotationId = lead.quotationSummary?.quotationId;
    if (
      canCreateBooking &&
      lead.leadType === 'HOT' &&
      !['LOST', 'CANCELLED', 'INVALID'].includes(lead.leadStage) &&
      quotationId
    ) {
      return (
        <Link
          aria-label={`Create booking for ${lead.queryNumber}`}
          title="Create booking for this lead"
          className="leads-booking-create"
          to={`/bookings/new?leadId=${encodeURIComponent(lead.id)}&quotationId=${encodeURIComponent(quotationId)}`}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Create Booking
        </Link>
      );
    }
    return (
      <span className="leads-cell-muted">{lead.quotationRequired ? 'Quote Required' : 'None'}</span>
    );
  }
  return (
    <div className="leads-booking">
      <Link className="leads-booking-link" to={`/bookings/${summary.bookingId}`}>
        {summary.bookingNumber}
      </Link>
      <p className="leads-booking-status">{labelForLookup(summary.bookingStatus)}</p>
    </div>
  );
}

/**
 * Lead row actions. Strictly limited to View, Edit and Delete so
 * the Action column never grows additional quotation/booking shortcuts.
 * Quotation creation and booking conversion remain available through the
 * dedicated Quotation and Booking columns and the lead details page.
 * Follow-up is a dead feature: its action is hidden from this column
 * (backend, APIs and data are untouched).
 */
function LeadActionsCell({
  lead,
  canEdit,
  canDelete,
}: {
  lead: Lead;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const remove = useDeleteLead(lead.id);
  return (
    <div className="leads-actions">
      <Link
        aria-label="View lead"
        title="View lead"
        className="leads-action-btn leads-action-btn--teal"
        to={`/queries/${lead.id}`}
      >
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
      {canEdit && (
        <Link
          aria-label="Edit lead"
          title="Edit lead"
          className="leads-action-btn leads-action-btn--blue"
          to={`/queries/${lead.id}/edit`}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
      {canDelete && (
        <Button
          variant="danger"
          size="sm"
          aria-label="Delete lead"
          title="Permanently delete lead"
          className="leads-action-btn h-7 px-1 text-xs"
          isLoading={remove.isPending}
          onClick={() => {
            if (
              window.confirm(
                `Permanently delete lead ${lead.queryNumber}? This cannot be undone.`,
              )
            ) {
              remove.mutate();
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/** Local per-row override for weblink state (analytics count sync only). */
type WeblinkOverride = Partial<{ externalViews: number }>;

const weblinkDate = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
};

/**
 * Weblink column action group. A quotation's public link is provisioned
 * automatically by the backend, so there is no manual Create state — a lead
 * either has no displayed quotation (Not Available) or a usable weblink
 * (joined green VIEW + yellow eye/count). A corrupt row without a URL falls
 * back to a muted Unavailable label rather than offering Create.
 */
function WeblinkCell({
  lead,
  override,
  onOpenAnalytics,
}: {
  lead: Lead;
  override: WeblinkOverride | null | undefined;
  onOpenAnalytics: (leadId: string, quotationId: string) => void;
}) {
  const quotationId = lead.weblink?.quotationId ?? lead.quotationSummary?.quotationId ?? '';
  // Merge the server summary with any local override (analytics count sync).
  const weblink = override
    ? { ...lead.weblink, externalViews: override.externalViews ?? lead.weblink?.externalViews ?? 0 }
    : (lead.weblink ?? null);

  if (!quotationId) return <span className="leads-cell-muted">Not Available</span>;

  // Defensive fallback for genuinely corrupt data: never offer a Create action.
  if (!weblink?.publicUrl) return <span className="leads-cell-muted">Unavailable</span>;

  return (
    <div className="leads-weblink">
      <a
        href={weblink.publicUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`View quotation weblink for ${lead.queryNumber}`}
        className="leads-weblink-view"
      >
        <ExternalLink className="h-3 w-3" aria-hidden="true" /> View
      </a>
      <button
        type="button"
        onClick={() => onOpenAnalytics(lead.id, quotationId)}
        aria-label={`Weblink view analytics for ${lead.queryNumber}`}
        title="Weblink view analytics"
        className="leads-weblink-count"
      >
        <Eye className="h-3 w-3" aria-hidden="true" /> {weblink.externalViews}
      </button>
    </div>
  );
}

function LeadNotesCell({ lead }: { lead: Lead }) {
  return (
    <div className="leads-notes">
      <Link
        aria-label={`Add note for ${lead.queryNumber}`}
        title="Add note"
        to={`/queries/${lead.id}/notes/new`}
        className="leads-icon-btn leads-icon-btn--cyan"
      >
        ＋
      </Link>
      <Link
        aria-label={`View notes for ${lead.queryNumber}`}
        title="View notes"
        to={`/queries/${lead.id}/notes`}
        className="leads-icon-btn leads-icon-btn--cyan"
      >
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

/** Large teal-header modal with summary cards + aggregated IP rows. */
function WeblinkAnalyticsModal({
  quotationId,
  onClose,
  onCount,
}: {
  quotationId: string;
  onClose: () => void;
  onCount: (external: number) => void;
}) {
  const analytics = useQuotationWeblinkAnalytics(quotationId);
  const data = analytics.data;

  useEffect(() => {
    if (data && typeof data.externalViews === 'number') onCount(data.externalViews);
  }, [data, onCount]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const summary = [
    { label: 'Total Views', value: data?.totalViews ?? 0, cls: 'border-blue-200 text-blue-700' },
    {
      label: 'External Views',
      value: data?.externalViews ?? 0,
      cls: 'border-emerald-200 text-emerald-700',
    },
    {
      label: 'Home IP Views',
      value: data?.homeIpViews ?? 0,
      cls: 'border-amber-300 text-amber-700',
    },
    { label: 'Unique IPs', value: data?.uniqueIps ?? 0, cls: 'border-teal-200 text-teal-700' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Weblink View Analytics"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-card shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Teal header */}
        <div className="flex items-center justify-between rounded-t-xl bg-teal-600 px-5 py-3 text-white">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ChartPie className="h-5 w-5" /> Weblink View Analytics
          </h2>
          <button
            aria-label="Close analytics"
            onClick={onClose}
            className="rounded p-1 hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {analytics.isLoading && (
            <div className="flex h-48 items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading analytics…
            </div>
          )}

          {analytics.isError && (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
              <p>Could not load weblink analytics.</p>
              <Button variant="secondary" size="sm" onClick={() => analytics.refetch()}>
                Retry
              </Button>
            </div>
          )}

          {data && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {summary.map((card) => (
                  <div
                    key={card.label}
                    className={`rounded-lg border bg-card p-4 text-center shadow-sm ${card.cls}`}
                  >
                    <p className="text-3xl font-bold">{card.value}</p>
                    <p className="mt-1 text-xs font-medium uppercase tracking-wide">{card.label}</p>
                  </div>
                ))}
              </div>

              {/* Rows table */}
              {data.entries.length === 0 ? (
                <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                  No weblink views have been recorded yet.
                </p>
              ) : (
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2">IP Address</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Views</th>
                        <th className="px-3 py-2">First Viewed</th>
                        <th className="px-3 py-2">Last Viewed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.entries.map((row) => (
                        <tr key={row.ipAddress} className="border-b border-slate-100">
                          <td className="px-3 py-2 font-medium text-slate-800">{row.ipAddress}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold ${
                                row.type === 'HOME'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {row.type === 'HOME' ? (
                                <Home className="h-3 w-3" />
                              ) : (
                                <Globe className="h-3 w-3" />
                              )}
                              {row.type === 'HOME' ? 'HOME IP' : 'EXTERNAL'}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="rounded bg-blue-100 px-2 py-0.5 font-semibold text-blue-800">
                              {row.views}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {weblinkDate(row.firstViewedAt)}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {weblinkDate(row.lastViewedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Footer note */}
              <div className="mt-6 flex flex-wrap items-center gap-4 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Home className="h-3.5 w-3.5 text-amber-600" /> HOME IP = Views from your company
                  team members.
                </span>
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Globe className="h-3.5 w-3.5 text-emerald-600" /> EXTERNAL = Views from actual
                  clients.
                </span>
              </div>
            </>
          )}

          <div className="mt-6 flex justify-end">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact dense filter chips with semantic colours per type/stage. */
function leadChipVariant(value: string): string {
  if (value === '') return 'leads-chip--all';
  if (value === 'HOT' || value === 'URGENT') return 'leads-chip--hot';
  if (value === 'WARM') return 'leads-chip--warm';
  if (value === 'COLD') return 'leads-chip--cold';
  if (value === 'FRESH' || value === 'NEW_LEAD' || value === 'QUALIFIED')
    return 'leads-chip--fresh';
  if (value === 'QUOTATION_SENT' || value === 'IN_NEGOTIATION') return 'leads-chip--quote';
  if (value === 'READY_TO_BOOK') return 'leads-chip--ready';
  if (value === 'BOOKING_CONFIRMED') return 'leads-chip--confirmed';
  if (value === 'LOST') return 'leads-chip--lost';
  if (value === 'CANCELLED' || value === 'INVALID') return 'leads-chip--muted';
  if (value === 'ON_HOLD' || value === 'NOT_CONNECTED') return 'leads-chip--hold';
  return 'leads-chip--neutral';
}

export function LeadsPage() {
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const leads = useLeads(params);
  const analytics = useLeadAnalytics(params);
  const { data: lookups } = useLeadLookups();
  const exportLeads = useLeadExport();

  const canUpdate = hasPermission('queries.update');
  const canDelete = hasPermission('queries.delete');
  const canExport = hasPermission('queries.export');
  const canCreateBooking = hasPermission('bookings.create');

  const [importOpen, setImportOpen] = useState(false);
  // Per-row weblink overrides (create success + analytics count sync) keyed by
  // lead id, so the column updates immediately without a full page refresh.
  const [weblinkState, setWeblinkState] = useState<Record<string, WeblinkOverride>>({});
  const [analyticsFor, setAnalyticsFor] = useState<{ leadId: string; quotationId: string } | null>(
    null,
  );
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  const syncWeblinkCount = useCallback((leadId: string, external: number) => {
    setWeblinkState((prev) => {
      const current = prev[leadId];
      if (current && current.externalViews === external) return prev;
      return { ...prev, [leadId]: { ...current, externalViews: external } };
    });
  }, []);

  // A change in filters or page invalidates transient UI.
  const paramsKey = params.toString();
  useEffect(() => {
    setAnalyticsFor(null);
    setMoreMenuOpen(false);
  }, [paramsKey]);

  // Close the header More menu on outside click / Escape.
  useEffect(() => {
    if (!moreMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreMenuOpen]);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    setParams(next);
  };
  const page = Number(params.get('page') ?? 1);

  // When the requested page no longer exists (e.g. a row was deleted on the
  // final page), move the URL back to the last valid page so the footer never
  // shows an impossible range like "Showing 21 to 20 of 20 entries".
  useEffect(() => {
    const totalPages = leads.data?.pagination.totalPages;
    if (totalPages === undefined || totalPages <= 0) return;
    if (page > totalPages && page > 1) {
      setParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set('page', String(totalPages));
        return next;
      });
    }
  }, [page, leads.data, setParams]);
  const sort = (sortBy: string) => {
    const next = new URLSearchParams(params);
    const sameColumn = next.get('sortBy') === sortBy;
    next.set('sortBy', sortBy);
    next.set('sortOrder', sameColumn && next.get('sortOrder') === 'asc' ? 'desc' : 'asc');
    next.set('page', '1');
    setParams(next);
  };

  // ----------------------------- date filter -------------------------------
  // Draft state is committed to the URL only via Apply, so typing a partial
  // date never triggers a request. URL changes (refresh / back / clear) sync
  // the draft back.
  const [dateDraft, setDateDraft] = useState<{
    dateType: LeadDateFilterType;
    dateFrom: string;
    dateTo: string;
  }>({
    dateType: (params.get('dateType') as LeadDateFilterType) ?? 'CREATED_DATE',
    dateFrom: params.get('dateFrom') ?? '',
    dateTo: params.get('dateTo') ?? '',
  });
  const [dateError, setDateError] = useState<string | null>(null);

  const dateParamKey = useMemo(
    () =>
      `${params.get('dateType') ?? ''}|${params.get('dateFrom') ?? ''}|${params.get('dateTo') ?? ''}`,
    [params],
  );
  useEffect(() => {
    setDateDraft({
      dateType: (params.get('dateType') as LeadDateFilterType) ?? 'CREATED_DATE',
      dateFrom: params.get('dateFrom') ?? '',
      dateTo: params.get('dateTo') ?? '',
    });
    setDateError(null);
  }, [dateParamKey, params]);

  const activeDateFilter = (params.get('dateType') as LeadDateFilterType | null) ?? 'CREATED_DATE';
  const dateFrom = params.get('dateFrom') ?? '';
  const dateTo = params.get('dateTo') ?? '';
  const dateFilterActive = Boolean(dateFrom || dateTo);

  const applyDateFilter = () => {
    const { dateType: type, dateFrom: from, dateTo: to } = dateDraft;
    if (from && to && from > to) {
      setDateError('From Date cannot be after To Date.');
      return;
    }
    setDateError(null);
    const next = new URLSearchParams(params);
    next.set('dateType', type);
    if (from) next.set('dateFrom', from);
    else next.delete('dateFrom');
    if (to) next.set('dateTo', to);
    else next.delete('dateTo');
    next.set('page', '1');
    setParams(next);
  };

  const clearDateFilter = () => {
    const next = new URLSearchParams(params);
    next.delete('dateType');
    next.delete('dateFrom');
    next.delete('dateTo');
    next.set('page', '1');
    setParams(next);
  };

  const applyDatePreset = (from: string, to: string) => {
    const next = new URLSearchParams(params);
    next.set('dateType', dateDraft.dateType);
    if (from) next.set('dateFrom', from);
    else next.delete('dateFrom');
    if (to) next.set('dateTo', to);
    else next.delete('dateTo');
    next.set('page', '1');
    setParams(next);
  };

  const rows = useMemo(() => leads.data?.data ?? [], [leads.data]);

  const chips = analytics.data
    ? [
        ['All', '', analytics.data.totalLeads],
        ...['FRESH', 'HOT', 'WARM', 'COLD'].map(
          (x) => [labelForLookup(x), x, analytics.data!.byLeadType[x] ?? 0] as const,
        ),
        ...[
          'NEW_LEAD',
          'QUOTATION_SENT',
          'IN_NEGOTIATION',
          'READY_TO_BOOK',
          'BOOKING_CONFIRMED',
          'LOST',
          'CANCELLED',
          'INVALID',
          'ON_HOLD',
        ].map((x) => [labelForLookup(x), x, analytics.data!.byLeadStage[x] ?? 0] as const),
      ]
    : [];

  const headers: Array<[string, string?]> = [
    ['Lead ID', 'queryNumber'],
    ['Lead Info', 'customerName'],
    ['Destination'],
    ['Travellers Info'],
    ['Services'],
    ['Quotation'],
    ...(SHOW_BOOKING_COLUMN_IN_LEADS_TABLE ? ([['Booking']] as Array<[string, string?]>) : []),
    ['Weblink'],
    ['Notes'],
    ['Assigned to'],
    ['Amount'],
    ['Margin'],
    ['Type', 'leadType'],
    ['Stage', 'leadStage'],
    ['Created', 'createdAt'],
    ['Actions'],
  ];

  const canCreate = hasPermission('queries.create');
  const showMoreMenu = canExport || canCreate;

  const handleMoreMenuKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const menu = moreMenuRef.current?.querySelector('[role="menu"]');
      const items = menu
        ? Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
        : [];
      if (!items.length) return;
      const active = document.activeElement as HTMLElement | null;
      const index = items.findIndex((item) => item === active);
      const next =
        event.key === 'ArrowDown'
          ? items[(index + 1) % items.length]
          : items[(index - 1 + items.length) % items.length];
      next?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const menu = moreMenuRef.current?.querySelector('[role="menu"]');
      const items = menu
        ? Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
        : [];
      if (!items.length) return;
      (event.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
    }
  };

  return (
    <div className="leads-page">
      <div className="flex items-center gap-3">
        <h1 className="leads-page-title">Leads</h1>
        <div className="ml-auto flex items-center gap-2">
          {canCreate && (
            <Link aria-label="Add Lead" to="/queries/new">
              <Button size="sm">
                <Plus className="h-4 w-4" /> Create
              </Button>
            </Link>
          )}
          {showMoreMenu && (
            <div className="leads-more-wrap" ref={moreMenuRef}>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="More actions"
                  aria-haspopup="menu"
                  aria-expanded={moreMenuOpen}
                  aria-controls="leads-more-menu"
                  className="leads-more-btn"
                  onClick={() => setMoreMenuOpen((open) => !open)}
                  onKeyDown={handleMoreMenuKeyDown}
                >
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
                {moreMenuOpen && (
                  <div
                    id="leads-more-menu"
                    role="menu"
                    aria-label="More lead actions"
                    className="leads-more-menu"
                    onKeyDown={handleMoreMenuKeyDown}
                  >
                    {canCreate && (
                      <button
                        type="button"
                        role="menuitem"
                        className="leads-more-item"
                        onClick={() => {
                          setMoreMenuOpen(false);
                          setImportOpen(true);
                        }}
                      >
                        <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Import Leads
                      </button>
                    )}
                    {canExport && (
                      <button
                        type="button"
                        role="menuitem"
                        className="leads-more-item"
                        disabled={exportLeads.isPending}
                        onClick={() => {
                          setMoreMenuOpen(false);
                          exportLeads.mutate(params);
                        }}
                      >
                        {exportLeads.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Download className="h-4 w-4" aria-hidden="true" />
                        )}{' '}
                        {exportLeads.isPending ? 'Exporting leads…' : 'Export Leads'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
        </div>
      </div>

      <section className="leads-card">
        <div className="leads-toolbar">
          <label className="leads-search">
            <Search className="leads-search-icon h-4 w-4" aria-hidden="true" />
            <input
              aria-label="Search leads"
              placeholder="Search lead ID, customer, phone or destination"
              value={params.get('search') ?? ''}
              onChange={(e) => set('search', e.target.value)}
            />
          </label>
          <select
            aria-label="Assigned user"
            className="leads-select"
            style={{ minWidth: 220 }}
            value={params.get('assignedToId') ?? ''}
            onChange={(e) => set('assignedToId', e.target.value)}
          >
            <option value="">All assignees</option>
            {lookups?.assignableUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </select>
          <div className="leads-date-filter" role="group" aria-label="Date filter">
            <label className="leads-date-field">
              <span className="sr-only">Date type</span>
              <select
                aria-label="Date type"
                className="leads-date-type"
                value={dateDraft.dateType}
                onChange={(e) =>
                  setDateDraft((prev) => ({
                    ...prev,
                    dateType: e.target.value as LeadDateFilterType,
                  }))
                }
              >
                {(Object.keys(LEAD_DATE_TYPE_LABELS) as LeadDateFilterType[]).map((type) => (
                  <option key={type} value={type}>
                    {LEAD_DATE_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="leads-date-field">
              <CalendarRange className="leads-date-icon" aria-hidden="true" />
              <span className="sr-only">From date</span>
              <input
                aria-label="From date"
                aria-invalid={dateError ? true : undefined}
                aria-describedby={dateError ? 'leads-date-range-error' : undefined}
                type="date"
                className="leads-date-input"
                value={dateDraft.dateFrom}
                onChange={(e) => setDateDraft((prev) => ({ ...prev, dateFrom: e.target.value }))}
              />
            </label>
            <label className="leads-date-field">
              <Calendar className="leads-date-icon" aria-hidden="true" />
              <span className="sr-only">To date</span>
              <input
                aria-label="To date"
                aria-invalid={dateError ? true : undefined}
                aria-describedby={dateError ? 'leads-date-range-error' : undefined}
                type="date"
                className="leads-date-input"
                value={dateDraft.dateTo}
                onChange={(e) => setDateDraft((prev) => ({ ...prev, dateTo: e.target.value }))}
              />
            </label>
            <Button
              size="sm"
              aria-label="Apply date filter"
              className="leads-date-apply"
              onClick={applyDateFilter}
            >
              Apply
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-label="Clear date filter"
              className="leads-date-clear"
              disabled={!dateFilterActive}
              onClick={clearDateFilter}
            >
              Clear
            </Button>
            {dateError && (
              <p id="leads-date-range-error" role="alert" className="leads-date-error">
                {dateError}
              </p>
            )}
            <span className="leads-date-presets" aria-label="Date range presets">
              {LEAD_DATE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="leads-date-preset"
                  onClick={() => applyDatePreset(preset.from(), preset.to())}
                >
                  {preset.label}
                </button>
              ))}
            </span>
            {dateFilterActive && (
              <span className="leads-date-summary" aria-label="Active date filter">
                <CalendarRange className="h-3 w-3" aria-hidden="true" />
                {LEAD_DATE_TYPE_LABELS[activeDateFilter]}:{' '}
                {dateFrom ? `From ${formatDateSummary(dateFrom)}` : ''}
                {dateFrom && dateTo ? ' – ' : ''}
                {dateTo ? `Up to ${formatDateSummary(dateTo)}` : ''}
                <button
                  type="button"
                  aria-label="Remove date filter"
                  className="leads-date-remove"
                  onClick={clearDateFilter}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            )}
          </div>
          <label className="leads-hot">
            <Flame className="h-4 w-4" aria-hidden="true" />
            <input
              type="checkbox"
              aria-label="Hot leads only"
              checked={params.get('leadType') === 'HOT'}
              onChange={(event) => set('leadType', event.target.checked ? 'HOT' : '')}
            />
            Hot
          </label>
          {[
            ['leadType', 'All lead types', lookups?.leadTypes],
            ['leadStage', 'All lead stages', lookups?.leadStages],
            ['leadSource', 'All lead sources', lookups?.leadSources],
            ['priority', 'All priorities', lookups?.priorities],
            ['serviceType', 'All services', lookups?.serviceTypes],
          ].map(([key, label, options]) => (
            <select
              key={String(key)}
              aria-label={String(label)}
              className="hidden rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={params.get(String(key)) ?? ''}
              onChange={(e) => set(String(key), e.target.value)}
            >
              <option value="">{String(label)}</option>
              {(options as Array<{ value: string; label: string }> | undefined)?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ))}
          <input
            aria-label="Destination"
            className="hidden rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Destination"
            value={params.get('destination') ?? ''}
            onChange={(e) => set('destination', e.target.value)}
          />
          <select
            aria-label="Quotation required"
            className="hidden rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={params.get('quotationRequired') ?? ''}
            onChange={(e) => set('quotationRequired', e.target.value)}
          >
            <option value="">Any quotation need</option>
            <option value="true">Quotation required</option>
            <option value="false">Not required</option>
          </select>
          {(
            [
              ['travelFrom', 'Travel from'],
              ['travelTo', 'Travel to'],
              ['createdFrom', 'Created from'],
              ['createdTo', 'Created to'],
            ] as Array<[string, string]>
          ).map(([key, label]) => (
            <label key={key} className="hidden space-y-1 text-xs font-medium text-slate-500">
              {label}
              <input
                aria-label={label}
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                type="date"
                value={params.get(key) ?? ''}
                onChange={(e) => set(key, e.target.value)}
              />
            </label>
          ))}
          <button
            className="hidden text-left text-sm font-medium text-brand-700"
            onClick={() => setParams({})}
          >
            Clear filters
          </button>
        </div>

        <div
          className="leads-filter-panel"
          role="group"
          aria-label="Filter leads by type and stage"
        >
          {chips.map(([label, value, count]) => {
            const activeKey =
              value && ['FRESH', 'HOT', 'WARM', 'COLD'].includes(String(value))
                ? 'leadType'
                : 'leadStage';
            const active =
              (value && params.get(activeKey) === value) ||
              (!value && !params.get('leadType') && !params.get('leadStage'));
            return (
              <button
                key={`${label}-${value}`}
                className={cn(
                  'leads-chip',
                  leadChipVariant(String(value)),
                  active && 'leads-chip--active',
                )}
                aria-pressed={active}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete('leadType');
                  next.delete('leadStage');
                  if (value)
                    next.set(
                      ['FRESH', 'HOT', 'WARM', 'COLD'].includes(String(value))
                        ? 'leadType'
                        : 'leadStage',
                      String(value),
                    );
                  next.set('page', '1');
                  setParams(next);
                }}
              >
                {label} <strong>{count}</strong>
              </button>
            );
          })}
        </div>

        {leads.isLoading ? (
          <div className="space-y-3 p-5" aria-label="Loading leads">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="leads-skeleton-row" />
            ))}
          </div>
        ) : leads.isError ? (
          <div className="p-10 text-center text-red-700">
            <p>Leads could not be loaded.</p>
            <Button className="mt-3" variant="secondary" onClick={() => void leads.refetch()}>
              Try again
            </Button>
          </div>
        ) : !rows.length ? (
          <div className="p-12 text-center">
            <UsersRound className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-3 font-medium">No leads found</h2>
            <p className="text-sm text-slate-500">Adjust the filters or create your first lead.</p>
          </div>
        ) : (
          <>
            <div className="leads-table-scroll">
              <table className="leads-table">
                <thead className="leads-thead">
                  <tr>
                    {headers.map(([label, sortBy]) => (
                      <th key={label}>
                        {sortBy ? (
                          <button
                            className="leads-sort"
                            aria-label={`Sort by ${label}`}
                            onClick={() => sort(sortBy)}
                          >
                            {label}
                            <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                          </button>
                        ) : (
                          label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="leads-tbody">
                  {rows.map((lead) => (
                    <tr key={lead.id}>
                      <td className="leads-id">
                        <Link className="leads-link" to={`/queries/${lead.id}`}>
                          {leadListId(lead.queryNumber)}
                        </Link>
                      </td>
                      <td>
                        <LeadInfoCell lead={lead} />
                      </td>
                      <td>
                        <DestinationCell lead={lead} />
                      </td>
                      <td>
                        <TravellersInfoCell lead={lead} />
                      </td>
                      <td>
                        <LeadServicesCell lead={lead} />
                      </td>
                      <td>
                        <QuotationCell lead={lead} />
                      </td>
                      {SHOW_BOOKING_COLUMN_IN_LEADS_TABLE && (
                        <td>
                          <BookingCell lead={lead} canCreateBooking={canCreateBooking} />
                        </td>
                      )}
                      <td className="text-center">
                        <WeblinkCell
                          lead={lead}
                          override={weblinkState[lead.id]}
                          onOpenAnalytics={(leadId, quotationId) =>
                            setAnalyticsFor({ leadId, quotationId })
                          }
                        />
                      </td>
                      <td>
                        <LeadNotesCell lead={lead} />
                      </td>
                      <td>
                        <span className="leads-assigned">
                          {lead.assignedTo?.fullName ?? 'Unassigned'}
                        </span>
                      </td>
                      <td
                        className={cn(
                          'leads-amount',
                          !quotationAmountFor(lead) &&
                            !lead.expectedAmount &&
                            'leads-amount--empty',
                        )}
                      >
                        {quotationAmountFor(lead) ||
                          (lead.expectedAmount ? `${lead.currency} ${lead.expectedAmount}` : '—')}
                      </td>
                      <td
                        className={cn(
                          'leads-amount',
                          !quotationMarginFor(lead) &&
                            !lead.expectedMargin &&
                            'leads-amount--empty',
                        )}
                      >
                        {quotationMarginFor(lead) ||
                          (lead.expectedMargin ? `${lead.currency} ${lead.expectedMargin}` : '—')}
                      </td>
                      <td>
                        <InlineLeadField
                          lead={lead}
                          field="leadType"
                          options={lookups?.leadTypes ?? []}
                          canEdit={canUpdate}
                        />
                      </td>
                      <td>
                        <InlineLeadField
                          lead={lead}
                          field="leadStage"
                          options={lookups?.leadStages ?? []}
                          canEdit={canUpdate}
                        />
                      </td>
                      <td>
                        <span className="leads-created">{leadDate(lead.createdAt)}</span>
                      </td>
                      <td>
                        <LeadActionsCell lead={lead} canEdit={canUpdate} canDelete={canDelete} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {leads.data && (
          <Pagination
            page={page}
            pageSize={leads.data.pagination.pageSize}
            totalPages={leads.data.pagination.totalPages}
            total={leads.data.pagination.total}
            onPage={(nextPage) => set('page', String(nextPage))}
          />
        )}
      </section>

      {analyticsFor && (
        <WeblinkAnalyticsModal
          quotationId={analyticsFor.quotationId}
          onClose={() => setAnalyticsFor(null)}
          onCount={(total) => syncWeblinkCount(analyticsFor.leadId, total)}
        />
      )}
      {importOpen && <LeadImportModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}
