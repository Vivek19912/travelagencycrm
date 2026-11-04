import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import {
  Baby,
  Ban,
  Building2,
  CalendarDays,
  Car,
  CarFront,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  CreditCard,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Info as InfoIcon,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Ship,
  Star,
  Tag,
  Utensils,
  XCircle,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import {
  formatDayPrefixedTitle,
  formatItineraryDayTitle,
  formatAgeList,
  formatInfantAgeList,
  hotelStayNights,
  isItineraryActivityTitleDuplicate,
  isPublicTaxNote,
  orderPricingRows,
  resolveCruiseRoomLines,
  resolveHotelMealPlanLines,
  resolveHotelRoomLines,
  resolveItineraryActivityImage,
  resolveItineraryDayImage,
  resolveQuotationPricing,
  resolveWeblinkSectionOrder,
  normalizeFaqs,
  getFlightPerTravelerBreakdown,
  TRAVELER_BREAKDOWN_LABELS as SHARED_TRAVELER_BREAKDOWN_LABELS,
  WEBLINK_PROFILE_FIELD_IDS,
  WEBLINK_PROFILE_FIELD_LABELS,
  WEBLINK_PROFILE_PREPARED_BY_LABEL,
  type QuotationPricing,
  type WeblinkProfileConfig,
  type WeblinkProfileFieldId,
} from '@interscale/shared';
import { useFavicon } from '@/hooks/useFavicon';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import './weblink-pdf.css';
import { formatTime12Hour } from '@/utils/dateTime';
import { decodeHtmlEntities } from '@/utils/richTextPaste';
import { buildQuotationDescription, normalizeWhatsAppPhone } from './quotationContact';
import type {
  QuotationVersion,
  SightseeingDay,
} from '@/features/quotations/quotations.api';
import {
  SectionTitle,
  RichHtml,
  dateShort,
  sanitizeHtml,
  FlightJourneyView,
  FlightImageViewer,
  buildFlightLegs,
  flightSegmentHasData,
} from './FlightPublicView';
import { PublicQuotationContact } from './PublicQuotationContact';
import { PublicQuotationFooter } from './PublicQuotationFooter';
import { BackToTop } from './BackToTop';
import { QuotationLightbox } from './QuotationLightbox';
import { activeScrollSpyId, prefersReducedMotion } from './scroll';
import { serviceCardIcon, type ServiceCard } from './serviceCards';
import { formatPublicQuotationNumber } from './quotationContact';
import { hotelPresentationKey } from './PreviewPresentations';
import {
  formatAddonOptionPrice,
  normalizeAddonPricingSnapshot,
} from '@/features/quotations/addonPricing';

export interface PublicQuotation {
  company: {
    name: string;
    email: string;
    phone: string | null;
    website: string | null;
    address: string | null;
    googleMapsUrl?: string | null;
    primaryColor: string;
    operatingSince?: number | null;
    tripsSold?: number | null;
    tan?: string | null;
    taxRegistrationNumber?: string | null;
    logoUrl?: string | null;
  };
  quotation: {
    quotationNumber: string;
    customerName: string;
    destinationSummary: string;
    /** Destination/Master-country names (e.g. "Malaysia"), joined with " → ". */
    destinations?: string;
    /** Sum of nights from every destination row on the source lead. */
    durationNights?: number | null;
    travelStartDate: string | null;
    travelEndDate: string | null;
    adults: number;
    childrenWithBed: number;
    childrenWithoutBed: number;
    infants: number;
    rooms: number;
    // Child ages carried from the Lead — same source the PDF renders. Null for
    // legacy quotations, in which case the age cells are omitted.
    childrenWithBedAges?: number[] | null;
    childrenWithoutBedAges?: number[] | null;
    infantAges?: number[] | null;
    createdAt?: string | null;
  };
  version: QuotationVersion;
  heroImageUrl?: string | null;
  hotelPresentations?: Record<
    string,
    {
      imageUrl: string | null;
      starCategory: number | null;
      starRating: string | null;
      address: string | null;
      reviewLink: string | null;
      checkInTime: string | null;
      checkOutTime: string | null;
      destination: string;
      country: string;
    }
  >;
  vehiclePresentations?: Record<
    string,
    {
      imageUrl: string | null;
      name: string;
      vehicleType: string;
      capacity: number | null;
    }
  >;
  airlinePresentations?: Record<string, { name: string; logoUrl: string | null }> | undefined;
  flightImageUrl?: string | null;
  flightImages?: Array<{ description?: string | null; url: string }>;
  sightseeingPresentations?: Record<string, { imageUrl: string | null }> | undefined;
  sightseeingDocumentPresentations?: Record<string, { imageUrl: string | null }> | undefined;
  cruisePresentations?: Record<
    string,
    { imageUrl: string | null; name: string | null; roomTypeName: string | null }
  >;
  destinationExpert?: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    whatsappNumber: string | null;
    jobTitle: string | null;
    bio: string | null;
    specialization: string | null;
    yearsOfExperience: number | null;
    tripsPlanned: number | null;
    languages: string | null;
    gender: string | null;
    profileImageUrl: string | null;
    avatarKind: string | null;
    config: {
      heading?: string | null;
      customIntroduction?: string | null;
      showWhatsapp: boolean;
      showCall: boolean;
      showEmail: boolean;
      showExperience: boolean;
      showTripsPlanned: boolean;
      showLanguages: boolean;
    };
  } | null;
  downloadUrl: string | null;
}
interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}
async function publicRequest<T>(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error('Quotation unavailable. Please try again later.');
  // Protect against non-JSON responses (e.g. an HTML fallback served instead of
  // the API) so customers never see a raw parser error.
  const contentType = response.headers?.get?.('Content-Type') ?? '';
  if (contentType && !contentType.includes('json'))
    throw new Error('Quotation unavailable. Please try again later.');
  let payload: Envelope<T>;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    throw new Error('Quotation unavailable. Please try again later.');
  }
  if (!payload.success || !payload.data)
    throw new Error(payload.error?.message || 'Quotation unavailable.');
  return payload.data;
}

const ADDON_SERVICE_TYPES = new Set([
  'TRAVEL_INSURANCE',
  'RAIL',
  'PASSPORT_ASSISTANCE',
  'MEAL',
  'GUIDE',
  'OTHER_ADD_ON',
  'GENERAL_ENQUIRY',
]);

/** True when rich-text HTML contains visible content (editor-empty markup excluded). */
const hasPolicyHtml = (html?: string | null): boolean =>
  Boolean(html && html.replace(/<[^>]*>/g, '').trim());

interface PolicySection {
  key: string;
  label: string;
  Icon: typeof CheckCircle2;
  iconClass: string;
  html?: string | null;
  rows: Array<{ id: string; content: string }>;
  visible: boolean;
}

const buildPolicySections = (version: QuotationVersion): PolicySection[] => {
  const sections: PolicySection[] = [
    {
      key: 'inclusions',
      label: 'Inclusions',
      Icon: CheckCircle2,
      iconClass: 'text-emerald-600',
      html: version.inclusionsHtml,
      rows: version.inclusions ?? [],
      visible: false,
    },
    {
      key: 'exclusions',
      label: 'Exclusions',
      Icon: XCircle,
      iconClass: 'text-red-600',
      html: version.exclusionsHtml,
      rows: version.exclusions ?? [],
      visible: false,
    },
    {
      key: 'child',
      label: 'Child Policy',
      Icon: Baby,
      iconClass: 'text-emerald-600',
      html: version.childPolicy,
      rows: [],
      visible: false,
    },
    {
      key: 'payment',
      label: 'Payment Policies',
      Icon: CreditCard,
      iconClass: 'text-amber-500',
      html: version.paymentPolicies,
      rows: [],
      visible: false,
    },
    {
      key: 'cancellation',
      label: 'Cancellation Policies',
      Icon: Ban,
      iconClass: 'text-red-600',
      html: version.cancellationPolicies,
      rows: [],
      visible: false,
    },
    {
      key: 'booking',
      label: 'Booking Terms',
      Icon: FileText,
      iconClass: 'text-[#000000]',
      html: version.bookingTerms,
      rows: version.terms ?? [],
      visible: false,
    },
  ];
  for (const section of sections)
    section.visible = hasPolicyHtml(section.html) || section.rows.length > 0;
  return sections;
};
const publicHotelSectionTitle = (value: string | null | undefined) => {
  const title = value?.trim();
  return !title || title === 'Accommodation Details' ? 'Your Hotels' : title;
};
/**
 * Customer-facing sightseeing section title. Mirrors the hotel rule: blank
 * values and the previous builder default (`Sightseeing & Experiences`)
 * render as `Your Itinerary`; explicitly configured custom titles are
 * preserved verbatim — no data migration, applies to saved weblinks too.
 */
export const publicSightseeingSectionTitle = (value: string | null | undefined) => {
  const title = value?.trim();
  return !title || title === 'Sightseeing & Experiences' ? 'Your Itinerary' : title;
};

/**
 * Customer-facing display texts for the weblink hero + profile card.
 *
 * Single resolution logic shared by the real public weblink and the
 * builder's live preview (which renders this same component): an absent
 * override means the existing automatically generated value; a custom value
 * overrides only that specific text. Overrides never touch masters,
 * itinerary, dates, pricing, or PDFs.
 */
export interface WeblinkDisplaySource {
  destinations?: string | null | undefined;
  destinationSummary?: string | null | undefined;
  durationNights?: number | null | undefined;
  travelStartDate?: string | null | undefined;
  travelEndDate?: string | null | undefined;
  customerName?: string | null | undefined;
}

export interface WeblinkDisplayOverrides {
  weblinkHeading?: string | null | undefined;
  packageHeading?: string | null | undefined;
  weblinkDurationText?: string | null | undefined;
  weblinkProfileDestination?: string | null | undefined;
}

export interface WeblinkDisplayValues {
  /** Hero line 1: override or Master Destination name. */
  mainHeading: string;
  /** Hero line 2 + profile Duration: override or `N Nights / N+1 Days`. */
  durationText: string | null;
  /** Hero line 3: override or `Custom Package for [Lead]`. */
  subtitle: string;
  /** Profile Destinations card value. */
  profileDestination: string;
}

export function resolveWeblinkDisplay(
  quotation: WeblinkDisplaySource | null | undefined,
  version: WeblinkDisplayOverrides | null | undefined,
): WeblinkDisplayValues {
  const q = quotation ?? {};
  const v = version ?? {};
  const nights =
    q.durationNights && q.durationNights > 0
      ? q.durationNights
      : q.travelStartDate && q.travelEndDate
        ? Math.max(
            0,
            Math.round(
              (new Date(q.travelEndDate).getTime() - new Date(q.travelStartDate).getTime()) /
                86_400_000,
            ),
          )
        : 0;
  const autoDuration = nights > 0 ? `${nights} Nights / ${nights + 1} Days` : null;
  // Weblink hero, exactly three lines: Master Destination name, duration, then
  // the saved package heading. Line 1 comes from the lead itinerary's Master
  // Destination names (`destinations`) — never an itinerary city. Only legacy
  // payloads without destinations fall back to the destination summary.
  // Private names never reach this payload (destination names only).
  const heroDestination =
    q.destinations?.split(/[•→>,/]/)[0]?.trim() ||
    (q.destinationSummary ?? '').split(/[•→>,/]/)[0]?.trim() ||
    (q.destinationSummary ?? '');
  // Legacy versions without a saved heading fall back to the lead-based
  // default (no destination derived here).
  const customerName = (q.customerName ?? '').trim();
  return {
    mainHeading: v.weblinkHeading?.trim() || heroDestination,
    durationText: v.weblinkDurationText?.trim() || autoDuration,
    subtitle: v.packageHeading?.trim() || `Custom Package for ${customerName}`,
    profileDestination:
      v.weblinkProfileDestination?.trim() ||
      q.destinations ||
      (q.destinationSummary ?? '').replace(/•/g, '→'),
  };
}

const publicHeroIntroduction = (value: string | null | undefined) =>
  (value ?? '').replace(/A travel proposal prepared for [^.]*\./g, '').trim();

export interface ResolvedWeblinkProfileItem {
  id: WeblinkProfileFieldId;
  label: string;
  value: string;
  hidden: boolean;
}

export interface ResolvedWeblinkProfile {
  items: ResolvedWeblinkProfileItem[];
  preparedBy: {
    label: string;
    name: string;
    phone: string;
    email: string;
    hidden: boolean;
  };
}

/**
 * Resolve the customer-facing weblink profile information card.
 *
 * A pure display transform: the caller supplies the automatically derived
 * values (from the quotation/lead) and this applies the saved per-item
 * label/value/visibility overrides. A blank customization always falls back to
 * the automatic value, and nothing here ever reads or writes source data.
 * Shared by the real public weblink and the builder's live preview (same
 * component), so both stay consistent.
 */
export function resolveWeblinkProfile(input: {
  autoValues: Record<WeblinkProfileFieldId, string>;
  autoPreparedBy: { name: string; phone: string; email: string };
  overrides?: WeblinkProfileConfig | null | undefined;
}): ResolvedWeblinkProfile {
  const overrides = input.overrides ?? {};
  const items = WEBLINK_PROFILE_FIELD_IDS.map((id): ResolvedWeblinkProfileItem => {
    const config = overrides[id] ?? {};
    const auto = input.autoValues[id] ?? '';
    return {
      id,
      label: config.label?.trim() || WEBLINK_PROFILE_FIELD_LABELS[id],
      value: config.value?.trim() || auto,
      hidden: config.hidden === true,
    };
  });
  const preparedBy = overrides.preparedBy ?? {};
  return {
    items,
    preparedBy: {
      label: preparedBy.label?.trim() || WEBLINK_PROFILE_PREPARED_BY_LABEL,
      name: preparedBy.name?.trim() || input.autoPreparedBy.name,
      phone: preparedBy.phone?.trim() || input.autoPreparedBy.phone,
      email: preparedBy.email?.trim() || input.autoPreparedBy.email,
      hidden: preparedBy.hidden === true,
    },
  };
}

function Info({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <p className="text-xs font-medium uppercase tracking-wide text-[#000000]">{label}</p>
      <p className="mt-0.5 font-semibold text-[#000000]">{value || '—'}</p>
    </div>
  );
}

/**
 * Document scope for DOM-reading descendants of the shared quotation view
 * (quick navigation, scroll-spy). On the real weblink this resolves to
 * `document`; when the view is portalled into a builder preview iframe it
 * resolves to that frame's document, so section queries never leak across.
 */
const QuotationDocumentContext = createContext<() => Document>(() => document);

/**
 * "Quick Navigation" index shown near the top of the public quotation. It reads
 * the rendered section headings from the DOM (every SectionTitle carries a
 * data-section-title), so it always reflects exactly the sections that are
 * present for this quotation, and smooth-scrolls to one on click.
 *
 * All DOM access is scoped to this quotation's own document, so the index also
 * works when the quotation renders inside a preview iframe: on the real
 * weblink the scope is `document` and behaviour is unchanged.
 */
function SectionNav({ sticky }: { sticky: boolean }) {
  const [sections, setSections] = useState<Array<{ id: string; label: string }>>([]);
  const [activeId, setActiveId] = useState<string>('');
  // The document this instance lives in — `document` on the real weblink, the
  // frame document inside a builder preview. Stable across renders.
  const getOwnerDoc = useContext(QuotationDocumentContext);
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = getOwnerDoc();
    const collect = () => {
      const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-section-title]'));
      const next = nodes
        .filter((node) => node.id)
        .map((node) => ({
          id: node.id,
          label: node.dataset.sectionTitle ?? node.textContent ?? '',
        }));
      // Section headings re-render with live data (e.g. an edited Section
      // Title in the builder preview), so only skip the update when nothing
      // actually changed — this also keeps the observer below from looping.
      setSections((current) =>
        current.length === next.length &&
        current.every(
          (entry, index) => entry.id === next[index]?.id && entry.label === next[index]?.label,
        )
          ? current
          : next,
      );
    };
    collect();
    // Re-read once more after paint in case a section renders asynchronously
    // (e.g. once its images resolve).
    const timer = window.setTimeout(collect, 400);
    // Headings can change after mount (live preview edits), so re-collect on
    // DOM changes within this quotation's own document only.
    let observer: MutationObserver | null = null;
    const target = root.documentElement ?? root.body;
    if (target && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(collect);
      observer.observe(target, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-section-title'],
      });
    }
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [getOwnerDoc]);

  // Scroll-spy: the active chip always tracks the section currently in view.
  // The active section is the last heading at or above a trigger line just
  // below the sticky bar (section headings carry scroll-margin-top, so an
  // anchor scroll lands them exactly on that line). When the viewport reaches
  // the bottom of the page the last section wins even if its heading rests
  // below the line — short trailing sections such as Contact Us can never
  // scroll fully under the bar, and without this the previous section would
  // incorrectly keep the green state. Exactly one id is ever active.
  useEffect(() => {
    const root = getOwnerDoc();
    const view = root.defaultView ?? window;
    const nodes = sections
      .map((section) => root.getElementById(section.id))
      .filter((node): node is HTMLElement => Boolean(node));
    if (!nodes.length) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const tops = new Map(nodes.map((node) => [node.id, node.getBoundingClientRect().top]));
      const next = activeScrollSpyId(
        sections,
        (id) => tops.get(id) ?? null,
        {
          scrollY: view.scrollY,
          innerHeight: view.innerHeight,
          documentHeight: root.documentElement.scrollHeight,
        },
      );
      setActiveId((current) => (current === next ? current : next));
    };
    const schedule = () => {
      if (!frame) frame = view.requestAnimationFrame(update);
    };
    update();
    view.addEventListener('scroll', schedule, { passive: true });
    view.addEventListener('resize', schedule);
    return () => {
      if (frame) view.cancelAnimationFrame(frame);
      view.removeEventListener('scroll', schedule);
      view.removeEventListener('resize', schedule);
    };
  }, [sections, getOwnerDoc]);

  // Keep the active chip centred within the horizontally scrollable bar (only
  // the bar scrolls, never the page), so it stays visible when chips overflow.
  const barRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    const bar = barRef.current;
    const chip = activeId ? chipRefs.current.get(activeId) : null;
    if (!bar || !chip) return;
    const target = chip.offsetLeft - bar.clientWidth / 2 + chip.clientWidth / 2;
    if (typeof bar.scrollTo === 'function') {
      bar.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
    }
  }, [activeId]);

  if (sections.length < 2) return null;

  const goTo = (id: string) => {
    setActiveId(id);
    // Same behaviour as scrollToSectionId, but scoped to this nav's own
    // document so quick navigation also works inside a preview iframe.
    const el = getOwnerDoc().getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <nav
      ref={navRef}
      aria-label="Quotation sections"
      className={`${
        sticky ? 'sticky top-3 z-30' : ''
      } rounded-full border border-slate-200 bg-card/90 p-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/70`}
    >
      <div className="relative flex items-center gap-1">
        <span className="ml-2 mr-1 flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#000000]">
          <Compass className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          <span className="hidden sm:inline">Jump to</span>
        </span>
        <div
          ref={barRef}
          className="flex flex-1 gap-1 overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {sections.map((section) => {
            const active = section.id === activeId;
            return (
              <button
                key={section.id}
                ref={(el) => {
                  if (el) chipRefs.current.set(section.id, el);
                  else chipRefs.current.delete(section.id);
                }}
                type="button"
                onClick={() => goTo(section.id)}
                aria-current={active ? 'true' : undefined}
                className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-all ${
                  active
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-[#000000] hover:bg-slate-100'
                }`}
              >
                {section.label}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

/** Destination Expert — premium editorial presentation. Hidden only when not configured. */
function DestinationExpertSection({
  expert,
  customerName,
  destinationSummary,
  destinations,
  quotationId,
  quotationTitle,
}: {
  expert: {
    fullName: string;
    jobTitle?: string | null;
    bio?: string | null;
    specialization?: string | null;
    yearsOfExperience?: number | null;
    tripsPlanned?: number | null;
    languages?: string | null;
    phone?: string | null;
    whatsappNumber?: string | null;
    email?: string | null;
    gender?: string | null;
    profileImageUrl?: string | null;
    avatarKind?: string | null;
    config: {
      heading?: string | null;
      customIntroduction?: string | null;
      showWhatsapp: boolean;
      showCall: boolean;
      showEmail: boolean;
      showExperience: boolean;
      showTripsPlanned: boolean;
      showLanguages: boolean;
    };
  } | null;
  customerName: string;
  destinationSummary: string;
  destinations?: string | null;
  quotationId?: string | null;
  quotationTitle?: string | null;
}) {
  if (!expert) return null;
  const heading = expert.config.heading?.trim() || 'Know Your Destination Expert';
  const firstName = (customerName || '').trim().split(/\s+/)[0] || '';
  const greeting = firstName ? `Hi ${firstName}, I’m` : `Hi, I’m`;
  const expertFirst = (expert.fullName || '').trim().split(/\s+/)[0] || expert.fullName || '';
  const expertDisplay = expertFirst.toUpperCase();
  const destList = (destinations || destinationSummary || '')
    .split(/[•→,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const destTitle =
    destList.length === 1
      ? `Your ${destList[0]} Destination Expert`
      : destList.length > 1
        ? 'Your Trip Destination Expert'
        : 'Your Destination Expert';
  const bio = expert.config.customIntroduction?.trim() || expert.bio?.trim() || '';
  const showExp =
    expert.config.showExperience &&
    expert.yearsOfExperience != null &&
    expert.yearsOfExperience > 0;
  const showTrips =
    expert.config.showTripsPlanned && expert.tripsPlanned != null && expert.tripsPlanned > 0;
  const showLangs = expert.config.showLanguages && expert.languages?.trim();
  const whatsappPhone = normalizeWhatsAppPhone(expert.whatsappNumber);
  const phone = expert.phone?.trim() || null;
  const telPhone = phone?.replace(/[^+0-9]/g, '') || null;
  const email = expert.email?.trim() || null;
  const whatsappMessage = `Hello, I'm interested in the travel quotation (ID: ${buildQuotationDescription(quotationId ?? null, quotationTitle ?? null, customerName)})`;
  const avatarSrc =
    expert.profileImageUrl ||
    (expert.avatarKind === 'male' || expert.gender === 'MALE'
      ? '/destination-expert/male.png'
      : null) ||
    (expert.avatarKind === 'female' || expert.gender === 'FEMALE'
      ? '/destination-expert/female.png'
      : null);
  const initials =
    expert.fullName
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'DE';
  return (
    <section>
      <SectionTitle>{heading}</SectionTitle>
      <div className="overflow-hidden rounded-[24px] border border-slate-200/60 bg-white shadow-[0_12px_40px_rgba(15,23,42,0.06)]">
        <div className="grid gap-8 p-7 sm:p-8 md:grid-cols-[320px_1fr] md:gap-10 md:p-10">
          {/* LEFT — avatar + greeting */}
          <div className="flex flex-col items-center text-center md:items-start md:text-left">
            <div className="relative w-full max-w-[300px]">
              <div
                className="absolute -inset-3 -z-10 hidden rounded-[28px] bg-gradient-to-br from-emerald-50 via-teal-50 to-sky-50 opacity-70 md:block"
                aria-hidden="true"
              />
              <div className="overflow-hidden rounded-[20px] border border-slate-200/60 bg-white shadow-sm">
                <div className="aspect-[4/5] w-full bg-gradient-to-b from-slate-50 to-white p-2">
                  {avatarSrc ? (
                    <img
                      src={avatarSrc}
                      alt={`${expert.fullName} avatar`}
                      className="h-full w-full object-contain object-top"
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center rounded-[16px] bg-gradient-to-br from-emerald-700 via-teal-700 to-sky-700 text-6xl font-extrabold tracking-normal text-white"
                      aria-label={`${expert.fullName} avatar initials`}
                    >
                      {initials}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-7 w-full">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#000000]">
                {greeting}
              </p>
              <p className="mt-2 text-[30px] font-extrabold tracking-tight text-[#000000] md:text-[34px] md:leading-none">
                {expertDisplay}
              </p>
              {expert.jobTitle?.trim() ? (
                <p className="mt-2 text-sm font-medium tracking-wide text-emerald-700">
                  {expert.jobTitle}
                </p>
              ) : expert.specialization?.trim() ? (
                <p className="mt-2 text-sm font-medium tracking-wide text-emerald-700">
                  {expert.specialization}
                </p>
              ) : null}
              {expert.specialization?.trim() && expert.jobTitle?.trim() ? (
                <p className="mt-1 text-xs text-[#000000]">{expert.specialization}</p>
              ) : null}
            </div>
          </div>
          {/* RIGHT — title + content */}
          <div className="flex flex-col justify-center text-center md:text-left">
            <div className="flex flex-col items-center md:items-start">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                Destination Expert
              </p>
              <h3 className="mt-2 max-w-[28ch] text-xl font-bold leading-tight tracking-tight text-[#000000] md:text-[24px]">
                {destTitle}
              </h3>
              <div className="mt-3 h-1 w-10 rounded-full bg-emerald-600/15" aria-hidden="true" />
            </div>

            {(showExp || showTrips || showLangs) && (
              <div className="mt-6 flex flex-wrap justify-center gap-2 md:justify-start">
                {showExp && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-[#000000] shadow-sm">
                    <Star className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />{' '}
                    {expert.yearsOfExperience}+ Years
                  </span>
                )}
                {showTrips && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-[#000000] shadow-sm">
                    <Building2 className="h-3.5 w-3.5 text-[#000000]" aria-hidden="true" />{' '}
                    {expert.tripsPlanned}+ Trips
                  </span>
                )}
                {showLangs && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-[#000000] shadow-sm">
                    <Compass className="h-3.5 w-3.5 text-[#000000]" aria-hidden="true" />{' '}
                    {expert.languages}
                  </span>
                )}
              </div>
            )}

            {bio && (
              <p className="mx-auto mt-6 max-w-[60ch] whitespace-pre-line break-words text-[15px] leading-7 text-[#000000] md:mx-0">
                {bio}
              </p>
            )}

            {(expert.config.showWhatsapp || expert.config.showCall || expert.config.showEmail) &&
              (whatsappPhone || phone || email) && (
                <div className="mt-8 flex flex-wrap justify-center gap-3 md:justify-start">
                  {expert.config.showWhatsapp && whatsappPhone && (
                    <a
                      href={`https://wa.me/${whatsappPhone}?text=${encodeURIComponent(whatsappMessage)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
                    </a>
                  )}
                  {expert.config.showCall && phone && telPhone && (
                    <a
                      href={`tel:${telPhone}`}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-2.5 text-sm font-semibold text-[#000000] shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200"
                    >
                      <Phone className="h-4 w-4" aria-hidden="true" /> Call
                    </a>
                  )}
                  {expert.config.showEmail && email && (
                    <a
                      href={`mailto:${email}`}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-2.5 text-sm font-semibold text-[#000000] shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200"
                    >
                      <Mail className="h-4 w-4" aria-hidden="true" /> Email
                    </a>
                  )}
                </div>
              )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** FAQs — polished accordion. Hidden entirely when no FAQs exist. */
function FaqSection({
  faqs,
  expandAll = false,
}: {
  faqs: Array<{ question: string; answer: string }>;
  /** PDF mode: every answer rendered open, no interactive controls. */
  expandAll?: boolean;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (!faqs.length) return null;
  return (
    <section>
      <SectionTitle>Frequently Asked Questions</SectionTitle>
      <div className="space-y-2">
        {faqs.map((faq, index) => {
          const open = expandAll || openIndex === index;
          return (
            <div
              key={`${faq.question}-${index}`}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
            >
              {expandAll ? (
                <p
                  className="weblink-rich-text rich-text-content break-words px-4 pt-3 text-sm font-semibold text-[#000000] [&_a]:text-blue-600 [&_a]:underline [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(faq.question) }}
                />
              ) : (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`faq-panel-${index}`}
                  onClick={() => setOpenIndex(open ? null : index)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span
                    className="weblink-rich-text rich-text-content min-w-0 flex-1 whitespace-pre-line break-words text-sm font-semibold text-[#000000] [&_a]:text-blue-600 [&_a]:underline [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(faq.question) }}
                  />
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-[#000000] transition-transform ${open ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              )}
              {open && (
                <div
                  id={`faq-panel-${index}`}
                  className="weblink-rich-text rich-text-content whitespace-pre-line break-words border-t px-4 py-3 text-sm leading-relaxed text-[#000000] [&_a]:text-blue-600 [&_a]:underline [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(faq.answer) }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}


const SIGHTSEEING_TRANSFER_LABELS: Record<string, string> = {
  PRIVATE: 'Private Transfer',
  SHARED: 'Shared Transfer',
  NO_TRANSFER: 'No Transfer',
};

type AnyRecord = Record<string, unknown>;

const TRANSFER_CANONICAL: Record<string, string> = {
  PRIVATE: 'PRIVATE',
  PRIVATE_TRANSFER: 'PRIVATE',
  SHARED: 'SHARED',
  SHARED_TRANSFER: 'SHARED',
  NO_TRANSFER: 'NO_TRANSFER',
  NONE: 'NO_TRANSFER',
};

/** Normalize the many historical sightseeing snapshot shapes into one view model. */
/** Normalize legacy meal-mode variants ("NO TRANSFER", "no_transfer", "hotel", …). */
function normalizeSightseeingMealMode(value: unknown): string | null {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s_./-]+/g, '');
  if (raw === 'NOTRANSFER' || raw === 'NONE') return 'NO_TRANSFER';
  if (raw === 'INCLUDEATHOTEL' || raw === 'HOTEL' || raw === 'INHOTEL') return 'INCLUDE_AT_HOTEL';
  if (raw === 'WITHTRANSFER') return 'WITH_TRANSFER';
  return null;
}

/**
 * Keep only pricing rows that are safe to show a customer: a real label and a
 * real, finite, non-negative number. Anything else — a legacy activity with no
 * `pricingOptions`, a half-filled row, a stray `0`-priced blank — collapses to
 * an empty list, which renders nothing at all.
 */
function normalizeActivityPricing(raw: unknown): Array<{ label: string; price: number }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const row = (entry ?? {}) as AnyRecord;
    const label = String(row.label ?? '').trim();
    if (!label || row.price == null || row.price === '') return [];
    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0) return [];
    return [{ label, price }];
  });
}

function normalizeDisplayPricing(raw: unknown): Array<{ label: string; price: number }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const row = (entry ?? {}) as AnyRecord;
    if (row.enabled === false) return [];
    const label = String(row.label ?? '').trim();
    if (!label || row.price == null || row.price === '') return [];
    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0) return [];
    return [{ label, price }];
  });
}

/**
 * Per-activity price list. Renders nothing — no heading, no spacing — when the
 * activity carries no usable prices, so an unpriced activity looks exactly as
 * it did before this feature existed.
 */
function ActivityPricing({
  rows,
  fmt,
  heading = 'PRICING',
}: {
  rows: Array<{ label: string; price: number }>;
  fmt: (value: number) => string;
  heading?: string;
}) {
  if (!rows.length) return null;
  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#000000]">{heading}</p>
      <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
          >
            <dt className="break-words text-xs font-medium leading-4 text-[#000000]">
              {row.label}
            </dt>
            <dd className="mt-0.5 break-words text-sm font-semibold leading-5 text-[#000000]">
              {fmt(row.price)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function normalizeItineraryDay(raw: unknown, fallbackNumber: number) {
  const day = (raw ?? {}) as AnyRecord;
  const activitiesRaw = Array.isArray(day.activities)
    ? (day.activities as AnyRecord[])
    : Array.isArray(day.activity)
      ? (day.activity as AnyRecord[])
      : [];
  const activities = activitiesRaw.map((entry) => ({
    sightseeingId: (entry.sightseeingId ?? null) as string | null,
    imageDocumentId: (entry.imageDocumentId ?? null) as string | null,
    name: (entry.name ?? entry.title ?? null) as string | null,
    startTime: (entry.startTime ?? null) as string | null,
    // Legacy snapshots had no visibility flag; their configured time remains visible.
    showTime: entry.showTime !== false,
    duration: (entry.duration ?? null) as string | null,
    city: (entry.city ?? null) as string | null,
    description: (entry.description ?? null) as string | null,
    imageUrl: (entry.imageUrl ?? entry.image ?? null) as string | null,
    images: entry.images,
    pdfImageUrl: (entry.pdfImageUrl ?? null) as string | null,
    imageSnapshotPresent: entry.imageSnapshotPresent === true,
    // Per-activity transfer; legacy rows fall back to the day-level value.
    dailyTransfer:
      TRANSFER_CANONICAL[String((entry as AnyRecord).dailyTransfer ?? '').toUpperCase()] ?? null,
    // Absent on activities saved before per-activity pricing existed.
    pricingOptions: normalizeActivityPricing(entry.pricingOptions),
    displayPricing: normalizeDisplayPricing((entry as AnyRecord).displayPricing),
    displayPricingHeading:
      String((entry as AnyRecord).displayPricingHeading ?? '').trim() || 'PRICING',
    sequence: (entry.sequence ?? null) as number | null,
  }));
  const mealsRaw = day.meals;
  const meals = Array.isArray(mealsRaw)
    ? (mealsRaw as string[]).reduce(
        (acc, meal) => {
          const key = meal.trim().toLowerCase();
          if (key === 'breakfast') acc.breakfast = true;
          if (key === 'lunch') acc.lunch = true;
          if (key === 'dinner') acc.dinner = true;
          return acc;
        },
        { breakfast: false, lunch: false, dinner: false },
      )
    : {
        breakfast: Boolean((mealsRaw as AnyRecord | undefined)?.breakfast),
        lunch: Boolean((mealsRaw as AnyRecord | undefined)?.lunch),
        dinner: Boolean((mealsRaw as AnyRecord | undefined)?.dinner),
      };
  const itineraryTransferKey = String(day.dailyTransfer ?? '').toUpperCase();
  const prefsRaw = (day.mealPreferences as AnyRecord | undefined) ?? {};
  const mealPreferences = Object.fromEntries(
    (['breakfast', 'lunch', 'dinner'] as const).map((key) => {
      const entry = prefsRaw[key];
      if (!entry || typeof entry !== 'object') return [key, null] as const;
      return [
        key,
        {
          mode: normalizeSightseeingMealMode((entry as AnyRecord).mode),
          transferDetails: ((entry as AnyRecord).transferDetails ?? null) as string | null,
        },
      ] as const;
    }),
  ) as Record<
    'breakfast' | 'lunch' | 'dinner',
    { mode: string | null; transferDetails: string | null } | null
  >;
  return {
    dayNumber: Number(day.dayNumber) || fallbackNumber,
    title: (day.dayTitle ?? day.title ?? null) as string | null,
    city: (day.city ?? null) as string | null,
    date: (day.date ?? null) as string | null,
    meals,
    // Shared legacy mode, normalized without forcing a default: a missing or
    // unknown legacy mode must never silently become INCLUDE_AT_HOTEL.
    mealMode: normalizeSightseeingMealMode(day.mealMode),
    mealPreferences,
    dailyTransfer: TRANSFER_CANONICAL[itineraryTransferKey] ?? 'NO_TRANSFER',
    activities,
  };
}

function itineraryDayLabel(day: ReturnType<typeof normalizeItineraryDay>): string {
  // Single shared preserve-or-prefix rule (see formatDayPrefixedTitle):
  // stored DAY prefixes render exactly, others receive `DAY N | Title`.
  const titled = formatDayPrefixedTitle(day.dayNumber, day.title);
  if (titled) return titled;
  const primaryTitle = day.activities.find((activity) => activity.name?.trim())?.name?.trim();
  if (primaryTitle) return formatItineraryDayTitle(day.dayNumber, primaryTitle);
  if (day.city?.trim()) return formatItineraryDayTitle(day.dayNumber, day.city);
  return formatItineraryDayTitle(day.dayNumber, null);
}

function itineraryDateLabel(date: string | null | undefined): string | null {
  const raw = String(date ?? '').trim();
  if (!raw) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

function itineraryMealLabel(
  pref: { mode: string | null; transferDetails: string | null } | null,
  legacyMode: string | null,
): string | null {
  // Each meal reads its own saved preference. The shared legacy mode is used
  // only when the meal has no per-meal preference at all — never as a fallback
  // for a present-but-unknown mode, so a bad value cannot become "(Hotel)".
  const mode = pref ? pref.mode : legacyMode;
  if (mode === 'WITH_TRANSFER') {
    const details = (pref?.transferDetails ?? '').trim();
    return details ? `With Transfer: ${details}` : 'With Transfer';
  }
  if (mode === 'INCLUDE_AT_HOTEL') return 'Hotel';
  if (mode === 'NO_TRANSFER') return 'No Transfer';
  return null;
}

function itineraryMealsLabel(day: ReturnType<typeof normalizeItineraryDay>): string | null {
  const keys = ['breakfast', 'lunch', 'dinner'] as const;
  const selected = keys.filter((key) => day.meals[key]);
  if (!selected.length) return null;
  return selected
    .map((key) => {
      const name = key.charAt(0).toUpperCase() + key.slice(1);
      const label = itineraryMealLabel(day.mealPreferences[key], day.mealMode);
      return label ? `${name} (${label})` : name;
    })
    .join(', ');
}

function itineraryDayHasMeaning(day: ReturnType<typeof normalizeItineraryDay>): boolean {
  return Boolean(
    day.title?.trim() ||
    day.city?.trim() ||
    day.activities.some((activity) => activity.name?.trim() || activity.description?.trim()) ||
    day.meals.breakfast ||
    day.meals.lunch ||
    day.meals.dinner ||
    day.dailyTransfer !== 'NO_TRANSFER',
  );
}

/** Render a rich-text (HTML) or plain-text description without leaking markup. */
function ItineraryRichText({ html }: { html: string | null }) {
  // Decode entities FIRST (browser-serialized `&nbsp;`, accidentally
  // double-escaped `&amp;nbsp;`, numeric `&#160;`/`&#xA0;`): entity text must
  // never leak literally. Plain text then renders React-escaped (XSS-safe);
  // real markup goes through the sanitizer as before, preserving formatting.
  const text = decodeHtmlEntities(html ?? '').trim();
  if (!text) return null;
  if (!/<[a-z][\s\S]*>/i.test(text))
    return <p className="whitespace-pre-line text-sm leading-relaxed text-[#000000]">{text}</p>;
  return (
    <div
      className="weblink-rich-text rich-text-content itinerary-rich-text text-sm leading-relaxed text-[#000000] [&_a]:text-blue-600 [&_a]:underline [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }}
    />
  );
}

/** Fixed-size itinerary image with a safe fallback on load failure. */
function ItineraryImage({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !src)
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[#000000]">
        <ImageIcon className="h-10 w-10" />
      </div>
    );
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover object-center"
    />
  );
}

/** Small per-activity thumbnail with a safe neutral fallback. */
function ItineraryThumb({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[#000000]">
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover object-center"
    />
  );
}

/** Reference "Your Itinerary" — compact timeline of day cards. */
function SightseeingItineraryView({
  days,
  color,
  images,
  documentImages,
  description,
  destinationImage,
  fmt,
  pricingMode,
  sectionTitle,
  pdfMode = false,
}: {
  days: SightseeingDay[];
  color: string;
  images: Record<string, { imageUrl: string | null }>;
  documentImages: Record<string, { imageUrl: string | null }>;
  description?: string | null;
  destinationImage?: string | null;
  /** The quotation's own currency formatter, reused for activity pricing. */
  fmt: (value: number) => string;
  pricingMode?: string;
  /** Builder-configured section title; falls back to `Your Itinerary`. */
  sectionTitle?: string | null;
  /** PDF mode: first gallery image only, no carousel controls. */
  pdfMode?: boolean;
}) {
  const normalized = useMemo(
    () => days.map((day, index) => normalizeItineraryDay(day, index + 1)),
    [days],
  );
  // Source positions survive the validity filter below: the builder targets a
  // day by its form position (`day:<n>`), and each rendered day carries that
  // same source index — so reorder/add/remove/filtering can never mis-target.
  const shown = normalized
    .map((day, sourceIndex) => ({ day, sourceIndex }))
    .filter(({ day }) => itineraryDayHasMeaning(day));
  if (!shown.length) return null;
  const sectionIntro = (description ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    <section>
      <SectionTitle>{publicSightseeingSectionTitle(sectionTitle)}</SectionTitle>
      {sectionIntro && (
        <div className="mb-5 rounded-md border border-sky-200 border-l-4 border-l-cyan-500 bg-sky-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-cyan-900">
            <InfoIcon className="h-4 w-4 shrink-0 text-cyan-600" aria-hidden="true" />
            Instructions
          </p>
          <div className="mt-2 text-sm leading-relaxed text-[#000000]">
            <ItineraryRichText html={description ?? ''} />
          </div>
        </div>
      )}
      <div className="relative">
        <div
          aria-hidden="true"
          className="weblink-timeline-line absolute bottom-4 left-4 top-4 w-0.5"
          style={{ backgroundColor: color }}
        />
        <div className="space-y-5">
          {shown.map(({ day, sourceIndex }) => {
            const title = itineraryDayLabel(day);
            const dateLabel = itineraryDateLabel(day.date);
            const mealsLabel = itineraryMealsLabel(day);
            const validActivities = day.activities.filter(
              (activity) => activity.name?.trim() || activity.description?.trim(),
            );
            const primaryActivityForHeader =
              validActivities.find((a) => a.startTime?.trim()) ?? null;
            const headerTimeLabel = primaryActivityForHeader?.startTime
              ? `${formatTime12Hour(primaryActivityForHeader.startTime)}${primaryActivityForHeader.duration ? ` · ${primaryActivityForHeader.duration}` : ''}`
              : null;
            const dayFallbackImage = resolveItineraryDayImage(day.activities, {
              document: (documentId) => documentImages[documentId]?.imageUrl ?? null,
              snapshot: (imageUrl) => imageUrl,
              sightseeing: (sightseeingId) => images[sightseeingId]?.imageUrl ?? null,
              destination: destinationImage ?? null,
            });
            const imagesForActivity = (activity: (typeof validActivities)[number]) => {
              const gallery = quotationGalleryImages(activity.images);
              if (activity.imageSnapshotPresent || gallery.length) return gallery;
              const legacy = resolveItineraryActivityImage(activity, {
                document: (documentId) => documentImages[documentId]?.imageUrl ?? null,
                snapshot: (imageUrl) => imageUrl,
                sightseeing: (sightseeingId) => images[sightseeingId]?.imageUrl ?? null,
              });
              const fallback = legacy ?? destinationImage ?? null;
              return fallback ? [{ url: fallback, alt: activity.name ?? title }] : [];
            };
            const dayImages =
              validActivities.length === 0 && dayFallbackImage
                ? [{ url: dayFallbackImage, alt: title }]
                : [];
            return (
              // Stable internal anchor for live-preview deep-linking (the
              // builder targets a day by form position; `sourceIndex` is that
              // same position, unaffected by filtering). Never user-visible.
              <div key={`${day.dayNumber}`} data-preview-item={`day:${sourceIndex}`} className="weblink-timeline-item relative pl-10 md:pl-12">
                <span
                  aria-hidden="true"
                  className="weblink-timeline-marker absolute left-[10px] top-6 h-3.5 w-3.5 rounded-full border-2 bg-white"
                  style={{ borderColor: color }}
                />
                <article className="weblink-day-card flex flex-col gap-4 rounded-lg border border-slate-200 bg-card p-4 shadow-sm md:gap-5 md:p-5">
                  {validActivities.length === 0 && (
                    <QuotationMediaFrame
                      images={dayImages}
                      label="Itinerary day"
                      radius="rounded-lg"
                      className="shrink-0 md:w-[285px]"
                      firstOnly={pdfMode}
                      placeholder={<ItineraryImage src={null} alt={title} />}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold text-[#000000]">{title}</h3>
                    <div className="weblink-day-meta mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#000000]">
                      {day.city?.trim() && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-4 w-4" /> {day.city}
                        </span>
                      )}
                      {day.city?.trim() && (dateLabel || headerTimeLabel) && (
                        <span aria-hidden="true">|</span>
                      )}
                      {dateLabel && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-4 w-4" /> {dateLabel}
                        </span>
                      )}
                      {dateLabel && headerTimeLabel && <span aria-hidden="true">|</span>}
                      {headerTimeLabel && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-4 w-4" /> {headerTimeLabel}
                        </span>
                      )}
                    </div>
                    {validActivities.length === 1 ? (
                      (() => {
                        const activity = validActivities[0];
                        if (!activity) return null;
                        const activityImages = imagesForActivity(activity);
                        return (
                          <>
                            <div className="weblink-activity-panel mt-3 overflow-hidden rounded-lg border border-slate-200">
                              <p className="weblink-activities-heading border-b border-slate-200 bg-slate-100/80 px-3 py-1.5 text-sm font-semibold text-[#000000]">
                                Activities &amp; Details
                              </p>
                              <div className="flex flex-col gap-3 bg-white p-3 sm:flex-row">
                                <QuotationMediaFrame
                                  aria-label={`${activity.name ?? 'Activity'} image gallery`}
                                  images={activityImages}
                                  label={activity.name ?? 'Activity'}
                                  radius="rounded-md"
                                  className="shrink-0 sm:w-64"
                                  firstOnly={pdfMode}
                                  placeholder={
                                    <ItineraryThumb src={null} alt={activity.name ?? 'Activity'} />
                                  }
                                />
                                <div className="min-w-0 flex-1">
                                  {!isItineraryActivityTitleDuplicate(day.title, activity.name) &&
                                    activity.name?.trim() && (
                                      <p className="flex items-center gap-2 font-semibold text-[#000000]">
                                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                                        {activity.name}
                                      </p>
                                    )}
                                  {activity.description && (
                                    <div className="mt-1 sm:pl-6">
                                      <ItineraryRichText html={activity.description} />
                                    </div>
                                  )}
                                  {(() => {
                                    const label =
                                      SIGHTSEEING_TRANSFER_LABELS[
                                        activity.dailyTransfer ?? day.dailyTransfer
                                      ];
                                    if (!label) return null;
                                    return (
                                      <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <span
                                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-white"
                                          style={{ backgroundColor: color }}
                                        >
                                          <Car className="h-3.5 w-3.5" />
                                          {label}
                                        </span>
                                      </div>
                                    );
                                   })()}
                                  {pricingMode === 'SECTION_WISE' && (
                                    <ActivityPricing rows={activity.pricingOptions} fmt={fmt} />
                                  )}
                                  <ActivityPricing rows={activity.displayPricing} fmt={fmt} heading={activity.displayPricingHeading} />
                                </div>
                              </div>
                            </div>
                            {mealsLabel && (
                              <p className="weblink-day-meals mt-2 flex items-center gap-1 text-sm text-[#000000]">
                                <Utensils className="h-4 w-4 text-[#000000]" />
                                <span className="font-semibold">Meals:</span> {mealsLabel}
                              </p>
                            )}
                          </>
                        );
                      })()
                    ) : validActivities.length >= 2 ? (
                      <>
                        <div className="weblink-activity-panel mt-3 overflow-hidden rounded-lg border border-slate-200">
                          <p className="weblink-activities-heading border-b border-slate-200 bg-slate-100/80 px-3 py-1.5 text-sm font-semibold text-[#000000]">
                            Activities &amp; Details
                          </p>
                          <div className="bg-white p-3">
                            {validActivities.map((activity, activityIndex) => {
                              const activityImages = imagesForActivity(activity);
                              const isLast = activityIndex === validActivities.length - 1;
                              return (
                                <Fragment
                                  key={`${activity.sightseeingId ?? 'activity'}-${activityIndex}`}
                                >
                                  <div className="flex flex-col gap-3 sm:flex-row">
                                    <QuotationMediaFrame
                                      aria-label={`${activity.name ?? 'Activity'} image gallery`}
                                      images={activityImages}
                                      label={activity.name ?? 'Activity'}
                                      radius="rounded-md"
                                      className="shrink-0 sm:w-64"
                                      firstOnly={pdfMode}
                                      placeholder={
                                        <ItineraryThumb
                                          src={null}
                                          alt={activity.name ?? 'Activity'}
                                        />
                                      }
                                    />
                                    <div className="min-w-0 flex-1">
                                      {!isItineraryActivityTitleDuplicate(day.title, activity.name) &&
                                        activity.name?.trim() && (
                                          <p className="flex items-center gap-2 font-semibold text-[#000000]">
                                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                                            {activity.name}
                                          </p>
                                        )}
                                      {activity.description && (
                                        <div className="mt-1 sm:pl-6">
                                          <ItineraryRichText html={activity.description} />
                                        </div>
                                      )}
                                      {(() => {
                                        const label =
                                          SIGHTSEEING_TRANSFER_LABELS[
                                            activity.dailyTransfer ?? day.dailyTransfer
                                          ];
                                        if (!label) return null;
                                        return (
                                          <div className="mt-2 flex flex-wrap items-center gap-2">
                                            <span
                                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-white"
                                              style={{ backgroundColor: color }}
                                            >
                                              <Car className="h-3.5 w-3.5" />
                                              {label}
                                            </span>
                                          </div>
                                        );
                                      })()}
                                      {pricingMode === 'SECTION_WISE' && (
                                        <ActivityPricing rows={activity.pricingOptions} fmt={fmt} />
                                      )}
                                      <ActivityPricing rows={activity.displayPricing} fmt={fmt} heading={activity.displayPricingHeading} />
                                    </div>
                                  </div>
                                  {!isLast && <hr className="my-3 border-slate-200" />}
                                </Fragment>
                              );
                            })}
                          </div>
                        </div>
                        {mealsLabel && (
                          <p className="weblink-day-meals mt-2 flex items-center gap-1 text-sm text-[#000000]">
                            <Utensils className="h-4 w-4 text-[#000000]" />
                            <span className="font-semibold">Meals:</span> {mealsLabel}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        {(() => {
                          const label = SIGHTSEEING_TRANSFER_LABELS[day.dailyTransfer];
                          if (!label) return null;
                          return (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <span
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-white"
                                style={{ backgroundColor: color }}
                              >
                                <Car className="h-3.5 w-3.5" />
                                {label}
                              </span>
                            </div>
                          );
                        })()}
                        {mealsLabel && (
                          <p className="weblink-day-meals mt-2 flex items-center gap-1 text-sm text-[#000000]">
                            <Utensils className="h-4 w-4 text-[#000000]" />
                            <span className="font-semibold">Meals:</span> {mealsLabel}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * View-only quotation snapshot carousel. It preserves the saved order inside
 * each item card; a single image is shown plainly without editing controls.
 */
type QuotationGalleryImage = {
  url: string;
  thumbnailUrl?: string | null;
  alt?: string | null;
};

function quotationGalleryImages(value: unknown): QuotationGalleryImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const image = candidate as Record<string, unknown>;
    const url = typeof image.url === 'string' ? image.url.trim() : '';
    if (!url) return [];
    return [
      {
        url,
        thumbnailUrl:
          typeof image.thumbnailUrl === 'string' && image.thumbnailUrl.trim()
            ? image.thumbnailUrl
            : null,
        alt: typeof image.alt === 'string' && image.alt.trim() ? image.alt : null,
      },
    ];
  });
}

function QuotationImageCarousel({
  images,
  label = 'Hotel',
  imageFit = 'cover',
}: {
  images: QuotationGalleryImage[];
  label?: string;
  /** How the photo fills its fixed frame; `contain` shows the whole image. */
  imageFit?: 'cover' | 'contain';
}) {
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Touch-swipe tracking for mobile galleries. Single-image galleries return
  // before these are used, so their behavior is unchanged.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swipedRef = useRef(false);
  const count = images.length;
  if (count === 0) return null;
  const current = images[Math.min(active, count - 1)]!;
  const previous = () => setActive((index) => (index - 1 + count) % count);
  const next = () => setActive((index) => (index + 1) % count);
  const alt = current.alt?.trim() || `${label} image`;
  const fitClass = imageFit === 'contain' ? 'object-contain' : 'object-cover';
  // Fall back to the same image's thumbnail candidate when the primary URL
  // fails, mirroring how the bookmark carousel resolves provider images. Once
  // the primary AND its thumbnail have both failed we show a neutral
  // placeholder instead of a broken-image glyph.
  const currentUrl =
    failed.has(current.url) && current.thumbnailUrl ? current.thumbnailUrl : current.url;
  const imageFailed = failed.has(currentUrl);
  const onError = () => {
    if (!failed.has(currentUrl)) setFailed((prev) => new Set(prev).add(currentUrl));
  };
  const unavailable = (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-400">
      <ImageIcon className="h-7 w-7" aria-hidden="true" />
      <span className="text-xs">Image unavailable</span>
    </div>
  );
  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStart.current = { x: touch.clientX, y: touch.clientY };
    swipedRef.current = false;
  };
  // Commit only clearly horizontal drags, so vertical page scrolling and taps
  // keep working untouched. Wrapping matches the arrow buttons' first/last
  // behavior. A trailing click after a swipe is suppressed so it never opens
  // the lightbox mid-gesture.
  const onTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
    swipedRef.current = true;
    if (dx < 0) next();
    else previous();
  };

  if (count === 1) {
    return (
      <>
        <button
          type="button"
          aria-label={`Open ${label} image viewer`}
          onClick={() => setLightboxIndex(0)}
          className="block h-full w-full cursor-zoom-in bg-slate-100"
        >
          {imageFailed ? (
            unavailable
          ) : (
            <img
              src={currentUrl}
              alt={alt}
              loading="lazy"
              onError={onError}
              className={`h-full w-full object-center ${fitClass}`}
            />
          )}
        </button>
        {lightboxIndex !== null && (
          <QuotationLightbox
            images={images}
            index={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onIndexChange={setLightboxIndex}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div
        className="group relative h-full w-full touch-pan-y overflow-hidden bg-slate-100"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <button
          type="button"
          aria-label={`Open ${label} image viewer`}
          onClick={() => {
            // Ignore the click that can trail a swipe so it never opens the viewer.
            if (swipedRef.current) {
              swipedRef.current = false;
              return;
            }
            setLightboxIndex(active);
          }}
          className="block h-full w-full cursor-zoom-in"
        >
          {imageFailed ? (
            unavailable
          ) : (
            <img
              src={currentUrl}
              alt={alt}
              loading="lazy"
              onError={onError}
              className={`h-full w-full object-center ${fitClass}`}
            />
          )}
        </button>
        {/* Subtle edge gradients keep the slim chevrons legible on any photo. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-black/30 via-black/10 to-transparent opacity-60 transition-opacity duration-300 group-hover:opacity-100"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-black/30 via-black/10 to-transparent opacity-60 transition-opacity duration-300 group-hover:opacity-100"
        />
        <button
          type="button"
          aria-label={`Previous ${label.toLowerCase()} image`}
          onClick={previous}
          className="absolute inset-y-0 left-0 flex w-12 items-center justify-start pl-3 opacity-80 transition-opacity duration-300 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 group-hover:opacity-100"
        >
          <ChevronLeft className="h-8 w-8 text-white drop-shadow-md" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Next ${label.toLowerCase()} image`}
          onClick={next}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-end pr-3 opacity-80 transition-opacity duration-300 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 group-hover:opacity-100"
        >
          <ChevronRight className="h-8 w-8 text-white drop-shadow-md" aria-hidden="true" />
        </button>
        <p className="absolute bottom-2 right-3 rounded-full bg-black/45 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-white">
          {active + 1} / {count}
        </p>
      </div>
      {lightboxIndex !== null && (
        <QuotationLightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </>
  );
}

/**
 * Single shared media frame for every weblink image card (Hotels,
 * Transportation, Cruise, Sightseeing activities). Enforces one fixed
 * 16:9 aspect ratio so source image dimensions/aspect ratios never change the
 * displayed card height. Images are cropped with object-fit: cover; the
 * carousel arrows and "1 / N" counter stay anchored inside the fixed frame.
 */
function QuotationMediaFrame({
  images,
  imageUrl,
  label,
  imageAlt,
  placeholder,
  radius = 'rounded-xl',
  className,
  imageFit = 'cover',
  'aria-label': ariaLabel,
  firstOnly = false,
}: {
  images: QuotationGalleryImage[];
  imageUrl?: string | null;
  /** Carousel button label + fallback alt (e.g. "Hotel", "Cruise"). */
  label: string;
  /** Alt text for the single direct image (usually the item name). */
  imageAlt?: string;
  placeholder?: ReactNode;
  radius?: string;
  className?: string;
  /** `contain` letterboxes the whole image instead of cropping to the frame. */
  imageFit?: 'cover' | 'contain';
  'aria-label'?: string;
  /** PDF mode: render only the first gallery image, no carousel controls. */
  firstOnly?: boolean;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const shownImages = firstOnly ? images.slice(0, 1) : images;
  const lightboxImages = imageUrl
    ? [imageAlt ? { url: imageUrl, alt: imageAlt } : { url: imageUrl }]
    : [];
  // PDF mode with no image at all renders nothing: a 16:9 placeholder void
  // would waste print space with no recovery value (no retries/lightbox).
  if (firstOnly && shownImages.length === 0 && !imageUrl) return null;
  return (
    <div
      aria-label={ariaLabel}
      className={`weblink-media-frame relative aspect-[16/9] w-full overflow-hidden bg-slate-100 ${radius} ${className ?? ''}`}
    >
      {shownImages.length > 0 ? (
        firstOnly ? (
          <img
            src={shownImages[0]!.url}
            alt={shownImages[0]!.alt || imageAlt || label}
            className={`h-full w-full object-center ${imageFit === 'contain' ? 'object-contain' : 'object-cover'}`}
          />
        ) : (
          <QuotationImageCarousel images={shownImages} label={label} imageFit={imageFit} />
        )
      ) : imageUrl ? (
        <button
          type="button"
          aria-label={`Open ${label} image viewer`}
          onClick={() => setLightboxOpen(true)}
          className="block h-full w-full cursor-zoom-in"
        >
          <img
            src={imageUrl}
            alt={imageAlt ?? label}
            loading="lazy"
            className={`h-full w-full object-center ${
              imageFit === 'contain' ? 'object-contain' : 'object-cover'
            }`}
          />
        </button>
      ) : (
        <div className="flex h-full w-full items-center justify-center">{placeholder}</div>
      )}
      {lightboxOpen && lightboxImages.length > 0 && (
        <QuotationLightbox
          images={lightboxImages}
          index={0}
          onClose={() => setLightboxOpen(false)}
          onIndexChange={() => undefined}
        />
      )}
    </div>
  );
}

export function PublicQuotationPage() {
  const { token = '', slug = '' } = useParams();
  // Static PDF rendering mode for Weblink PDF generation (`/q/:token?pdf=weblink`):
  // same data and components, with navigation hidden, policies/FAQs expanded
  // and first-image galleries. Telemetry is skipped in this mode.
  const pdfMode =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('pdf') === 'weblink';
  // Friendly `travelagencycrm.in/<slug>` alias vs the legacy `/q/<token>` path.
  // Both render this same page; only the API endpoint differs.
  const isSlug = Boolean(slug);
  const identifier = isSlug ? slug : token;
  // Optional short-lived staff-view signal minted by the CRM when a signed-in
  // employee opens the weblink from this (possibly cross-domain) public host.
  // It only affects HOME/EXTERNAL analytics classification; customer links
  // never carry it.
  const staffViewToken = new URLSearchParams(window.location.search).get('stv') ?? undefined;
  const publicPath =
    (isSlug
      ? `/api/public/quotations/by-slug/${encodeURIComponent(slug)}`
      : `/api/public/quotations/${encodeURIComponent(token)}`) +
    (staffViewToken ? `?stv=${encodeURIComponent(staffViewToken)}` : '');
  const [data, setData] = useState<PublicQuotation | null>(null);
  const [error, setError] = useState('');
  // Company logo becomes the browser-tab favicon once the quotation loads;
  // restored to the default when the data has no logo or the page unmounts.
  useFavicon(data?.company.logoUrl);
  // Tab title mirrors the quotation title once loaded (fallback: "Quotation").
  useDocumentTitle(data?.version.title);
  useEffect(() => {
    void publicRequest<PublicQuotation>(publicPath)
      .then((value) => {
        setData(value);
      })
      .catch((value: unknown) =>
        setError(value instanceof Error ? value.message : 'Quotation unavailable.'),
      );
  }, [publicPath]);

  // Best-effort visitor telemetry: an initial snapshot on load plus a final
  // scroll/time beacon on leave. Fully client-derived (device, screen, locale,
  // referrer, UTM); the server adds IP, User-Agent parsing and geolocation.
  // Skipped in PDF rendering mode so headless generation never pollutes
  // weblink analytics.
  useEffect(() => {
    if (pdfMode || !identifier) return;
    const trackUrl = isSlug
      ? `/api/public/quotations/by-slug/${encodeURIComponent(slug)}/track`
      : `/api/public/quotations/${encodeURIComponent(token)}/track`;
    let maxScroll = 0;
    let wasScrollable = false;
    let ctaClicks = 0;
    // Active (engaged) time: accrues only while the tab is visible, so a
    // backgrounded tab never inflates "time on page".
    let activeMs = 0;
    let lastResume = Date.now();
    const activeSeconds = () => {
      const live = document.visibilityState === 'visible' ? Date.now() - lastResume : 0;
      return Math.round((activeMs + live) / 1000);
    };

    // Stable first-party visitor id so returning visits are recognised.
    let visitorId: string | undefined;
    try {
      const key = 'iq_visitor_id';
      visitorId = window.localStorage.getItem(key) ?? undefined;
      if (!visitorId) {
        visitorId = `v_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        window.localStorage.setItem(key, visitorId);
      }
    } catch {
      visitorId = undefined;
    }

    // Scroll depth only counts when the page actually overflows the viewport;
    // a page that fits reports no scroll rather than a misleading 100%.
    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      if (scrollable <= 0) return;
      wasScrollable = true;
      const pct = Math.round((doc.scrollTop / scrollable) * 100);
      if (pct > maxScroll) maxScroll = Math.min(100, Math.max(0, pct));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // Count meaningful interactions (clicks on links/buttons).
    const onClick = (event: MouseEvent) => {
      const el = event.target as HTMLElement | null;
      if (el?.closest('a,button,[role="button"]')) ctaClicks += 1;
    };
    document.addEventListener('click', onClick, true);

    const collect = () => {
      const nav = navigator as Navigator & {
        deviceMemory?: number;
        connection?: { effectiveType?: string; downlink?: number; rtt?: number };
        userAgentData?: { platform?: string };
      };
      const params = new URLSearchParams(window.location.search);
      const utm = (key: string) => params.get(key) ?? undefined;
      return {
        platform: nav.userAgentData?.platform || navigator.platform || undefined,
        language: navigator.language,
        languages: navigator.languages?.join(', '),
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screenWidth: window.screen?.width,
        screenHeight: window.screen?.height,
        screenAvailWidth: window.screen?.availWidth,
        screenAvailHeight: window.screen?.availHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        pixelRatio: window.devicePixelRatio,
        colorDepth: window.screen?.colorDepth,
        orientation: window.screen?.orientation?.type,
        cpuCores: navigator.hardwareConcurrency,
        deviceMemory: nav.deviceMemory,
        connectionType: nav.connection?.effectiveType,
        connectionDownlink: nav.connection?.downlink,
        connectionRtt: nav.connection?.rtt,
        online: navigator.onLine,
        referrer: document.referrer || undefined,
        landingUrl: window.location.href,
        utmSource: utm('utm_source'),
        utmMedium: utm('utm_medium'),
        utmCampaign: utm('utm_campaign'),
        visitorId,
        // Forward the signed staff-view signal so the server can promote this
        // visit to HOME. Omitted for ordinary customer links.
        staffViewToken,
        // Omit scroll entirely when the page never needed scrolling.
        maxScrollDepth: wasScrollable ? maxScroll : undefined,
        timeOnPageSeconds: activeSeconds(),
        ctaClicks,
      };
    };

    const send = (final: boolean) => {
      const body = JSON.stringify(collect());
      if (final && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(trackUrl, new Blob([body], { type: 'application/json' }));
      } else {
        void fetch(trackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: final,
        }).catch(() => {});
      }
    };

    const initial = window.setTimeout(() => send(false), 900);
    // On hide: bank the active time so far and flush; on show: restart the clock.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        activeMs += Date.now() - lastResume;
        send(true);
      } else {
        lastResume = Date.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const onPageHide = () => {
      if (document.visibilityState === 'visible') activeMs += Date.now() - lastResume;
      send(true);
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.clearTimeout(initial);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      if (document.visibilityState === 'visible') activeMs += Date.now() - lastResume;
      send(true);
    };
  }, [token, slug, isSlug, staffViewToken, pdfMode, identifier]);
  if (error)
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="max-w-md rounded-xl bg-card p-8 text-center shadow">
          <XCircle className="mx-auto h-10 w-10 text-red-600" />
          <h1 className="mt-3 text-xl font-semibold">Quotation unavailable</h1>
          <p className="mt-2 text-[#000000]">{error}</p>
        </div>
      </main>
    );
  if (!data) return <div className="min-h-screen animate-pulse bg-slate-100" />;
  return <PublicQuotationView data={data} pdfMode={pdfMode} />;
}

/**
 * Customer-friendly labels for the shared traveler pricing rows — imported
 * from the shared pricing module so the weblink, Weblink PDF and builder
 * live preview can never drift apart. (`TravelerPriceRow.label` is
 * 'Adults' | 'CWB' | 'CWOB' | 'Infants').
 */
const TRAVELER_BREAKDOWN_LABELS = SHARED_TRAVELER_BREAKDOWN_LABELS;

/**
 * Transparent "explain the total" breakdown shown ONLY for By Traveler
 * (PER_PERSON) pricing. It is additive information that sits alongside the
 * existing Total Package Price card — never a replacement — and reads every
 * value from the single shared pricing resolver so it can never drift from the
 * authoritative total:
 *  - each row's qty/rate/amount comes from `travelerPricing.rows`
 *    (Σ count × rate, zero-count/zero-rate rows already dropped);
 *  - the package subtotal is `travelerPricing.subtotal`;
 *  - discount and tax are applied once, in the same order as the engine;
 *  - the prominent final line is `grandTotal`, exactly the number shown on the
 *    Total Package Price card.
 * Renders nothing for By Section quotations or when no traveler rates exist, so
 * By Section weblinks are completely unchanged.
 */
function TravelerPriceBreakdown({
  pricing,
  fmt,
}: {
  pricing: QuotationPricing;
  fmt: (value: number) => string;
}) {
  if (pricing.pricingMode !== 'PER_PERSON') return null;
  const rows = pricing.travelerPricing.rows;
  // Additional Price Items — flat package charges added on top of the traveler
  // subtotal (never multiplied by the traveler count).
  const customRows = pricing.customItems?.rows ?? [];
  if (!rows.length && !customRows.length) return null;
  // The subtotal only differs from the total when an adjustment is applied, so
  // it is shown only then — never as a second, equal-looking copy of the total.
  const hasAdjustments = pricing.discountAmount !== 0 || pricing.taxAmount !== 0;
  return (
    <section
      data-testid="traveler-price-breakdown"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-xl font-bold text-[#000000]">Price Breakdown</h2>
      {/* Traveller + fixed item rows — clean, borderless lines separated by
          subtle dividers instead of individual grey cards. Rows are rendered in
          the quotation's saved builder order (`pricingRowOrder`), falling back
          to traveler rows then custom items. */}
      <ul className="mt-5 divide-y divide-slate-100">
        {orderPricingRows(
          [
            ...rows.map((row) => ({ id: row.id, kind: 'traveler' as const, row })),
            ...customRows.map((row) => ({ id: row.id, kind: 'custom' as const, row })),
          ],
          pricing.pricingRowOrder,
        ).map(({ id, kind, row }) => (
          <li key={id} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-[#000000]">
                {kind === 'traveler'
                  ? TRAVELER_BREAKDOWN_LABELS[row.label] ?? row.label
                  : row.label}
              </p>
              {kind === 'traveler' && (
                <p className="mt-0.5 text-xs text-slate-500">
                  {row.count} × {fmt(row.price)}
                </p>
              )}
            </div>
            <p
              data-testid="breakdown-amount"
              className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-[#000000]"
            >
              {fmt(kind === 'traveler' ? row.total : row.amount)}
            </p>
          </li>
        ))}
      </ul>
      {hasAdjustments && (
        <div className="mt-2 space-y-2 border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-[#000000]">Package subtotal</span>
            <span className="whitespace-nowrap font-medium tabular-nums text-[#000000]">
              {fmt(pricing.subtotal)}
            </span>
          </div>
          {pricing.discountAmount !== 0 && (
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-[#000000]">Discount</span>
              <span className="whitespace-nowrap tabular-nums text-[#000000]">
                -{fmt(pricing.discountAmount)}
              </span>
            </div>
          )}
          {pricing.taxAmount !== 0 && (
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-[#000000]">
                Tax{pricing.taxRate ? ` (${pricing.taxRate}%)` : ''}
              </span>
              <span className="whitespace-nowrap tabular-nums text-[#000000]">
                {fmt(pricing.taxAmount)}
              </span>
            </div>
          )}
        </div>
      )}
      {/* Final total — solid emerald band, matching the existing green Total
          Package Price card, so the amount is unambiguously the headline. */}
      <div className="mt-4 flex items-center justify-between gap-4 rounded-xl bg-emerald-600 px-4 py-3.5 text-white shadow-sm">
        <span className="text-xs font-semibold uppercase tracking-wide sm:text-sm">
          Total Package Price
        </span>
        <span
          data-testid="breakdown-total-amount"
          className="whitespace-nowrap text-lg font-bold tabular-nums sm:text-xl"
        >
          {fmt(pricing.grandTotal)}
        </span>
      </div>
    </section>
  );
}

/**
 * Pure customer-facing quotation presentation, shared by the public weblink
 * route and the Quotation Builder's full live preview. Everything renders
 * from `data` alone: no fetching, no telemetry, no saves.
 */
export function PublicQuotationView({
  data,
  pdfMode = false,
}: {
  data: PublicQuotation;
  /**
   * Static PDF rendering mode (Weblink PDF): no section navigator or floating
   * controls, every policy/FAQ expanded, first gallery image only. The
   * interactive weblink is unchanged when false.
   */
  pdfMode?: boolean;
}) {
  // Public Policies accordion: only one section is open at a time; Inclusions
  // (or the first non-empty section) starts open.
  const [openPolicy, setOpenPolicy] = useState<string | null>(null);
  const policyDefaultSetRef = useRef(false);
  // Document scope for DOM-reading descendants: the main document on the real
  // weblink, the preview frame's document when portalled into the builder.
  const rootRef = useRef<HTMLElement | null>(null);
  const getOwnerDoc = useCallback(() => rootRef.current?.ownerDocument ?? document, []);
  useEffect(() => {
    if (policyDefaultSetRef.current || !data) return;
    const first = buildPolicySections(data.version).find((section) => section.visible);
    if (first) {
      policyDefaultSetRef.current = true;
      setOpenPolicy(first.key);
    }
  }, [data]);
  const q = data.quotation,
    v = data.version,
    company = data.company;
  const policySections = buildPolicySections(v);
  const color = /^#[0-9a-f]{6}$/i.test(company.primaryColor) ? company.primaryColor : '#2563eb';

  const fmt = (value: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: v.currency,
      maximumFractionDigits: 0,
    }).format(value);
  // Exact (2-decimal) money for the initial-payment sentence, e.g. ₹2,000.00.
  const fmtExact = (value: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: v.currency }).format(value);

  // Draft Hotel Stays added but never named have no valid hotel name — a stay
  // without a name must never render as a hotel card on the weblink.
  // `sourceIndex` is the stay's position in the full hotels array (kept
  // through the named/selected filters below): the builder targets a hotel by
  // that same form position (`hotel:<n>`), so filtering, reorder, add/remove
  // and duplicate names can never mis-target. Never user-visible.
  const namedHotels = v.hotels
    .map((hotel, sourceIndex) => ({ hotel, sourceIndex }))
    .filter(({ hotel }) => (hotel.hotelName ?? '').trim().length > 0);
  const selectedHotels = namedHotels.filter(({ hotel }) => hotel.selected);
  const visibleHotels = selectedHotels.length > 0 ? selectedHotels : namedHotels;
  // Hotels only appear when included in the quotation (hotelDetails.include).
  const hotelIncluded = v.hotelDetails?.include !== false && visibleHotels.length > 0;
  // Hero + profile display texts (overrides or generated defaults) via the
  // single shared resolver — identical for the live preview and the weblink.
  const display = resolveWeblinkDisplay(
    {
      destinations: q.destinations,
      destinationSummary: q.destinationSummary,
      durationNights: q.durationNights,
      travelStartDate: q.travelStartDate,
      travelEndDate: q.travelEndDate,
      customerName: q.customerName,
    },
    {
      weblinkHeading: v.weblinkHeading,
      packageHeading: v.packageHeading,
      weblinkDurationText: v.weblinkDurationText,
      weblinkProfileDestination: v.weblinkProfileDestination,
    },
  );

  const travelers = [
    q.adults && `${q.adults} Adult${q.adults > 1 ? 's' : ''}`,
    q.childrenWithBed && `${q.childrenWithBed} CWB`,
    q.childrenWithoutBed && `${q.childrenWithoutBed} CWOB`,
    q.infants && `${q.infants} Infant${q.infants > 1 ? 's' : ''}`,
  ]
    .filter(Boolean)
    .join(', ');
  // Child ages from the Lead — shared with the PDF via the same quotation
  // columns. Null/empty for legacy data → the age cells are simply omitted.
  const cwbAgesText = formatAgeList(q.childrenWithBedAges);
  const cwobAgesText = formatAgeList(q.childrenWithoutBedAges);
  const infantAgesText = formatInfantAgeList(q.infantAges);

  const pricing = resolveQuotationPricing({ version: v, quotation: q });
  // Single authoritative total from the shared pricing engine: the ACTIVE
  // pricing method's subtotal with the discount → tax pipeline applied.
  // Section-wise and traveler-wise amounts are never added together.
  const displayTotal = pricing.grandTotal;
  // A discount only exists for a real, positive reduction. Zero, absent and
  // negative (surcharge) values all fall back to the clean, single-price card.
  const hasDiscount = pricing.discountAmount > 0;
  // Pre-discount payable, derived from the authoritative pipeline — never
  // recomputed — so `originalTotal - discountAmount === grandTotal` holds to the
  // cent and the discount can never be applied twice or shown inconsistently.
  const originalTotal = pricing.grandTotal + pricing.discountAmount;
  // Public tax note: never the control values ("Do not show" / the sentinel).
  const taxNoteText = isPublicTaxNote(v.taxNote) ? v.taxNote.trim() : null;
  // "Secure Your Booking Now" shows only with a real amount AND a valid link.
  const initialAmount = Number(v.initialPaymentAmount ?? 0);
  const rawPaymentLink = v.paymentLink?.trim() ?? '';
  const validPaymentLink = /^https?:\/\//i.test(rawPaymentLink) ? rawPaymentLink : null;
  const showSecureBooking = initialAmount > 0 && Boolean(validPaymentLink);
  const showVisa =
    v.includeVisa &&
    (Number(v.visaAmount ?? 0) > 0 ||
      Number(v.visaServiceCharge ?? 0) > 0 ||
      Boolean(v.visaType) ||
      Boolean(v.visaDestination));

  const svcOf = (type: string) => v.services.filter((service) => service.serviceType === type);
  const cruises = svcOf('CRUISE');
  const vehicles = svcOf('VEHICLE_TRANSFER');
  // Add-ons only appear when the top-level Add-on Services include flag is on
  // AND the individual Add-on row is actually selected (linked to an Add-on
  // master). Rows present without an addOnServiceId are not included.
  const addOnIncluded = v.addOnDetails?.include !== false;
  const addonServices = addOnIncluded
    ? v.services.filter(
        (service) => ADDON_SERVICE_TYPES.has(service.serviceType) && service.addOnServiceId != null,
      )
    : [];
  // Reference "Flight Details" — every flight record in order, each with
  // its own journeys. Legacy single-flight rows normalize into one record.
  const fd = v.flightDetails;
  const flightJourneys = buildFlightLegs(fd);
  const segmentHasData = flightSegmentHasData;
  const hasFlights =
    (fd?.include &&
      fd.entryMode === 'IMAGE' &&
      Boolean(data.flightImages?.length || data.flightImageUrl)) ||
    flightJourneys.some((leg) => (leg.journey?.segments ?? []).some(segmentHasData));
  const sightseeingDays =
    v.sightseeingDetails?.include !== false ? (v.sightseeingDetails?.days ?? []) : [];
  // Sightseeing is included when at least one valid day exists (a title or a
  // named/described activity), matching the itinerary-section validity rule.
  // A legacy SIGHTSEEING service row is kept as a backward-compatible fallback.
  const validSightseeingDays = sightseeingDays.filter(
    (day) =>
      day.title || (day.activities ?? []).some((activity) => activity.name || activity.description),
  );
  const hasSightseeing = validSightseeingDays.length > 0 || svcOf('SIGHTSEEING').length > 0;
  // Services actually included in this quotation, as separate cards. Each key
  // maps to a labelled card with a dedicated icon (fallback icon for unknowns).
  const includedServices: ServiceCard[] = [];
  const addService = (key: string, label: string) => includedServices.push({ key, label });
  if (hasFlights) addService('flights', 'Flights');
  if (hotelIncluded) addService('hotels', 'Hotels');
  if (hasSightseeing) addService('sightseeing', 'Sightseeing');
  if (cruises.length > 0) addService('cruise', 'Cruise');
  if (vehicles.length > 0) addService('transportation', 'Transportation');
  if (showVisa) addService('visa', 'Visa');
  if (addonServices.length > 0) addService('add-ons', 'Add-ons');

  const preparedByName = v.createdBy?.fullName ?? '';
  // Profile information card: automatic values resolved from the quotation,
  // then per-item label/value/visibility overrides applied. Display-only.
  const resolvedProfile = resolveWeblinkProfile({
    autoValues: {
      travelerName: q.customerName ?? '',
      travelDate: dateShort(q.travelStartDate) ?? 'Flexible',
      duration: display.durationText ?? 'As advised',
      travelers,
      cwbAges: cwbAgesText ?? '',
      cwobAges: cwobAgesText ?? '',
      infantAges: infantAgesText ?? '',
      quotationId: formatPublicQuotationNumber(q.quotationNumber),
      destinations: display.profileDestination,
    },
    autoPreparedBy: {
      name: preparedByName,
      phone: company.phone ?? '',
      email: company.email ?? '',
    },
    overrides: v.weblinkProfile,
  });
  // Secondary contact row under the Prepared By label: only present values,
  // separated by a single "|" (never leading/trailing). Uses the resolved
  // (possibly customized) phone/email, never the raw company record.
  const preparedContacts: ReactNode[] = [];
  if (resolvedProfile.preparedBy.phone)
    preparedContacts.push(
      <a
        key="phone"
        href={`tel:${resolvedProfile.preparedBy.phone}`}
        className="text-[#000000] hover:text-[#000000] hover:underline"
      >
        {resolvedProfile.preparedBy.phone}
      </a>,
    );
  if (resolvedProfile.preparedBy.email)
    preparedContacts.push(
      <a
        key="email"
        href={`mailto:${resolvedProfile.preparedBy.email}`}
        className="break-all text-[#000000] hover:text-[#000000] hover:underline"
      >
        {resolvedProfile.preparedBy.email}
      </a>,
    );
  const heroIntroduction = publicHeroIntroduction(v.introduction);

  return (
    <QuotationDocumentContext.Provider value={getOwnerDoc}>
    <main
      ref={rootRef}
      className="flex min-h-screen flex-col bg-slate-100"
      {...(pdfMode ? { 'data-pdf-mode': 'weblink' } : {})}
    >
      <div className="flex-1 pb-16">
        {/* Hero */}
        <header
          className="relative flex min-h-[300px] items-center overflow-hidden bg-slate-900 py-12 text-white sm:min-h-[330px] md:min-h-[380px]"
          style={
            data.heroImageUrl
              ? undefined
              : { background: `linear-gradient(135deg, ${color} 0%, ${color}cc 60%, #0f172a 140%)` }
          }
        >
          {data.heroImageUrl && (
            <>
              <img
                data-testid="public-hero-image"
                src={data.heroImageUrl}
                alt=""
                className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#08162db8] via-[#08162d7a] to-[#08162d38]"
              />
            </>
          )}
          <div className="relative z-10 mx-auto w-full max-w-5xl px-5 text-left md:px-4">
            <h1 className="text-[32px] font-extrabold leading-[1.1] text-white sm:text-[40px] lg:text-[48px] [text-shadow:0_2px_8px_rgba(0,0,0,0.35)]">
              {display.mainHeading}
            </h1>
            {display.durationText && (
              <p className="mt-2 text-[15px] font-medium text-white/85 sm:text-[17px] lg:text-[19px] [text-shadow:0_2px_8px_rgba(0,0,0,0.35)]">
                {display.durationText}
              </p>
            )}
            <p className="mt-2 max-w-2xl text-[16px] font-bold leading-snug text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.35)]">
              {display.subtitle}
            </p>
            {heroIntroduction && (
              <p
                data-testid="public-hero-introduction"
                className="mt-3 max-w-2xl text-[14px] text-white/80 sm:text-[15px] [text-shadow:0_1px_4px_rgba(0,0,0,0.4)]"
              >
                {heroIntroduction}
              </p>
            )}
          </div>
        </header>

        {/* Summary + price cards sit in normal flow below the complete hero. */}
        <div className="mx-auto mt-8 max-w-5xl space-y-6 px-4">
          {/* Summary + price */}
          <section data-preview-section="pricing" className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl bg-card p-6 shadow-lg lg:col-span-2">
              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 md:grid-cols-4">
                {resolvedProfile.items.map((item) => {
                  if (item.hidden) return null;
                  // CWB/CWOB/Infant Ages only appear when they have a value (or
                  // a custom override), so empty optional rows stay out.
                  const optional =
                    item.id === 'cwbAges' || item.id === 'cwobAges' || item.id === 'infantAges';
                  if (optional && !item.value) return null;
                  return (
                    <Info
                      key={item.id}
                      label={item.label}
                      value={item.value}
                      full={item.id === 'destinations'}
                    />
                  );
                })}
                {!resolvedProfile.preparedBy.hidden && resolvedProfile.preparedBy.name && (
                  <div className="sm:col-span-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#000000]">
                      {resolvedProfile.preparedBy.label}
                    </p>
                    <p className="mt-0.5 font-semibold text-[#000000]">
                      {resolvedProfile.preparedBy.name}
                    </p>
                    {preparedContacts.length > 0 && (
                      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-[#000000]">
                        {preparedContacts.map((contact, index) => (
                          <span key={index} className="inline-flex items-center gap-x-1.5">
                            {index > 0 && <span aria-hidden="true">|</span>}
                            {contact}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="relative flex flex-col overflow-hidden rounded-2xl bg-emerald-600 bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-700 p-6 text-white shadow-lg">
              <div className="relative flex flex-1 flex-col gap-4">
                <p className="text-center text-sm font-medium uppercase tracking-wide text-white/85">
                  {pricing.pricingMode === 'SECTION_WISE'
                    ? 'Quotation Total'
                    : 'Total Package Price'}
                </p>
                {/* The pricing group (struck-through original price + discount
                    badge on one row, then the final price beneath) is centred
                    as a whole in the space between the heading and the button.
                    Symmetric gaps keep that centring exact and the vertical
                    rhythm consistent as the card stretches to match the profile
                    card on wider layouts. */}
                <div className="flex flex-1 flex-col items-center justify-center gap-1">
                  {hasDiscount && (
                    <div className="flex items-center gap-x-3">
                      <span
                        data-testid="total-original-price"
                        className="whitespace-nowrap text-lg font-semibold text-white/60 line-through decoration-white/50 decoration-2"
                      >
                        {fmt(originalTotal)}
                      </span>
                      <span
                        data-testid="total-discount-badge"
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-200 px-3 py-1 text-sm font-bold text-emerald-900 shadow-sm"
                      >
                        <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                        {fmt(pricing.discountAmount)} OFF
                      </span>
                    </div>
                  )}
                  <p
                    data-testid="total-final-price"
                    className="text-center text-4xl font-extrabold tracking-tight"
                  >
                    {fmt(displayTotal)}
                  </p>
                  {taxNoteText && (
                    <p className="text-center text-xs italic text-white/80">{taxNoteText}</p>
                  )}
                </div>
                {company.phone && (
                  <a
                    href={`tel:${company.phone}`}
                    className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 font-semibold text-[#000000] shadow-sm transition-colors hover:bg-slate-50"
                  >
                    <Phone className="h-4 w-4" /> Contact Now
                  </a>
                )}
              </div>
            </div>
          </section>

          {/* By Traveler pricing only: transparent, additive breakdown that
              explains the Total Package Price above. By Section is untouched
              and keeps its own Price Breakdown section below. */}
          <TravelerPriceBreakdown pricing={pricing} fmt={fmt} />

          {(() => {
            // Price Breakdown renders only for By Section pricing. When By
            // Traveler is selected the section is omitted from the Weblink.
            if (pricing.pricingMode !== 'SECTION_WISE') return null;
            const pricingHeading = v.pricingHeading || 'Price Breakdown';
            const pricingSubheading = v.pricingSubheading?.trim() || null;
            const pricingOrder = Array.isArray(
              (v as { pricingDisplayOrder?: unknown }).pricingDisplayOrder,
            )
              ? ((v as { pricingDisplayOrder?: unknown }).pricingDisplayOrder as string[])
              : null;
            const orderedSections = pricingOrder
              ? [...pricing.sections].sort((a, b) => {
                  const ia = pricingOrder.indexOf(a.id);
                  const ib = pricingOrder.indexOf(b.id);
                  return (ia < 0 ? pricingOrder.length : ia) - (ib < 0 ? pricingOrder.length : ib);
                })
              : pricing.sections;
            return (
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-bold text-[#000000]">{pricingHeading}</h2>
                {pricingSubheading ? (
                  <p className="mt-1 text-sm text-[#000000]">{pricingSubheading}</p>
                ) : null}
                  <div className="mt-5 space-y-3">
                    {orderedSections
                      .filter((s) => s.amount > 0)
                      .map((s) => {
                        if (s.id === 'flight') {
                          const breakdown = getFlightPerTravelerBreakdown(
                            (v as unknown as { flightDetails?: unknown }).flightDetails,
                            {
                              adults: q.adults,
                              childrenWithBed: q.childrenWithBed,
                              childrenWithoutBed: q.childrenWithoutBed,
                              infants: q.infants,
                            },
                          );
                          if (breakdown) {
                            return (
                              <div key={s.id} className="space-y-2">
                                <div className="flex items-center justify-between gap-4 text-sm font-semibold text-[#000000]">
                                  <span>Flights</span>
                                  <span>{fmt(s.amount)}</span>
                                </div>
                                {breakdown.map((row) => (
                                  <div key={row.label} className="flex items-center justify-between gap-4 text-sm">
                                    <span className="text-[#000000]">
                                      {row.label}: {row.count} × {fmt(row.rate)}
                                    </span>
                                    <span className="font-medium text-[#000000]">{fmt(row.total)}</span>
                                  </div>
                                ))}
                                <div className="flex items-center justify-between gap-4 border-t pt-2 text-sm font-bold text-[#000000]">
                                  <span>Flight Total</span>
                                  <span>{fmt(s.amount)}</span>
                                </div>
                              </div>
                            );
                          }
                        }
                        return (
                          <div key={s.id} className="space-y-1">
                            <div className="flex items-center justify-between gap-4 text-sm">
                              <span className="font-medium text-[#000000]">{s.label}</span>
                              <span className="font-semibold text-[#000000]">{fmt(s.amount)}</span>
                            </div>
                            {(s as { description?: string | null }).description ? (
                              <p className="text-xs text-[#000000]">{(s as { description?: string | null }).description}</p>
                            ) : null}
                          </div>
                        );
                      })}
                    {(pricing.discountAmount !== 0 || pricing.taxAmount !== 0) && (
                      <div className="flex items-center justify-between border-t pt-3 text-sm font-semibold text-[#000000]">
                        <span>Subtotal</span>
                        <span>{fmt(pricing.sectionTotal)}</span>
                      </div>
                    )}
                    {pricing.discountAmount !== 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[#000000]">Discount</span>
                        <span>-{fmt(pricing.discountAmount)}</span>
                      </div>
                    )}
                    {pricing.taxAmount !== 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[#000000]">
                          Tax{pricing.taxRate ? ` (${pricing.taxRate}%)` : ''}
                        </span>
                        <span>{fmt(pricing.taxAmount)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t-2 border-slate-900 pt-3 text-base font-bold text-[#000000]">
                      <span>Grand Total</span>
                      <span>{fmt(displayTotal)}</span>
                    </div>
                  </div>
              </section>
            );
          })()}

          {/* Secure Your Booking Now — only with a real initial amount and link. */}
          {showSecureBooking && validPaymentLink && (
            <section className="flex flex-col items-start gap-5 rounded-md border border-slate-200 bg-white p-7 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <div className="min-w-0">
                <h2 className="text-2xl font-bold text-[#000000]">Secure Your Booking Now</h2>
                <p className="mt-2 text-base text-[#000000]">
                  Make an initial payment of{' '}
                  <span className="font-semibold text-[#000000]">{fmtExact(initialAmount)}</span> to
                  confirm your booking.
                </p>
                <p className="mt-1 text-[15px] text-[#000000]">
                  The remaining balance can be paid as per the payment policy.
                </p>
              </div>
              <a
                href={validPaymentLink}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Pay Now — opens the secure payment page in a new tab"
                className="inline-flex shrink-0 items-center gap-2 rounded-md bg-emerald-600 px-6 py-[14px] font-semibold text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 sm:self-center"
              >
                <Lock className="h-5 w-5" aria-hidden="true" /> Pay Now
              </a>
            </section>
          )}

          {/* Quick navigation to the sections present in this quotation. */}
          {!pdfMode && v.showQuickNav !== false && <SectionNav sticky={v.quickNavSticky ?? false} />}

          {/* Weblink sections — rendered in custom order when configured, otherwise default order. Empty sections stay hidden. */}
          {(() => {
            const faqsNormalized = normalizeFaqs((v as unknown as { faqs?: unknown }).faqs);
            const rawOrder = (v as unknown as { weblinkSectionOrder?: unknown })
              .weblinkSectionOrder;
            const order = resolveWeblinkSectionOrder(rawOrder);
            const nodes: Record<string, ReactNode> = {};
            nodes['services'] =
              includedServices.length > 0 ? (
                <section>
                  <SectionTitle>Services Include</SectionTitle>
                  <div className="weblink-services-grid grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {includedServices.map((service) => {
                      const Icon = serviceCardIcon(service.key);
                      return (
                        <article
                          key={service.key}
                          className="flex flex-col items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white p-5 text-center shadow-sm"
                        >
                          <Icon className="h-8 w-8 text-emerald-600" aria-hidden="true" />
                          <span className="font-medium text-[#000000]">{service.label}</span>
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null;
            nodes['destinationExpert'] = data.destinationExpert ? (
              <DestinationExpertSection
                expert={data.destinationExpert}
                customerName={q.customerName}
                destinationSummary={q.destinationSummary}
                destinations={q.destinations ?? null}
                quotationId={q.quotationNumber}
                quotationTitle={v.title}
              />
            ) : null;
            nodes['itinerary'] =
              sightseeingDays.length > 0 ? (
                <SightseeingItineraryView
                  days={sightseeingDays}
                  color="#16a34a"
                  images={data.sightseeingPresentations ?? {}}
                  documentImages={data.sightseeingDocumentPresentations ?? {}}
                  description={v.sightseeingDetails?.description ?? null}
                  destinationImage={data.heroImageUrl ?? null}
                  fmt={fmt}
                  pricingMode={pricing.pricingMode}
                  sectionTitle={v.sightseeingDetails?.sectionTitle ?? null}
                  pdfMode={pdfMode}
                />
              ) : null;
            nodes['hotels'] = hotelIncluded ? (
              <section>
                <SectionTitle>{publicHotelSectionTitle(v.hotelDetails?.sectionTitle)}</SectionTitle>
                <div className="grid gap-5">
                  {visibleHotels.map(({ hotel, sourceIndex }, hotelIndex) => {
                    // Resolve the stay's master presentation by row id when
                    // saved, else by master id for a not-yet-saved stay, so the
                    // unsaved preview shows the same stars/score/address/review
                    // link the weblink shows after saving. See `hotelPresentationKey`.
                    const presentationKey = hotelPresentationKey(hotel);
                    const presentation = presentationKey
                      ? data.hotelPresentations?.[presentationKey]
                      : undefined;
                    const perStayImages = quotationGalleryImages(hotel.images);
                    const sectionImages = quotationGalleryImages(v.hotelDetails?.images);
                    const perStaySnapshotPresent =
                      (hotel as { imageSnapshotPresent?: boolean }).imageSnapshotPresent === true ||
                      perStayImages.length > 0;
                    const snapshotImages = perStaySnapshotPresent ? perStayImages : sectionImages;
                    const snapshotPresent = perStaySnapshotPresent || sectionImages.length > 0;
                    const snapshotImageUrl = snapshotImages[0]?.url ?? null;
                    const cardImageUrl = snapshotPresent
                      ? snapshotImageUrl
                      : (presentation?.imageUrl ?? snapshotImageUrl);
                    const category = presentation?.starCategory ?? 0;
                    const reviewScore = Number(presentation?.starRating);
                    const showScore = Number.isFinite(reviewScore) && reviewScore > 0;
                    const rawReviewLink = presentation?.reviewLink?.trim() ?? '';
                    const reviewUrl = /^https?:\/\//i.test(rawReviewLink) ? rawReviewLink : null;
                    const nights =
                      hotelStayNights(hotel.checkInDate, hotel.checkOutDate) ?? hotel.nights;
                    return (
                      // Stable internal anchor for live-preview deep-linking
                      // (see `namedHotels` above). Never user-visible.
                      <article
                        // Saved stays keep their persisted id (stable across
                        // reorder); a not-yet-saved stay has none, so fall back
                        // to its stable source position to stay unique.
                        key={hotel.id ?? `hotel-${sourceIndex}`}
                        data-preview-item={`hotel:${sourceIndex}`}
                        className="weblink-hotel-card overflow-hidden rounded-xl border bg-card shadow-sm sm:grid sm:grid-cols-[42%_1fr]"
                      >
                        <QuotationMediaFrame
                          images={snapshotImages}
                          imageUrl={cardImageUrl}
                          label="Hotel"
                          imageAlt={hotel.hotelName}
                          firstOnly={pdfMode}
                          className="sm:self-start"
                          placeholder={
                            <div className="text-center text-[#000000]">
                              <Building2 className="mx-auto h-12 w-12" />
                              <p className="mt-2 text-xs">Hotel image unavailable</p>
                            </div>
                          }
                        />
                        <div className="p-5">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                            <div className="min-w-0">
                              <h3 className="text-xl font-bold leading-tight text-[#000000]">
                                {hotel.hotelName}
                              </h3>
                              {category > 0 && (
                                <div
                                  className="mt-1.5 flex gap-0.5"
                                  aria-label={`${category} star hotel`}
                                >
                                  {Array.from({ length: Math.min(5, category) }, (_, index) => (
                                    <Star
                                      key={index}
                                      className="h-4 w-4 fill-amber-400 text-amber-400"
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                            {reviewUrl ? (
                              <a
                                href={reviewUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 self-start text-xs font-medium text-blue-600 hover:underline sm:mt-1 sm:shrink-0"
                              >
                                Hotel Review <ExternalLink className="inline h-3 w-3" />
                                {showScore && (
                                  <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
                                    {presentation?.starRating}
                                  </span>
                                )}
                              </a>
                            ) : null}
                          </div>

                          {presentation?.address?.trim() && (
                            <p className="mt-1.5 text-sm text-[#000000]">
                              {presentation.address.trim()}
                            </p>
                          )}

                          <div className="mt-4 text-[#000000]">
                            {(() => {
                              // Room and meal-plan details render from the
                              // resolved line arrays so the first allocation
                              // shows in the live preview before save, and any
                              // number of configured rooms or meal plans is
                              // supported. Unconfigured placeholders are
                              // skipped rather than shown as empty rows.
                              const roomLines = resolveHotelRoomLines(hotel).filter(
                                (line) =>
                                  Boolean((line.roomType ?? '').trim()) ||
                                  Boolean(line.hotelRoomTypeId) ||
                                  line.extraBedQuantity != null ||
                                  line.childWithoutBedQuantity != null,
                              );
                              const mealLines = resolveHotelMealPlanLines(hotel).filter(
                                (line) =>
                                  Boolean((line.mealPlan ?? '').trim()) ||
                                  Boolean(line.hotelMealPlanId),
                              );
                              return (
                                <>
                                  {roomLines.length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        Rooms
                                      </p>
                                      {/* Compact rows on a plain background: a
                                          thin divider between every room, never
                                          pills or panels. */}
                                      <div className="mt-1.5 divide-y divide-slate-200 border-t border-slate-200 text-sm">
                                        {roomLines.map((line, lineIndex) => (
                                          <div
                                            key={`room-line-${lineIndex}`}
                                            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 py-2"
                                          >
                                            <span className="font-semibold">
                                              {(line.roomType ?? '').trim() || 'Room'}
                                            </span>
                                            <span className="flex items-baseline gap-x-6 tabular-nums">
                                              {line.rooms != null && (
                                                <span>
                                                  {line.rooms} {line.rooms === 1 ? 'room' : 'rooms'}
                                                </span>
                                              )}
                                              {line.extraBedQuantity != null &&
                                                line.extraBedQuantity > 0 && (
                                                  <span>Extra bed: {line.extraBedQuantity}</span>
                                                )}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {/* Meal Plan always sits on its own full-width
                                      line below the room list, one compact row
                                      per configured plan, never beside the
                                      rooms. */}
                                  {mealLines.length > 0 && (
                                    <div className="mt-4 w-full">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        Meal Plan
                                      </p>
                                      <div className="mt-1.5 divide-y divide-slate-200 border-t border-slate-200 text-sm">
                                        {mealLines.map((line, lineIndex) => (
                                          <div
                                            key={`meal-line-${lineIndex}`}
                                            className="py-2 font-medium"
                                          >
                                            {(line.mealPlan ?? '').trim()}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>

                          {(hotel.rooms != null || nights != null) && (
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                              {hotel.rooms != null ? (
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-[#000000]">
                                  <strong className="text-xs font-medium uppercase tracking-wide text-[#000000]">
                                    Rooms:
                                  </strong>
                                  {' '}
                                  {hotel.rooms}
                                </span>
                              ) : null}
                              {nights != null && (
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white">
                                  <strong className="text-xs font-medium uppercase tracking-wide text-white/85">
                                    Nights:
                                  </strong>
                                  {' '}
                                  {nights}
                                </span>
                              )}
                            </div>
                          )}

                          <div className="mt-4 grid gap-1.5 text-sm text-[#000000] sm:grid-cols-2">
                            {dateShort(hotel.checkInDate) ? (
                              <p>
                                <strong className="font-semibold text-[#000000]">
                                  Check-in:
                                </strong>{' '}
                                {dateShort(hotel.checkInDate)}
                                {hotel.checkInTime?.trim()
                                  ? ` · ${formatTime12Hour(hotel.checkInTime)}`
                                  : ''}
                              </p>
                            ) : null}
                            {dateShort(hotel.checkOutDate) ? (
                              <p>
                                <strong className="font-semibold text-[#000000]">
                                  Check-out:
                                </strong>{' '}
                                {dateShort(hotel.checkOutDate)}
                                {hotel.checkOutTime?.trim()
                                  ? ` · ${formatTime12Hour(hotel.checkOutTime)}`
                                  : ''}
                              </p>
                            ) : null}
                          </div>

                          {hotel.notes && (
                            <p className="mt-3 text-xs italic text-[#000000]">{hotel.notes}</p>
                          )}
                          {hotelIndex === 0 && v.hotelDetails?.description && (
                            <div
                              className="mt-4 flex items-start gap-2 border-t pt-3"
                              aria-label="Hotel description"
                            >
                              <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                              <div className="min-w-0 flex-1 [&_p]:mr-4 [&_p]:inline-block">
                                <RichHtml html={v.hotelDetails.description} />
                              </div>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null;
            nodes['flights'] = hasFlights ? (
              <section>
                <SectionTitle>{fd?.sectionTitle || 'Flight Details'}</SectionTitle>
                {fd?.entryMode === 'IMAGE' && (data.flightImages?.length || data.flightImageUrl) ? (
                  <FlightImageViewer
                    firstOnly={pdfMode}
                    images={
                      data.flightImages?.length
                        ? data.flightImages
                        : [{ description: null, url: data.flightImageUrl! }]
                    }
                  />
                ) : (
                  <div className="space-y-4">
                    {flightJourneys.map((leg) => (
                      // Stable internal anchor for live-preview deep-linking
                      // (leg keys embed the record position). Layout-neutral
                      // wrapper under the space-y parent. Never user-visible.
                      <div key={leg.key} data-preview-item={`flight:${leg.key}`}>
                        <FlightJourneyView
                          title={leg.title}
                          journey={leg.journey}
                          color={leg.color}
                          airlinePresentations={data.airlinePresentations}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null;
            nodes['transportation'] =
              vehicles.length > 0 ? (
                <section>
                  <SectionTitle>
                    {vehicles[0]?.taxCategory?.trim() || 'Transportation'}
                  </SectionTitle>
                  <div className="grid gap-4 md:grid-cols-2">
                    {vehicles.map((vehicle, vehicleIndex) => {
                      const presentation = data.vehiclePresentations?.[vehicle.id];
                      const snapshotImages = quotationGalleryImages(vehicle.images);
                      const snapshotPresent =
                        (vehicle as { imageSnapshotPresent?: boolean }).imageSnapshotPresent ===
                          true || snapshotImages.length > 0;
                      const displayImages = snapshotImages.length
                        ? snapshotImages
                        : !snapshotPresent && presentation?.imageUrl
                          ? [{ url: presentation.imageUrl, alt: vehicle.name }]
                          : [];
                      return (
                        <article
                          key={vehicle.id ?? `vehicle-${vehicleIndex}`}
                          className="max-w-xl overflow-hidden rounded-xl border bg-card shadow-sm"
                        >
                          <QuotationMediaFrame
                            images={displayImages}
                            label="Vehicle"
                            firstOnly={pdfMode}
                            imageAlt={vehicle.name || presentation?.name || 'Vehicle'}
                            placeholder={
                              <div className="text-center text-[#000000]">
                                <CarFront className="mx-auto h-14 w-14" />
                                <p className="mt-2 text-xs">Vehicle image unavailable</p>
                              </div>
                            }
                          />
                          <div className="space-y-3 p-5">
                            <h3 className="text-xl font-bold text-[#000000]">
                              {vehicle.name || presentation?.name || 'Vehicle'}
                            </h3>
                            <div className="space-y-1 text-sm text-[#000000]">
                              <p>
                                <strong className="text-[#000000]">Type:</strong>{' '}
                                {vehicle.city || presentation?.vehicleType || 'As selected'}
                              </p>
                              {vehicle.notes && (
                                <p>
                                  <strong className="text-[#000000]">Usage:</strong> {vehicle.notes}
                                </p>
                              )}
                              {vehicle.duration && (
                                <p>
                                  <strong className="text-[#000000]">Duration:</strong>{' '}
                                  {vehicle.duration}
                                </p>
                              )}
                            </div>
                            {vehicle.description && <RichHtml html={vehicle.description} />}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null;
            nodes['cruise'] =
              cruises.length > 0 ? (
                <section>
                  <SectionTitle>{cruises[0]?.taxCategory?.trim() || 'Cruise Details'}</SectionTitle>
                  <div className="grid gap-5 md:grid-cols-2">
                    {cruises.map((cruise, cruiseIndex) => {
                      const presentation = data.cruisePresentations?.[cruise.id];
                      const snapshotImages = quotationGalleryImages(cruise.images);
                      const snapshotPresent =
                        (cruise as { imageSnapshotPresent?: boolean }).imageSnapshotPresent ===
                          true || snapshotImages.length > 0;
                      const displayImages = snapshotImages.length
                        ? snapshotImages
                        : !snapshotPresent && presentation?.imageUrl
                          ? [{ url: presentation.imageUrl, alt: cruise.name }]
                          : [];
                      const cruiseNights = (cruise as unknown as { cruiseNights?: number | null }).cruiseNights;
                      const duration = cruiseNights != null && Number(cruiseNights) > 0
                        ? `${cruiseNights} Night${Number(cruiseNights) !== 1 ? 's' : ''} · ${Number(cruiseNights) + 1} Days`
                        : cruise.notes?.trim() || null;
                      const roomLines = resolveCruiseRoomLines(cruise as unknown as Parameters<typeof resolveCruiseRoomLines>[0]);
                      const roomTypeFallback = presentation?.roomTypeName?.trim() || cruise.city?.trim() || null;
                      const rawDescription = cruise.description?.trim() ?? '';
                      const descriptionHasText = Boolean(
                        rawDescription.replace(/<[^>]*>/g, '').trim(),
                      );
                      const showDescription =
                        Boolean(rawDescription) &&
                        descriptionHasText &&
                        !/^https?:\/\/\S+$/i.test(rawDescription);
                      return (
                        <article
                          key={cruise.id ?? `cruise-${cruiseIndex}`}
                          className="overflow-hidden rounded-xl border bg-card shadow-sm"
                        >
                          <QuotationMediaFrame
                            images={displayImages}
                            label="Cruise"
                            firstOnly={pdfMode}
                            imageAlt={cruise.name}
                            placeholder={
                              <div className="flex flex-col items-center justify-center gap-1 text-[#000000]">
                                <Ship className="h-10 w-10" />
                                <p className="text-xs">Cruise image unavailable</p>
                              </div>
                            }
                          />
                          <div className="space-y-2 p-5">
                            <h3 className="text-lg font-bold text-[#000000]">{cruise.name}</h3>
                            {duration && (
                              <p className="text-sm text-[#000000]">
                                <strong>Duration:</strong> {duration}
                              </p>
                            )}
                            {roomLines.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {roomLines.map((line, lineIndex) => {
                                  const roomType =
                                    (line.roomType ?? '').trim() || roomTypeFallback || 'Room';
                                  const rooms =
                                    line.rooms != null && line.rooms > 0 ? line.rooms : null;
                                  return (
                                    <span key={lineIndex} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-[#000000]">
                                      {roomType}
                                      {rooms != null ? ` · ${rooms} ${rooms === 1 ? 'room' : 'rooms'}` : ''}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : roomTypeFallback ? (
                              <p className="text-sm text-[#000000]">
                                <strong>Room Type:</strong> {roomTypeFallback}
                              </p>
                            ) : null}
                            {showDescription && (
                              <div className="border-t pt-3">
                                <RichHtml html={rawDescription} />
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null;
            nodes['addons'] =
              addonServices.length > 0 ? (
                <section>
                  <SectionTitle>Additional Services</SectionTitle>
                  <div className="grid gap-4 md:grid-cols-2">
                    {addonServices.map((service, serviceIndex) => {
                      const plainText = (service.description ?? '')
                        .replace(/<[^>]*>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                      // Snapshot gallery only (same as every other service card);
                      // there is no live add-on presentation endpoint.
                      const displayImages = quotationGalleryImages(service.images);
                      // Every saved pricing option as a compact tile (same style as
                      // activity pricing): label on the first line, price
                      // beneath it. A quotation-owned snapshot is authoritative —
                      // including an EMPTY one (all options deleted) — so we only
                      // fall back to a single synthesized tile for legacy rows
                      // that carry no snapshot at all.
                      const hasSnapshot = Array.isArray(service.pricingSnapshot);
                      const rawUnitPrice =
                        service.unitSellingPrice != null && service.unitSellingPrice !== ''
                          ? Number(service.unitSellingPrice)
                          : null;
                      const pricingOptions = normalizeAddonPricingSnapshot({
                        id: String(service.id),
                        pricing: hasSnapshot ? service.pricingSnapshot : null,
                        price:
                          !hasSnapshot && rawUnitPrice != null && Number.isFinite(rawUnitPrice)
                            ? rawUnitPrice
                            : null,
                        currency: v.currency,
                        pricingBasis: hasSnapshot ? null : service.pricingBasisLabel,
                      });
                      return (
                        <article
                          key={service.id ?? `addon-${serviceIndex}`}
                          className="min-w-0 overflow-hidden rounded-2xl bg-card p-6 shadow-sm"
                        >
                          {displayImages.length > 0 && (
                            <div className="mb-4">
                              <QuotationMediaFrame
                                images={displayImages}
                                label="Add-on"
                                imageAlt={service.name}
                                imageFit="contain"
                                firstOnly={pdfMode}
                              />
                            </div>
                          )}
                          <h3 className="break-words text-lg font-bold text-[#000000]">{service.name}</h3>
                          {plainText && (
                            <div className="mt-2 min-w-0 [overflow-wrap:anywhere]">
                              <RichHtml html={service.description ?? ''} />
                            </div>
                          )}
                          {pricingOptions.length > 0 && (
                            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {pricingOptions.map((option) => {
                                const amount = formatAddonOptionPrice(option, v.currency);
                                const label = (option.label ?? '').trim();
                                return (
                                  <div
                                    key={option.id}
                                    className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                                  >
                                    {label && (
                                      <p className="break-words text-xs font-medium leading-4 text-[#000000]">
                                        {label}
                                      </p>
                                    )}
                                    {amount != null && (
                                      <p
                                        className={`break-words text-sm font-semibold leading-5 text-[#000000] ${
                                          label ? 'mt-0.5' : ''
                                        }`}
                                      >
                                        {amount}
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null;
            nodes['visa'] = showVisa ? (
              <section className="rounded-2xl bg-card p-6 shadow-sm">
                <h2 className="font-semibold text-[#000000]">{v.visaSectionTitle || 'Visa'}</h2>
                <div className="mt-3 grid gap-2 text-sm text-[#000000] sm:grid-cols-2">
                  {v.visaDestination && (
                    <p>
                      <span className="text-[#000000]">Destination:</span> {v.visaDestination}
                    </p>
                  )}
                  {v.visaType && (
                    <p>
                      <span className="text-[#000000]">Visa type:</span> {v.visaType}
                    </p>
                  )}
                </div>
              </section>
            ) : null;
            nodes['policies'] = (() => {
              const visibleSections = policySections.filter((section) => section.visible);
              if (!visibleSections.length) return null;
              return (
                <section>
                  <SectionTitle>Policies</SectionTitle>
                  <div className="space-y-2">
                    {visibleSections.map((section) => {
                      const open = pdfMode || openPolicy === section.key;
                      return (
                        <div
                          key={section.key}
                          className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
                        >
                          {pdfMode ? (
                            <p className="weblink-policy-heading flex items-center gap-2 px-4 pt-3 text-sm font-semibold text-blue-600">
                              <section.Icon
                                className={`h-4 w-4 shrink-0 ${section.iconClass}`}
                                aria-hidden="true"
                              />
                              {section.label}
                            </p>
                          ) : (
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-controls={`policy-panel-${section.key}`}
                              onClick={() => setOpenPolicy(open ? null : section.key)}
                              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                            >
                              <span className="flex items-center gap-2 text-sm font-semibold text-blue-600">
                                <section.Icon
                                  className={`h-4 w-4 shrink-0 ${section.iconClass}`}
                                  aria-hidden="true"
                                />
                                {section.label}
                              </span>
                              <ChevronDown
                                className={`h-4 w-4 shrink-0 text-[#000000] transition-transform ${
                                  open ? 'rotate-180' : ''
                                }`}
                                aria-hidden="true"
                              />
                            </button>
                          )}
                          {open && (
                            <div
                              id={`policy-panel-${section.key}`}
                              className="border-t py-4 pl-8 pr-4 text-sm text-[#000000]"
                            >
                              {hasPolicyHtml(section.html) ? (
                                <RichHtml html={section.html!} />
                              ) : (
                                <ul className="space-y-1.5">
                                  {section.rows.map((row) => (
                                    <li key={row.id} className="list-inside list-disc">
                                      {row.content}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })();
            nodes['customerNotes'] = hasPolicyHtml(v.notes) ? (
              <section aria-labelledby="customer-notes-heading">
                <SectionTitle>Notes for Customer</SectionTitle>
                <div className="flex gap-4 rounded-xl border border-blue-100 bg-blue-50/70 p-5 shadow-sm">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                    <InfoIcon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div
                    id="customer-notes-heading"
                    className="min-w-0 flex-1 text-sm leading-6 text-[#000000]"
                  >
                    <RichHtml html={v.notes!} />
                  </div>
                </div>
              </section>
            ) : null;
            nodes['faqs'] =
              faqsNormalized.length > 0 ? (
                <FaqSection faqs={faqsNormalized} expandAll={pdfMode} />
              ) : null;
            const renderOrder = order.flatMap((id) =>
              id === 'policies' ? ['customerNotes', id] : [id],
            );
            return (
              <>
                {renderOrder.map((id) => {
                  const node = nodes[id];
                  // Stable anchor for preview deep-linking (e.g. the builder
                  // live preview opens at the active tab's section). The
                  // wrapper is layout-neutral under the space-y parent.
                  return node ? (
                    <div key={id} data-preview-section={id}>
                      {node}
                    </div>
                  ) : null;
                })}
              </>
            );
          })()}

          {/* Contact Us */}
          <PublicQuotationContact
            companyName={company.name}
            contactPerson={preparedByName}
            phone={company.phone}
            gstin={company.taxRegistrationNumber}
            email={company.email}
            address={company.address}
            googleMapsUrl={company.googleMapsUrl ?? null}
            logoUrl={company.logoUrl}
            quotationId={q.quotationNumber}
            quotationTitle={v.title}
            leadName={q.customerName}
          />
        </div>
      </div>

      {!pdfMode && (
        <PublicQuotationFooter
          companyName={company.name}
          operatingSince={company.operatingSince}
          tripsSold={company.tripsSold}
          tan={company.tan}
          quotationNumber={q.quotationNumber}
          generatedAt={q.createdAt}
        />
      )}

      {!pdfMode && <BackToTop />}
    </main>
    </QuotationDocumentContext.Provider>
  );
}
