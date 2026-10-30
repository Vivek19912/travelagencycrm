import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm, useWatch, type FieldPath, type UseFormReturn } from 'react-hook-form';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Eye,
  ImageIcon,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  PERMISSIONS,
  QUOTATION_TAX_NOTE_OPTIONS,
  QUOTATION_TAX_NOTE_HIDDEN,
  SETTINGS_CURRENCIES,
  calculateCruiseRoomLinesTotal,
  calculateFlightTotal,
  calculateHotelRowTotal,
  getFlightPerTravelerBreakdown,
  formatItineraryDayTitle,
  hotelRoomLinesTotalRooms,
  hotelStayNights,
  labelForLookup,
  normalizePricingMode,
  normalizeFlightDetails,
  QUOTATION_BOOKING_TERMS_MAX_LENGTH,
  quotationVersionInputSchema,
  quotationSnapshotImageIdentity,
  resolveHotelMealPlanLines,
  resolveHotelRoomLines,
  resolveQuotationPricing,
  isPublicTaxNote,
  orderPricingRows,
  TRAVELER_PRICING_ROW_IDS,
  DEFAULT_WEBLINK_SECTION_ORDER,
  resolveWeblinkSectionOrder,
  normalizePublicSlug,
  isReservedPublicSlug,
  WEBLINK_PROFILE_FIELD_IDS,
  WEBLINK_PROFILE_FIELD_LABELS,
  MAX_ADD_ON_PRICING_ENTRIES,
  normalizeWeblinkProfileConfig,
  type LiveSearchBookmark,
  type QuotationCruiseRoomLine,
  type QuotationVersionInput,
  type WeblinkProfileFieldId,
} from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { MasterSelect } from '@/components/ui/MasterSelect';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import {
  SightseeingSection,
  emptySightseeingActivity,
  emptySightseeingDay,
  withSightseeingPricingRows,
} from './SightseeingSection';
import { cn } from '@/utils/cn';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  quotationDocumentInlineUrl,
  uploadQuotationAttachment,
  useQuotation,
  useUpdateQuotation,
  useUpdateQuotationVersion,
  useUpdateQuotationWeblinkName,
  useUpdateQuotationWeblinkSettings,
  type QuotationVersion,
} from '@/features/quotations/quotations.api';
import { useSettings } from '@/features/settings/settings.api';
import { useDestinationExpertPresets } from '@/features/destination-expert/destination-expert.api';
import { apiClient } from '@/api/client';
import {
  addOnServiceImageUrl,
  cruiseImageUrl,
  hotelImageUrl,
  useAddOnServices,
  useAirlines,
  useAllDestinations,
  useCreateAirline,
  useCruise,
  useCruises,
  useHotel,
  useHotels,
  useHotelsForDestinations,
  useSightseeingList,
  useVehicles,
  vehicleImageUrl,
  type AddOnServicePricingEntry,
  type MasterImageMeta,
  type Airline,
  type Destination,
  type Page,
  type Sightseeing,
} from '@/features/masters/masters.api';
import { normalizeAddonPricingSnapshot } from '@/features/quotations/addonPricing';
import {
  resolveSightseeingMealPrefill,
  resolveSightseeingMealReplacement,
} from '@/features/quotations/sightseeingMealPrefill';
import { useUsers } from '@/features/users/users.api';
import { useFaqs } from '@/features/masters/masters.api';
import {
  CLEARED_SERVICE_MASTERS,
  HotelMasterFields,
  ServiceMasterFields,
  type HotelRowPatch,
  type ServiceRowPatch,
} from '@/features/quotations/MasterFields';
import {
  HotelBookmarkListField,
  flightBookmarkSegmentAirlines,
  flightBookmarkToDetails,
  hotelBookmarkToDetails,
  normalizeAirlineName,
  resolveFlightSegmentAirlines,
} from '@/features/quotations/BookmarkImport';
import { FlightRecordCard } from './FlightRecordCard';
import { HotelCheckoutDatePicker, HotelDatePicker } from './HotelDatePicker';
import { PinnedLiveQuotationPreview, previewDestinations, previewDurationNights, previewSectionForBuilderTab } from './FullQuotationPreview';
import { resolveWeblinkDisplay, resolveWeblinkProfile } from './PublicQuotationPage';
import { dateShort } from './FlightPublicView';
import { formatPublicQuotationNumber } from './quotationContact';
import { deriveDestinationSummary, repairLegacyItinerary } from './quotationItineraryRepair';
import {
  STANDARD_MEAL_PLANS,
  STANDARD_ROOM_TYPES,
  withStandardOptions,
} from './hotelStandardOptions';
import { withStandardCabinOptions } from './cruiseStandardOptions';

const field =
  'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm h-[38px] shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:border-ring transition-colors';
const fieldMuted = 'w-full rounded-lg bg-muted/60 border border-border/50 px-3 py-2 text-sm font-medium text-foreground h-[38px]';
const calculatedCard = 'rounded-lg bg-muted/50 border border-border/40 px-3 py-2.5';
const calculatedLabel = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const calculatedValue = 'text-sm font-semibold text-foreground';
const subsectionHeading = 'text-xs font-semibold uppercase tracking-widest text-brand-700';
const subsectionHeadingMuted = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground';

type QuotationImage = NonNullable<QuotationVersionInput['services'][number]['images']>[number];

/** Copy ordered, opaque Master image ids immediately (no preview network wait). */
export function masterGallerySnapshot(
  images: MasterImageMeta[] | null | undefined,
  alt: string,
): QuotationImage[] {
  return (images ?? []).map((image, index) => ({
    masterImageId: image.id,
    alt: `${alt} image ${index + 1}`,
  }));
}

/**
 * `undefined` deliberately asks the API to import a linked Master gallery when
 * talking to an older response shape that did not expose ordered image ids.
 */
function masterGalleryPresence(master: { images?: unknown } | null | undefined) {
  if (!master) return false;
  return Array.isArray(master.images) ? true : undefined;
}

/** Best-effort signed previews; opaque refs above remain the source of truth. */
async function importMasterGalleryPreviews(
  masterId: string,
  snapshot: QuotationImage[],
  download: (id: string, imageId?: string) => Promise<{ url: string }>,
): Promise<QuotationImage[]> {
  return Promise.all(
    snapshot.map(async (image) => {
      let url: string | undefined;
      try {
        url = (await download(masterId, image.masterImageId ?? image.id ?? undefined)).url;
      } catch {
        // The opaque Master image id is enough for the API to snapshot it.
        // Preview URL failures must not drop otherwise valid images.
      }
      return {
        ...image,
        ...(url ? { url } : {}),
      };
    }),
  );
}

/** Add finished preview URLs without restoring removed images or stale order. */
export function mergeMasterGalleryPreviews(
  current: QuotationImage[] | null | undefined,
  previewed: QuotationImage[],
): QuotationImage[] {
  const urls = new Map(
    previewed.flatMap((image) => {
      const identity = quotationSnapshotImageIdentity(image);
      return identity && image.url ? [[identity, image.url] as const] : [];
    }),
  );
  return (current ?? []).map((image) => {
    const identity = quotationSnapshotImageIdentity(image);
    const url = identity ? urls.get(identity) : undefined;
    return url ? { ...image, url } : image;
  });
}

/**
 * Register options for money inputs: an empty field coerces to 0 instead of NaN,
 * which would otherwise fail `money.finite()` validation and silently block save.
 */
const MONEY_FIELD = {
  setValueAs: (value: unknown) => {
    if (value === '' || value === null || value === undefined) return 0;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  },
} as const;

/** Tab model. `types` maps a tab to the service rows it owns (Hotel/Inclusions/Summary have their own UI). */
type ServiceType = QuotationVersionInput['services'][number]['serviceType'];
interface TabDef {
  key: string;
  label: string;
  types?: ServiceType[];
}
const ADDON_TYPES: ServiceType[] = [
  'TRAVEL_INSURANCE',
  'RAIL',
  'PASSPORT_ASSISTANCE',
  'MEAL',
  'GUIDE',
  'OTHER_ADD_ON',
  'GENERAL_ENQUIRY',
];
export const CLASS_OPTIONS = ['Economy', 'Premium Economy', 'Business', 'First'];
export const CABIN_LUGGAGE_OPTIONS = ['7kg', '10kg', 'No Cabin Baggage'];
export const CHECKIN_LUGGAGE_OPTIONS = ['0kg', '15kg', '20kg', '23kg', '25kg', '30kg', '40kg+', '46kg'];
// Alternative combinations remain fully supported by the data model and save path.
// Keep this false to hide only the Hotel Options UI until the feature is needed again.
const SHOW_HOTEL_OPTIONS = false;

// Visa is temporarily hidden from the quotation builder UI. Set this back to
// true to restore the Visa tab and panel; all Visa backend/schema/data paths
// are untouched and existing quotations keep their saved Visa values.
const SHOW_VISA_QUOTATION_TAB = false;

// Destination Expert is temporarily hidden from the quotation builder UI.
// Set this back to true to restore the tab and panel; all backend/schema/data
// paths are untouched and existing quotations keep their saved values.
const SHOW_DESTINATION_EXPERT_TAB = false;

/** "Xh Ym" flight duration from date+time strings, or '' if incomputable/negative. */
export const computeDuration = (
  depDate?: string | null,
  depTime?: string | null,
  arrDate?: string | null,
  arrTime?: string | null,
) => {
  if (!depDate || !depTime || !arrDate || !arrTime) return '';
  const dep = new Date(`${depDate}T${depTime}`).getTime();
  const arr = new Date(`${arrDate}T${arrTime}`).getTime();
  if (Number.isNaN(dep) || Number.isNaN(arr)) return '';
  const minutes = Math.round((arr - dep) / 60000);
  if (minutes < 0) return '';
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export const flightTimesAreChronological = (
  depDate?: string | null,
  depTime?: string | null,
  arrDate?: string | null,
  arrTime?: string | null,
) => {
  if (!depDate || !depTime || !arrDate || !arrTime) return true;
  const departure = new Date(`${depDate}T${depTime}`).getTime();
  const arrival = new Date(`${arrDate}T${arrTime}`).getTime();
  return Number.isNaN(departure) || Number.isNaN(arrival) || arrival > departure;
};

const hasInvalidFlightTiming = (details: QuotationVersionInput['flightDetails']) => {
  const journeys = (details?.flights?.length
    ? details.flights.flatMap((flight) => [flight.outbound, flight.returnJourney])
    : [details?.outbound, details?.returnJourney]
  ).filter((journey): journey is NonNullable<typeof journey> => Boolean(journey));
  return journeys.some((journey) =>
    (journey.segments ?? []).some(
      (segment) =>
        !flightTimesAreChronological(
          segment.departureDate,
          segment.departureTime,
          segment.arrivalDate,
          segment.arrivalTime,
        ),
    ),
  );
};

export const FLIGHT_JOURNEY_TYPE_LABELS: Record<string, string> = {
  ROUND_TRIP: 'Round Trip (Outbound + Return)',
  ONEWAY_OUTBOUND: 'One Way - Outbound Only',
  ONEWAY_RETURN: 'One Way - Return Only',
};
type FlightSegmentInput = NonNullable<
  QuotationVersionInput['flightDetails']
>['outbound']['segments'][number];
export const emptySegment = (): FlightSegmentInput => ({
  airlineId: null,
  airlineName: null,
  flightNumber: null,
  travelClass: 'Economy',
  from: null,
  to: null,
  departureDate: null,
  departureTime: '10:00',
  arrivalDate: null,
  arrivalTime: '13:00',
  duration: null,
  cabinLuggage: '7kg',
  checkInLuggage: '20kg',
  notes: null,
  connectionVia: null,
});
type FlightJourneyInput = NonNullable<
  QuotationVersionInput['flightDetails']
>['outbound'];
export type FlightRecordInput = NonNullable<
  NonNullable<QuotationVersionInput['flightDetails']>['flights']
>[number];
const emptyFlightJourney = (): FlightJourneyInput => ({
  fromCity: null,
  toCity: null,
  routeFrom: null,
  routeTo: null,
  travelClass: 'Economy',
  segments: [emptySegment()],
});
/** A blank manual flight record (bookmark loads replace its journeys). */
export const emptyFlightRecord = (): FlightRecordInput => ({
  bookmarkCode: null,
  journeyType: 'ROUND_TRIP',
  outbound: emptyFlightJourney(),
  returnJourney: emptyFlightJourney(),
});

interface HydratableFlightJourney {
  fromCity?: string | null;
  routeFrom?: string | null;
  toCity?: string | null;
  routeTo?: string | null;
  travelClass?: string | null;
  segments?: FlightSegmentInput[];
}
interface HydratableFlightRecord {
  bookmarkCode?: string | null;
  journeyType?: 'ROUND_TRIP' | 'ONEWAY_OUTBOUND' | 'ONEWAY_RETURN';
  outbound?: HydratableFlightJourney;
  returnJourney?: HydratableFlightJourney;
}

/**
 * Rehydrate one saved flight record onto blank defaults. Saved values always
 * win; the independent header route (`routeFrom`/`routeTo`) is preserved
 * verbatim, and legacy records that predate it inherit the saved journey
 * endpoints once — never recomputed afterwards, so later segment edits and
 * re-hydrations leave custom labels alone.
 */
export function hydrateFlightRecord(
  record: HydratableFlightRecord,
  defaults: { outbound: FlightJourneyInput; returnJourney: FlightJourneyInput },
): FlightRecordInput {
  const hydrateJourney = (
    saved: HydratableFlightJourney | undefined,
    fallback: FlightJourneyInput,
  ): FlightJourneyInput => {
    const merged = { ...fallback, ...saved };
    return {
      ...merged,
      routeFrom: saved?.routeFrom ?? saved?.fromCity ?? null,
      routeTo: saved?.routeTo ?? saved?.toCity ?? null,
      segments: saved?.segments?.length ? saved.segments : [emptySegment()],
    };
  };
  return {
    bookmarkCode: record.bookmarkCode ?? null,
    journeyType: record.journeyType ?? 'ROUND_TRIP',
    outbound: hydrateJourney(record.outbound, defaults.outbound),
    returnJourney: hydrateJourney(record.returnJourney, defaults.returnJourney),
  };
}
const defaultFlightDetails = (): NonNullable<QuotationVersionInput['flightDetails']> => ({
  include: true,
  sectionTitle: 'Flight Details',
  amount: 0,
  pricingBasis: 'FIXED_TOTAL',
  perTraveler: { adult: null, childWithBed: null, childWithoutBed: null, infant: null },
  entryMode: 'MANUAL',
  imageDocumentId: null,
  imageFileName: null,
  images: [],
  journeyType: 'ROUND_TRIP',
  outbound: { fromCity: null, toCity: null, routeFrom: null, routeTo: null, travelClass: 'Economy', segments: [emptySegment()] },
  returnJourney: {
    fromCity: null,
    toCity: null,
    routeFrom: null,
    routeTo: null,
    travelClass: 'Economy',
    segments: [emptySegment()],
  },
  flights: [],
});
const defaultHotelDetails = (): NonNullable<QuotationVersionInput['hotelDetails']> => ({
  include: true,
  sectionTitle: 'Your Hotels',
  amount: 0,
  description: null,
  images: [],
});

const VEHICLE_PRICING_BASES: Array<[string, string]> = [
  ['PER_DAY', 'Per Day'],
  ['PER_HOUR', 'Per Hour'],
  ['PER_TRANSFER', 'Per Transfer'],
  ['PER_VEHICLE', 'Per Vehicle'],
  ['FIXED', 'Fixed Total'],
];

const hotelSectionTitle = (value: string | null | undefined) => {
  const title = value?.trim();
  return !title || title === 'Accommodation Details' ? 'Your Hotels' : title;
};

/**
 * Builder-side sightseeing section title. Mirrors the hotel rule: blank
 * values and the previous default (`Sightseeing & Experiences`) become
 * `Your Itinerary`; explicitly configured custom titles pass through.
 */
const sightseeingSectionTitle = (value: string | null | undefined) => {
  const title = value?.trim();
  return !title || title === 'Sightseeing & Experiences' ? 'Your Itinerary' : title;
};

const TABS: TabDef[] = [
  { key: 'sightseeing', label: 'Sightseeing' },
  { key: 'hotel', label: 'Hotel' },
  { key: 'cruise', label: 'Cruise', types: ['CRUISE'] },
  { key: 'vehicle', label: 'Vehicle', types: ['VEHICLE_TRANSFER'] },
  ...(SHOW_VISA_QUOTATION_TAB ? [{ key: 'visa', label: 'Visa' }] : []),
  { key: 'flight', label: 'Flight' },
  { key: 'addon', label: 'Add-on Services', types: ADDON_TYPES },
  { key: 'inclusions', label: 'Inclusions & Exclusions' },
  ...(SHOW_DESTINATION_EXPERT_TAB ? [{ key: 'destinationExpert', label: 'Destination Expert' }] : []),
  { key: 'faqs', label: 'FAQs' },
  { key: 'summary', label: 'Pricing' },
  { key: 'pricingBreakdown', label: 'Pricing Breakdown' },
  { key: 'setting', label: 'Settings' },
];

const WEBLINK_SECTION_LABELS: Record<string, string> = {
  services: 'Services Include',
  destinationExpert: 'Destination Expert',
  itinerary: 'Itinerary',
  hotels: 'Hotels',
  flights: 'Flight Details',
  transportation: 'Transportation',
  cruise: 'Cruise',
  addons: 'Additional Services',
  visa: 'Visa',
  policies: 'Policies',
  faqs: 'FAQs',
};

// Visa and Destination Expert are temporarily hidden in the builder UI, so they
// are excluded from the Weblink Section Order editor. Their ids stay in the
// shared section-order data and public/PDF renderers (existing quotations keep
// working); the editor only hides them and preserves their saved slots.
const HIDDEN_WEBLINK_SECTION_IDS = new Set<string>(['visa', 'destinationExpert']);
const visibleWeblinkSectionOrder = (order: readonly string[]) =>
  order.filter((id) => !HIDDEN_WEBLINK_SECTION_IDS.has(id));

/**
 * Lead-requested services → quotation tab keys. The Lead's selected services are
 * the source of truth for which quotation tabs show the red `*` and which
 * Include-in-Quotation checkboxes default to checked on a NEW quotation.
 * Every service tab is mapped here so no service (Add-on, Cruise, …) is missed.
 */
const SERVICE_TAB_TYPES: Record<string, ServiceType[]> = {
  flight: ['FLIGHT'],
  hotel: ['HOTEL'],
  sightseeing: ['SIGHTSEEING'],
  cruise: ['CRUISE'],
  vehicle: ['VEHICLE_TRANSFER'],
  addon: ADDON_TYPES,
};

/** Map a Lead service type to its quotation tab key, or null. */
export function serviceTypeToTabKey(serviceType: string): string | null {
  for (const [key, types] of Object.entries(SERVICE_TAB_TYPES)) {
    if ((types as string[]).includes(serviceType)) return key;
  }
  return null;
}

/** Set of tab keys requested by the Lead (the tab shows a red `*`). */
export function leadRequestedTabs(
  query: { services?: Array<{ serviceType: string }> } | undefined,
): Set<string> {
  const requested = new Set<string>();
  for (const row of query?.services ?? []) {
    const tab = serviceTypeToTabKey(row.serviceType);
    if (tab) requested.add(tab);
  }
  return requested;
}

/**
 * Initial "Include Flight in Quotation" state.
 *
 * A brand-new version has no saved `flightDetails` (the backend stores null
 * until the first save), so the checkbox defaults from the Lead's requested
 * services — checked only when the lead requested FLIGHT. Once a version is
 * saved, its own `flightDetails.include` is authoritative and this returns
 * null (leave the saved value alone, even if the lead changed since). The
 * checkbox stays fully manual afterwards; this only sets the initial state.
 */
export function defaultFlightInclude(
  savedFlightDetails: unknown,
  leadRequestedFlight: boolean,
): boolean | null {
  if (savedFlightDetails) return null;
  return leadRequestedFlight;
}

const defaults: QuotationVersionInput = {
  title: '',
  introduction: null,
  destinationSummary: '',
  travelStartDate: null,
  travelEndDate: null,
  currency: 'INR',
  pricingMode: 'PER_PERSON',
  pricingHeading: 'Price Breakdown',
  pricingSubheading: null,
  pricingDisplayOrder: undefined,
  pricingRowOrder: undefined,
  markupMode: 'NONE',
  markupValue: 0,
  taxRate: 0,
  discountAmount: 0,
  perAdultPrice: 0,
  perChildWithBedPrice: 0,
  perChildWithoutBedPrice: 0,
  perInfantPrice: 0,
  packageCustomItems: [],
  taxNote: null,
  netAmount: 0,
  initialPaymentAmount: 0,
  paymentLink: null,
  customCharges: [],
  showServiceChargesSeparately: false,
  markServiceChargesOutside: false,
  hidePricing: false,
  showIndividualPricing: false,
  showQuickNav: true,
  quickNavSticky: true,
  inclusionsHtml: null,
  exclusionsHtml: null,
  paymentPolicies: null,
  cancellationPolicies: null,
  bookingTerms: null,
  childPolicy: null,
  includeVisa: true,
  visaSectionTitle: null,
  visaAmount: 0,
  visaDestination: null,
  visaType: null,
  visaServiceCharge: 0,
  visaGstPercent: 0,
  visaVfsCharge: 0,
  flightDetails: defaultFlightDetails(),
  hotelDetails: defaultHotelDetails(),
  addOnDetails: { include: true, sectionTitle: 'Additional Services' },
  sightseeingDetails: {
    include: true,
    sectionTitle: 'Your Itinerary',
    amount: 0,
    description: null,
    days: [emptySightseeingDay(1)],
  },
  notes: null,
  internalNotes: null,
  faqs: [],
  weblinkSectionOrder: null,
  weblinkProfile: null,
  destinationExpertConfig: null,
  itinerary: [],
  hotels: [],
  services: [],
  inclusions: [],
  exclusions: [],
  terms: [],
};
const arrayOrEmpty = <T,>(value: T[] | null | undefined): T[] =>
  Array.isArray(value) ? value : [];
const objectOrNull = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const normalizeImageSnapshot = <T extends object>(row: T) => {
  const raw = row as T & { images?: QuotationImage[] | null; imageSnapshotPresent?: boolean };
  return {
    ...row,
    images: arrayOrEmpty(raw.images),
    imageSnapshotPresent: raw.imageSnapshotPresent ?? Array.isArray(raw.images),
  };
};

export function normalizeQuotationVersionForBuilder(version: QuotationVersion): QuotationVersion {
  const raw = version as QuotationVersion & Record<string, unknown>;
  const flight = objectOrNull(raw.flightDetails);
  const hotelDetails = objectOrNull(raw.hotelDetails);
  const sightseeing = objectOrNull(raw.sightseeingDetails);
  const addOnDetails = objectOrNull(raw.addOnDetails);

  return {
    ...version,
    introduction: typeof raw.introduction === 'string' ? raw.introduction : null,
    weblinkHeading: typeof raw.weblinkHeading === 'string' ? raw.weblinkHeading : null,
    packageHeading: typeof raw.packageHeading === 'string' ? raw.packageHeading : null,
    weblinkDurationText:
      typeof raw.weblinkDurationText === 'string' ? raw.weblinkDurationText : null,
    weblinkProfileDestination:
      typeof raw.weblinkProfileDestination === 'string' ? raw.weblinkProfileDestination : null,
    weblinkProfile: (objectOrNull(raw.weblinkProfile) ??
      null) as QuotationVersion['weblinkProfile'],
    notes: typeof raw.notes === 'string' ? raw.notes : null,
    internalNotes: typeof raw.internalNotes === 'string' ? raw.internalNotes : null,
    inclusionsHtml: typeof raw.inclusionsHtml === 'string' ? raw.inclusionsHtml : null,
    exclusionsHtml: typeof raw.exclusionsHtml === 'string' ? raw.exclusionsHtml : null,
    paymentPolicies: typeof raw.paymentPolicies === 'string' ? raw.paymentPolicies : null,
    cancellationPolicies:
      typeof raw.cancellationPolicies === 'string' ? raw.cancellationPolicies : null,
    bookingTerms: typeof raw.bookingTerms === 'string' ? raw.bookingTerms : null,
    childPolicy: typeof raw.childPolicy === 'string' ? raw.childPolicy : null,
    flightDetails: flight
      ? ({
          ...normalizeFlightDetails(flight),
          images: arrayOrEmpty(
            (flight as { images?: unknown }).images as
              | NonNullable<QuotationVersionInput['flightDetails']>['images']
              | null
              | undefined,
          ),
          flights: (
            (
              normalizeFlightDetails(flight) as {
                flights?: Array<Record<string, unknown>>;
              }
            ).flights ?? []
          ).map((record) => {
            const outbound = objectOrNull(record.outbound);
            const returnJourney = objectOrNull(record.returnJourney);
            return {
              ...record,
              outbound: {
                ...outbound,
                segments: arrayOrEmpty(
                  outbound?.segments as
                    | NonNullable<QuotationVersionInput['flightDetails']>['outbound']['segments']
                    | null
                    | undefined,
                ),
              },
              returnJourney: {
                ...returnJourney,
                segments: arrayOrEmpty(
                  returnJourney?.segments as
                    | NonNullable<
                        QuotationVersionInput['flightDetails']
                      >['returnJourney']['segments']
                    | null
                    | undefined,
                ),
              },
            };
          }),
        } as QuotationVersion['flightDetails'])
      : null,
    hotelDetails: hotelDetails
      ? ({
          ...hotelDetails,
          images: arrayOrEmpty(
            hotelDetails.images as
              NonNullable<QuotationVersionInput['hotelDetails']>['images'] | null | undefined,
          ),
        } as QuotationVersion['hotelDetails'])
      : null,
    addOnDetails: addOnDetails
      ? ({
          include: addOnDetails.include !== false,
          sectionTitle:
            typeof addOnDetails.sectionTitle === 'string' ? addOnDetails.sectionTitle : null,
        } as QuotationVersion['addOnDetails'])
      : null,
    sightseeingDetails: sightseeing
      ? ({
          ...sightseeing,
          days: arrayOrEmpty(
            sightseeing.days as
              NonNullable<QuotationVersionInput['sightseeingDetails']>['days'] | null | undefined,
          ).map((day) => ({
            ...day,
            activities: arrayOrEmpty(day.activities).map((activity) => ({
              ...activity,
              images: arrayOrEmpty(activity.images),
              pricingOptions: arrayOrEmpty(activity.pricingOptions),
            })),
          })),
        } as QuotationVersion['sightseeingDetails'])
      : null,
    itinerary: arrayOrEmpty(raw.itinerary as QuotationVersion['itinerary'] | null | undefined),
    hotels: arrayOrEmpty(raw.hotels as QuotationVersion['hotels'] | null | undefined).map(
      normalizeImageSnapshot,
    ),
    services: arrayOrEmpty(raw.services as QuotationVersion['services'] | null | undefined).map(
      normalizeImageSnapshot,
    ),
    inclusions: arrayOrEmpty(raw.inclusions as QuotationVersion['inclusions'] | null | undefined),
    exclusions: arrayOrEmpty(raw.exclusions as QuotationVersion['exclusions'] | null | undefined),
    terms: arrayOrEmpty(raw.terms as QuotationVersion['terms'] | null | undefined),
    faqs: arrayOrEmpty(raw.faqs as QuotationVersion['faqs'] | null | undefined),
    weblinkSectionOrder: Array.isArray(raw.weblinkSectionOrder)
      ? (raw.weblinkSectionOrder as string[])
      : null,
    destinationExpertConfig: objectOrNull(raw.destinationExpertConfig)
      ? (raw.destinationExpertConfig as QuotationVersion['destinationExpertConfig'])
      : null,
  } as QuotationVersion;
}
const parseCheckInToDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;
  const dmy = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]);
    const yyyy = Number(dmy[3]);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const ymd = raw.slice(0, 10).split('-').map(Number);
    const d = new Date(Date.UTC(ymd[0]!, ymd[1]! - 1, ymd[2]!));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

const nullable = (value: string) => (value === '' ? null : Number(value));

/** A hotel's price for a travel date: the matching season rate, else the base price. */
export const hotelRateForDate = (
  master: {
    price?: number | null;
    seasons?: Array<{ startDate: string; endDate: string; price: number | null }>;
  },
  travelDate: string | Date | null | undefined,
): number | null => {
  const checkIn = parseCheckInToDate(travelDate);
  if (checkIn) {
    const d = Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate());
    const match = (master.seasons ?? []).find((season) => {
      if (season.price == null) return false;
      const s = parseCheckInToDate(season.startDate);
      const e = parseCheckInToDate(season.endDate);
      if (!s || !e) return false;
      const sd = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
      const ed = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
      return d >= sd && d <= ed;
    });
    if (match) return Number(match.price);
  }
  const base = master.price;
  return base != null && Number(base) > 0 ? Number(base) : null;
};

/**
 * Resolve applicable master pricing for a room type on a given check-in date.
 * Precedence: Season (date within range) > Month (calendar month) > Base sellingPrice.
 * Returns null when no price found. Manual override protection is handled by caller.
 */
export const resolveRoomPricingForDate = (
  roomType: {
    sellingPrice?: number | null;
    extraBedPrice?: number | null;
    childWithoutBedPrice?: number | null;
    currency?: string | null;
    seasons?: Array<{ startDate: string | Date; endDate: string | Date; price: number | null; extraBedPrice?: number | null; childWithoutBedPrice?: number | null; currency: string; name: string }>;
    monthPrices?: Array<{ month: number; price: number | null; extraBedPrice?: number | null; childWithoutBedPrice?: number | null; currency: string }>;
  } | null | undefined,
  travelDate: string | Date | null | undefined,
): { baseRoomPrice: number | null; extraBedPrice: number | null; childWithoutBedPrice: number | null; pricingSource: 'SEASON' | 'MONTH' | 'BASE' | null } | null => {
  if (!roomType) return null;
  const isValid = parseCheckInToDate(travelDate);
  if (isValid) {
    const d = Date.UTC(isValid.getUTCFullYear(), isValid.getUTCMonth(), isValid.getUTCDate());
    const season = (roomType.seasons ?? []).find((s) => {
      const start = parseCheckInToDate(s.startDate);
      const end = parseCheckInToDate(s.endDate);
      if (!start || !end) return false;
      const sd = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
      const ed = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
      return d >= sd && d <= ed;
    });
    if (season) {
      return {
        baseRoomPrice: season.price ?? roomType.sellingPrice ?? null,
        extraBedPrice: (season as unknown as { extraBedPrice?: number | null }).extraBedPrice ?? null,
        childWithoutBedPrice: (season as unknown as { childWithoutBedPrice?: number | null }).childWithoutBedPrice ?? null,
        pricingSource: 'SEASON',
      };
    }
    const month = isValid.getUTCMonth() + 1;
    const monthRow = (roomType.monthPrices ?? []).find((m) => m.month === month);
    if (monthRow) {
      return {
        baseRoomPrice: monthRow.price ?? roomType.sellingPrice ?? null,
        extraBedPrice: monthRow.extraBedPrice ?? null,
        childWithoutBedPrice: monthRow.childWithoutBedPrice ?? null,
        pricingSource: 'MONTH',
      };
    }
  }
  if (roomType.sellingPrice != null && Number(roomType.sellingPrice) > 0) {
    return {
      baseRoomPrice: Number(roomType.sellingPrice),
      extraBedPrice: roomType.extraBedPrice ?? null,
      childWithoutBedPrice: roomType.childWithoutBedPrice ?? null,
      pricingSource: 'BASE',
    };
  }
  if (roomType.extraBedPrice != null || roomType.childWithoutBedPrice != null) {
    return {
      baseRoomPrice: null,
      extraBedPrice: roomType.extraBedPrice ?? null,
      childWithoutBedPrice: roomType.childWithoutBedPrice ?? null,
      pricingSource: 'BASE',
    };
  }
  // If no base sellingPrice but month/season not matching, still check if any monthPrice exists with null date? fallback null
  return null;
};

export const resolveMealPlanPricingForDate = (
  mealPlan: {
    sellingPrice?: number | null;
    currency?: string | null;
    seasons?: Array<{ startDate: string | Date; endDate: string | Date; price: number | null; currency: string; name: string }>;
    monthPrices?: Array<{ month: number; price: number | null; currency: string }>;
  } | null | undefined,
  travelDate: string | Date | null | undefined,
): { price: number | null; pricingSource: 'SEASON' | 'MONTH' | 'BASE' | null } | null => {
  if (!mealPlan) return null;
  const isValid = parseCheckInToDate(travelDate);
  if (isValid) {
    const d = Date.UTC(isValid.getUTCFullYear(), isValid.getUTCMonth(), isValid.getUTCDate());
    const season = (mealPlan.seasons ?? []).find((s) => {
      const start = parseCheckInToDate(s.startDate);
      const end = parseCheckInToDate(s.endDate);
      if (!start || !end) return false;
      const sd = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
      const ed = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
      return d >= sd && d <= ed;
    });
    if (season) return { price: season.price ?? mealPlan.sellingPrice ?? null, pricingSource: 'SEASON' };
    const month = isValid.getUTCMonth() + 1;
    const monthRow = (mealPlan.monthPrices ?? []).find((m) => m.month === month);
    if (monthRow) return { price: monthRow.price ?? mealPlan.sellingPrice ?? null, pricingSource: 'MONTH' };
  }
  if (mealPlan.sellingPrice != null && Number(mealPlan.sellingPrice) > 0) return { price: Number(mealPlan.sellingPrice), pricingSource: 'BASE' };
  return null;
};

/** Cruise room-type matching: ID first, fallback to trimmed case-insensitive name (legacy). */
export function findCruiseRoomType(
  cruise: { roomTypes?: Array<{ id: string; name: string; price?: number | null; status: string }> } | null | undefined,
  roomTypeId: string | null | undefined,
  fallbackName: string | null | undefined,
): { id: string; name: string; price?: number | null; status: string } | null {
  if (!cruise?.roomTypes?.length) return null;
  if (roomTypeId) {
    const byId = cruise.roomTypes.find((room) => room.id === roomTypeId);
    if (byId) return byId as never;
  }
  if (fallbackName?.trim()) {
    const key = fallbackName.trim().toLowerCase();
    const byName = cruise.roomTypes.find((room) => room.name.trim().toLowerCase() === key);
    if (byName) return byName as never;
  }
  return null;
}

/** Resolve cruise cabin price from matched room type. */
export function resolveCruiseCabinPrice(
  cruise: { roomTypes?: Array<{ id: string; name: string; price?: number | null; status: string }> } | null | undefined,
  roomTypeId: string | null | undefined,
  fallbackName: string | null | undefined,
): number | null {
  const room = findCruiseRoomType(cruise, roomTypeId, fallbackName);
  if (!room) return null;
  return room.price != null ? Number(room.price) : null;
}

export type HotelInputRow = QuotationVersionInput['hotels'][number];
type HotelRoomLineInput = HotelInputRow['roomLines'][number];
type HotelMealPlanLineInput = HotelInputRow['mealPlanLines'][number];

/** A clean, empty room allocation inside a hotel option. */
const emptyRoomLine = (seed: Partial<HotelRoomLineInput> = {}): HotelRoomLineInput => ({
  hotelRoomTypeId: null,
  roomType: null,
  rooms: 1,
  extraBedQuantity: null,
  extraBedPrice: null,
  childWithoutBedQuantity: null,
  childWithoutBedPrice: null,
  baseRoomPrice: null,
  pricingSource: null,
  sellingPrice: null,
  internalCost: null,
  notes: null,
  ...seed,
});

/** A clean, empty meal-plan selection inside a hotel option. */
const emptyMealLine = (seed: Partial<HotelMealPlanLineInput> = {}): HotelMealPlanLineInput => ({
  hotelMealPlanId: null,
  mealPlan: null,
  sellingPrice: null,
  internalCost: null,
  ...seed,
});

/**
 * A room line the user actually filled in. Untouched default lines (added via
 * "+ Add Room" but never completed) are dropped on save; a PARTIALLY filled
 * line (quantities/remark without a room type) is kept so validation can point
 * at the exact room ("Room 2: Room Type is required.").
 */
const roomLineHasData = (line: HotelRoomLineInput): boolean =>
  Boolean(line.hotelRoomTypeId) ||
  Boolean(line.roomType?.trim()) ||
  line.extraBedQuantity != null ||
  line.childWithoutBedQuantity != null ||
  Boolean(line.notes?.trim()) ||
  line.baseRoomPrice != null ||
  line.extraBedPrice != null ||
  line.childWithoutBedPrice != null ||
  line.sellingPrice != null;

const mealLineHasData = (line: HotelMealPlanLineInput): boolean =>
  Boolean(line.hotelMealPlanId) || Boolean(line.mealPlan?.trim());

/**
 * A legacy quotation row stores its single room/meal on the row-level scalar
 * columns with NULL lines. resolveHotelRoomLines / resolveHotelMealPlanLines
 * synthesize one line from those scalars, so the same repeatable editor can
 * load and extend old quotations without migration. Rows with no allocations
 * at all (newly added stays, or saves with empty lines) keep an empty list:
 * Total Rooms stays empty until the user adds a room allocation — a default
 * line here would silently invent a total of 1.
 */
export const withSynthesizedLines = (row: HotelInputRow): HotelInputRow => {
  const roomLines = row.roomLines?.length
    ? row.roomLines
    : resolveHotelRoomLines(row).map((line) => emptyRoomLine(line));
  const mealPlanLines = row.mealPlanLines?.length
    ? row.mealPlanLines
    : resolveHotelMealPlanLines(row).map((line) => emptyMealLine(line));
  return {
    ...row,
    // Neither room allocations nor meal plans get a synthesized fallback line:
    // an unassigned stay must not count as one room or show a phantom
    // "Meal Plan 1". Legacy rows still synthesize their single value from the
    // scalar columns above, so existing quotations load unchanged.
    roomLines,
    mealPlanLines,
  };
};

type CruiseServiceInput = QuotationVersionInput['services'][number];
type CruiseRoomLineInput = QuotationCruiseRoomLine;

const emptyCruiseRoomLine = (seed: Partial<QuotationCruiseRoomLine> = {}): QuotationCruiseRoomLine => ({
  cruiseRoomTypeId: null,
  roomType: null,
  rooms: 1,
  roomRate: null,
  sellingPrice: null,
  internalCost: null,
  notes: null,
  ...seed,
} as QuotationCruiseRoomLine);

const cruiseRoomLineHasData = (line: QuotationCruiseRoomLine): boolean =>
  Boolean(line.cruiseRoomTypeId) ||
  Boolean(line.roomType?.trim()) ||
  (line.rooms != null && Number(line.rooms) !== 1) ||
  line.roomRate != null ||
  line.sellingPrice != null ||
  Boolean(line.notes?.trim());

const withCruiseSynthesizedLines = (service: unknown): unknown => {
  const raw = service as unknown as { cruiseRoomLines?: QuotationCruiseRoomLine[]; cruiseNights?: number | null; quantity?: number | null; sellingPrice?: number | null; city?: string | null; cruiseRoomTypeId?: string | null; roomRate?: number | null; internalCost?: number | null; roomType?: string | null };
  // Only an explicit array carries room-list intent. An explicitly saved []
  // means "no rooms" and must stay roomless until the user adds one — never
  // force a default room back. Rows without the key (legacy/template rows)
  // synthesize one editable line from the scalar columns here in the editor
  // only, so existing quotations keep rendering exactly as before. Display
  // readers (weblink, PDFs) intentionally do not synthesize.
  const storedRaw = raw.cruiseRoomLines;
  const lines = Array.isArray(storedRaw)
    ? (storedRaw as QuotationCruiseRoomLine[])
    : synthesizeLegacyCruiseRoomLine(service);
  // Nights are optional and never backfilled: an empty stored value stays
  // empty through hydration so saving and reopening preserves it.
  const nights = raw.cruiseNights ?? null;
  return {
    ...(service as Record<string, unknown>),
    cruiseNights: nights,
    cruiseRoomLines: lines,
  } as unknown;
};

/**
 * Editor-only compatibility: one editable room line synthesized from the
 * scalar columns of a key-less legacy/template cruise row (quantity = Number
 * of Rooms, sellingPrice/roomRate = per-night rate, city = snapshot name).
 * Returns [] unless the row carries genuine room evidence — a bare default
 * row (quantity 1, zero/blank prices, no type link or name) stays roomless so
 * rooms only ever appear via an explicit Add Room.
 */
const synthesizeLegacyCruiseRoomLine = (service: unknown): QuotationCruiseRoomLine[] => {
  const row = service as unknown as {
    cruiseRoomTypeId?: string | null;
    city?: string | null;
    roomType?: string | null;
    quantity?: number | null;
    roomRate?: number | null;
    sellingPrice?: number | null;
    internalCost?: number | null;
  };
  const hasLegacyRoom =
    row.cruiseRoomTypeId != null ||
    (row.city ?? '').trim() !== '' ||
    (row.roomType ?? '').trim() !== '' ||
    (row.quantity != null && Number(row.quantity) !== 1) ||
    (row.roomRate != null && Number(row.roomRate) !== 0) ||
    (row.sellingPrice != null && Number(row.sellingPrice) !== 0);
  if (!hasLegacyRoom) return [];
  const legacyRate = row.roomRate ?? row.sellingPrice ?? null;
  return [
    emptyCruiseRoomLine({
      cruiseRoomTypeId: row.cruiseRoomTypeId ?? null,
      roomType: row.city ?? row.roomType ?? null,
      rooms: row.quantity == null ? 1 : Number(row.quantity) || 1,
      roomRate: legacyRate != null ? Number(legacyRate) : null,
      sellingPrice: legacyRate != null ? Number(legacyRate) : null,
      internalCost: row.internalCost ?? null,
    }),
  ];
};

// ---------------------------------------------------------------------------
// Repeatable room-allocation and meal-plan editors for ONE hotel option.
// Unlimited entries: each line is its own field-array entry. The room type and
// meal plan come from the linked Hotel Master (free text still supported).
// ---------------------------------------------------------------------------

interface HotelLinesEditorProps {
  form: UseFormReturn<QuotationVersionInput>;
  hotelIndex: number;
  hotelId: string | null | undefined;
  canCost: boolean;
  /** Recomputes the row's additive selling/cost totals from all lines. */
  recalculateTotals: () => void;
}

function HotelRoomLinesEditor({ form, hotelIndex, hotelId, canCost, recalculateTotals }: HotelLinesEditorProps) {
  const roomLines = useFieldArray({
    control: form.control,
    name: `hotels.${hotelIndex}.roomLines`,
  });
  const watchedLines = useWatch({ control: form.control, name: `hotels.${hotelIndex}.roomLines` }) ?? [];
  const detail = useHotel(hotelId ?? undefined);
  const roomTypes = detail.data?.roomTypes ?? [];
  const roomTypeOptions = withStandardOptions(
    roomTypes.map((room) => ({ id: room.id, label: room.name })),
    STANDARD_ROOM_TYPES,
    'standard-room-type',
  );
  const currency = (form.watch('currency') as string) ?? 'INR';
  const isSectionWise = (form.watch('pricingMode') as string ?? 'PER_PERSON') === 'SECTION_WISE';
  const watchedNights = useWatch({ control: form.control, name: `hotels.${hotelIndex}.nights` as never }) as unknown as number | null | undefined;
  const nights = Number(watchedNights ?? form.watch(`hotels.${hotelIndex}.nights` as never) ?? 0) || 1;
  const checkInDate = useWatch({ control: form.control, name: `hotels.${hotelIndex}.checkInDate` as never }) as unknown as string | Date | null | undefined;
  const manualOverridesRef = useRef<Set<string>>(new Set());
  const markOverridden = (lineIndex: number, field: string) => {
    manualOverridesRef.current.add(`${hotelIndex}-${lineIndex}-${field}`);
  };
  const isOverridden = (lineIndex: number, field: string) => manualOverridesRef.current.has(`${hotelIndex}-${lineIndex}-${field}`);
  const clearOverrideForLine = (lineIndex: number) => {
    ['baseRoomPrice', 'extraBedPrice', 'childWithoutBedPrice'].forEach((f) => manualOverridesRef.current.delete(`${hotelIndex}-${lineIndex}-${f}`));
  };

  const applyLine = (lineIndex: number, patch: Partial<HotelRoomLineInput>) => {
    for (const [key, value] of Object.entries(patch))
      form.setValue(
        `hotels.${hotelIndex}.roomLines.${lineIndex}.${key}` as FieldPath<QuotationVersionInput>,
        value as never,
        { shouldDirty: true },
      );
    recalculateTotals();
  };

  // Auto-prefill room pricing when Hotel / Room Type / Check-in date changes, respecting manual overrides
  // Manual overrides are never overwritten; changing room type clears overrides.
  // Changing check-in date updates non-overridden fields to the new resolved master price.
  useEffect(() => {
    watchedLines.forEach((line, lineIndex) => {
      const roomTypeId = line?.hotelRoomTypeId;
      if (!roomTypeId) return;
      const roomType = roomTypes.find((rt) => rt.id === roomTypeId);
      if (!roomType) return;
      const resolved = resolveRoomPricingForDate(roomType as unknown as Parameters<typeof resolveRoomPricingForDate>[0], checkInDate);
      if (!resolved) return;
      const currentBase = line?.baseRoomPrice;
      const currentExtra = line?.extraBedPrice;
      const currentCwob = line?.childWithoutBedPrice;
      const patch: Partial<HotelRoomLineInput> = {};
      let needsPatch = false;
      if (resolved.baseRoomPrice != null && !isOverridden(lineIndex, 'baseRoomPrice')) {
        if (currentBase == null || Number(currentBase) !== Number(resolved.baseRoomPrice)) {
          patch.baseRoomPrice = resolved.baseRoomPrice;
          needsPatch = true;
        }
      }
      if (resolved.extraBedPrice != null && !isOverridden(lineIndex, 'extraBedPrice')) {
        if (currentExtra == null || Number(currentExtra) !== Number(resolved.extraBedPrice)) {
          patch.extraBedPrice = resolved.extraBedPrice;
          needsPatch = true;
        }
      }
      if (resolved.childWithoutBedPrice != null && !isOverridden(lineIndex, 'childWithoutBedPrice')) {
        if (currentCwob == null || Number(currentCwob) !== Number(resolved.childWithoutBedPrice)) {
          patch.childWithoutBedPrice = resolved.childWithoutBedPrice;
          needsPatch = true;
        }
      }
      if (needsPatch) {
        if (resolved.pricingSource) patch.pricingSource = resolved.pricingSource;
        applyLine(lineIndex, patch);
      } else if (resolved.pricingSource && line?.pricingSource !== resolved.pricingSource && !isOverridden(lineIndex, 'baseRoomPrice')) {
        // Keep pricingSource in sync when price already matches but source differs (e.g., initial BASE -> SEASON)
        applyLine(lineIndex, { pricingSource: resolved.pricingSource });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, checkInDate, detail.data, watchedLines.map((l) => l?.hotelRoomTypeId).join(','), roomTypes.length]);

  return (
    <div className="space-y-3">
      {roomLines.fields.map((lineField, lineIndex) => {
        const line = watchedLines[lineIndex];
        const basePrice = Number(line?.baseRoomPrice ?? 0);
        const ebQty = Number(line?.extraBedQuantity ?? 0);
        const ebPrice = Number(line?.extraBedPrice ?? 0);
        const cwQty = Number(line?.childWithoutBedQuantity ?? 0);
        const cwPrice = Number(line?.childWithoutBedPrice ?? 0);
        const rooms = Number(line?.rooms ?? 1);
        const lineBaseTotal = basePrice * rooms * (nights || 1);
        const ebTotal = ebQty * ebPrice * (nights || 1);
        const cwTotal = cwQty * cwPrice * (nights || 1);
        const lineTotal = lineBaseTotal + ebTotal + cwTotal;
        return (
          <div key={lineField.id} className="rounded-lg bg-muted/30 border border-border/40 p-3.5">
            <div className="flex items-center justify-between border-b border-border/40 pb-2 mb-3">
              <span className={subsectionHeading}>Room {lineIndex + 1}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Remove room ${lineIndex + 1}`}
                title={`Remove room ${lineIndex + 1}`}
                onClick={() => {
                  roomLines.remove(lineIndex);
                  recalculateTotals();
                }}
              >
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            </div>
            <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-sm font-semibold text-slate-800 md:col-span-2 xl:col-span-2">
                Room Type <span className="text-red-500">*</span>
                <span className="mt-1 block">
                  <MasterSelect
                    ariaLabel={`Room ${lineIndex + 1} type master`}
                    placeholder={hotelId ? 'Link a room type' : 'Type room type'}
                    options={roomTypeOptions}
                    value={line?.hotelRoomTypeId}
                    loading={Boolean(hotelId) && detail.isPending}
                    fallbackLabel={line?.roomType ?? undefined}
                    onText={(text) =>
                      applyLine(lineIndex, {
                        hotelRoomTypeId: null,
                        roomType: text.trim() ? text : null,
                      })
                    }
                    onSelect={(option) => {
                      const room = roomTypes.find((entry) => entry.id === option?.id);
                      clearOverrideForLine(lineIndex);
                      if (option && !room) {
                        // A standard suggestion that is not a Hotel Master
                        // record stays free text, never a fabricated link.
                        applyLine(lineIndex, { hotelRoomTypeId: null, roomType: option.label });
                        return;
                      }
                      const resolved = room ? resolveRoomPricingForDate(room as unknown as Parameters<typeof resolveRoomPricingForDate>[0], checkInDate) : null;
                      const patch: Partial<HotelRoomLineInput> = {
                        hotelRoomTypeId: option?.id ?? null,
                        ...(option ? { roomType: option.label } : {}),
                      };
                      if (resolved) {
                        if (resolved.baseRoomPrice != null) patch.baseRoomPrice = resolved.baseRoomPrice;
                        if (resolved.extraBedPrice != null) patch.extraBedPrice = resolved.extraBedPrice;
                        if (resolved.childWithoutBedPrice != null) patch.childWithoutBedPrice = resolved.childWithoutBedPrice;
                        if (resolved.pricingSource) patch.pricingSource = resolved.pricingSource;
                      } else if (room?.sellingPrice != null && Number(room.sellingPrice) > 0) {
                        patch.baseRoomPrice = Number(room.sellingPrice);
                      }
                      if (canCost && room?.baseCost != null && Number(room.baseCost) > 0) {
                        patch.internalCost = Number(room.baseCost);
                      }
                      applyLine(lineIndex, patch);
                    }}
                  />
                </span>
              </label>
              <label className="text-sm font-semibold text-slate-800">
                Number of Rooms
                <input
                  aria-label={`Room ${lineIndex + 1} number of rooms`}
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  {...form.register(`hotels.${hotelIndex}.roomLines.${lineIndex}.rooms`, {
                    setValueAs: (value) => (value === '' ? 1 : Number(value)),
                  })}
                  className={`${field} mt-1`}
                />
              </label>
              <label className="text-sm font-semibold text-slate-800">
                Extra Bed Quantity
                <input
                  aria-label={`Room ${lineIndex + 1} extra bed quantity`}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  {...form.register(`hotels.${hotelIndex}.roomLines.${lineIndex}.extraBedQuantity`, {
                    setValueAs: (value) => (value === '' ? null : Number(value)),
                  })}
                  className={`${field} mt-1`}
                />
              </label>
            </div>
            {isSectionWise && (() => {
              return (
              <div className={`mt-3 ${calculatedCard}`}>
                <p className={calculatedLabel}>Hotel Pricing — per night rates</p>
                <div className="mt-2 grid gap-3 md:grid-cols-3">
                  <label className="text-xs font-medium text-slate-700">
                    Room Rate / night ({currency}) <span className="text-[11px] font-normal text-brand-600">· master-derived, editable</span>
                    <input aria-label={`Room ${lineIndex + 1} rate per night`} type="number" step="0.01" min="0" {...form.register(`hotels.${hotelIndex}.roomLines.${lineIndex}.baseRoomPrice`, { setValueAs: (v)=> v===''||v==null?null:Number(v), onChange: () => markOverridden(lineIndex, 'baseRoomPrice') })} className={`${field} mt-1`} />
                    <span className="mt-1 block text-[11px] font-normal text-muted-foreground">{rooms} × {nights || 1} nights = {(basePrice*rooms*(nights||1)).toFixed(2)}</span>
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    Extra Bed Rate / night <span className="text-[11px] font-normal text-brand-600">· master</span>
                    <input aria-label={`Room ${lineIndex + 1} extra bed rate`} type="number" step="0.01" min="0" {...form.register(`hotels.${hotelIndex}.roomLines.${lineIndex}.extraBedPrice`, { setValueAs: (v)=> v===''||v==null?null:Number(v), onChange: () => markOverridden(lineIndex, 'extraBedPrice') })} className={`${field} mt-1`} />
                    <span className="mt-1 block text-[11px] font-normal text-muted-foreground">{ebQty} × {ebPrice} × {nights||1} = {ebTotal.toFixed(2)}</span>
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    Child w/o Bed Rate / night <span className="text-[11px] font-normal text-brand-600">· master</span>
                    <input aria-label={`Room ${lineIndex + 1} child without bed rate`} type="number" step="0.01" min="0" {...form.register(`hotels.${hotelIndex}.roomLines.${lineIndex}.childWithoutBedPrice`, { setValueAs: (v)=> v===''||v==null?null:Number(v), onChange: () => markOverridden(lineIndex, 'childWithoutBedPrice') })} className={`${field} mt-1`} />
                    <span className="mt-1 block text-[11px] font-normal text-muted-foreground">{cwQty} × {cwPrice} × {nights||1} = {cwTotal.toFixed(2)}</span>
                  </label>
                </div>
                <div className="mt-2 flex items-baseline justify-between border-t border-border/40 pt-2">
                  <span className={calculatedLabel}>Line Amount</span>
                  <span className={calculatedValue}>{currency} {lineTotal.toFixed(2)}</span>
                </div>
                <span className="block text-[11px] text-muted-foreground">{rooms} room{rooms!==1?'s':''} × {nights||1} night{(nights||1)!==1?'s':''} — calculated</span>
              </div>
              );
            })()}
          </div>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-label="Add room"
        disabled={roomLines.fields.length >= 10}
        title={roomLines.fields.length >= 10 ? 'A hotel option supports up to 10 room allocations.' : undefined}
        onClick={() => roomLines.append(emptyRoomLine())}
      >
        <Plus className="h-4 w-4" /> Add Room
      </Button>
    </div>
  );
}

function HotelMealPlanLinesEditor({ form, hotelIndex, hotelId, canCost, recalculateTotals }: HotelLinesEditorProps) {
  const mealPlanLines = useFieldArray({
    control: form.control,
    name: `hotels.${hotelIndex}.mealPlanLines`,
  });
  const watchedLines = useWatch({ control: form.control, name: `hotels.${hotelIndex}.mealPlanLines` }) ?? [];
  const detail = useHotel(hotelId ?? undefined);
  const mealPlans = detail.data?.mealPlans ?? [];
  const mealPlanOptions = withStandardOptions(
    mealPlans.map((meal) => ({ id: meal.id, label: meal.name, hint: meal.type })),
    STANDARD_MEAL_PLANS,
    'standard-meal-plan',
  );
  const currency = (form.watch('currency') as string) ?? 'INR';
  const isSectionWise = (form.watch('pricingMode') as string ?? 'PER_PERSON') === 'SECTION_WISE';
  const checkInDate = useWatch({ control: form.control, name: `hotels.${hotelIndex}.checkInDate` as never }) as unknown as string | Date | null | undefined;
  const manualOverridesRef = useRef<Set<string>>(new Set());
  const markOverridden = (lineIndex: number) => manualOverridesRef.current.add(`${hotelIndex}-${lineIndex}-sellingPrice`);
  const isOverridden = (lineIndex: number) => manualOverridesRef.current.has(`${hotelIndex}-${lineIndex}-sellingPrice`);
  const clearOverrideForLine = (lineIndex: number) => manualOverridesRef.current.delete(`${hotelIndex}-${lineIndex}-sellingPrice`);

  const applyLine = (lineIndex: number, patch: Partial<HotelMealPlanLineInput>) => {
    for (const [key, value] of Object.entries(patch))
      form.setValue(
        `hotels.${hotelIndex}.mealPlanLines.${lineIndex}.${key}` as FieldPath<QuotationVersionInput>,
        value as never,
        { shouldDirty: true },
      );
    recalculateTotals();
  };

  useEffect(() => {
    watchedLines.forEach((line, lineIndex) => {
      const mealPlanId = line?.hotelMealPlanId;
      if (!mealPlanId) return;
      const mealPlan = mealPlans.find((m) => m.id === mealPlanId);
      if (!mealPlan) return;
      const resolved = resolveMealPlanPricingForDate(mealPlan as unknown as Parameters<typeof resolveMealPlanPricingForDate>[0], checkInDate);
      if (!resolved || resolved.price == null) return;
      if (isOverridden(lineIndex)) return;
      const currentPrice = line?.sellingPrice;
      if (currentPrice == null || Number(currentPrice) !== Number(resolved.price)) {
        applyLine(lineIndex, { sellingPrice: resolved.price });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, checkInDate, detail.data, watchedLines.map((l) => l?.hotelMealPlanId).join(','), mealPlans.length]);

  return (
    <div className="space-y-3">
      {mealPlanLines.fields.map((lineField, lineIndex) => {
        const line = watchedLines[lineIndex];
        return (
          <div key={lineField.id} className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-sm font-semibold text-slate-800">
              Meal Plan {lineIndex + 1}
              <span className="mt-1 block">
                <MasterSelect
                  ariaLabel={`Meal plan ${lineIndex + 1} master`}
                  placeholder={hotelId ? 'Link a meal plan' : 'Type meal plan'}
                  options={mealPlanOptions}
                  value={line?.hotelMealPlanId}
                  loading={Boolean(hotelId) && detail.isPending}
                  fallbackLabel={line?.mealPlan ?? undefined}
                  onText={(text) =>
                    applyLine(lineIndex, {
                      hotelMealPlanId: null,
                      mealPlan: text.trim() ? text : null,
                    })
                  }
                  onSelect={(option) => {
                    const meal = mealPlans.find((entry) => entry.id === option?.id);
                    clearOverrideForLine(lineIndex);
                    if (option && !meal) {
                      // A standard suggestion that is not a Hotel Master
                      // record stays free text, never a fabricated link.
                      applyLine(lineIndex, { hotelMealPlanId: null, mealPlan: option.label });
                      return;
                    }
                    const resolved = meal ? resolveMealPlanPricingForDate(meal as unknown as Parameters<typeof resolveMealPlanPricingForDate>[0], checkInDate) : null;
                    const patch: Partial<HotelMealPlanLineInput> = {
                      hotelMealPlanId: option?.id ?? null,
                      ...(option ? { mealPlan: option.label } : {}),
                    };
                    if (resolved && resolved.price != null) {
                      patch.sellingPrice = resolved.price;
                    } else if (meal?.sellingPrice != null && Number(meal.sellingPrice) > 0) {
                      patch.sellingPrice = Number(meal.sellingPrice);
                    }
                    if (canCost && meal?.baseCost != null && Number(meal.baseCost) > 0) {
                      patch.internalCost = Number(meal.baseCost);
                    }
                    applyLine(lineIndex, patch);
                  }}
                />
              </span>
            </label>
            {isSectionWise && (
              <label className="w-36 text-xs font-semibold text-slate-700">
                Rate ({currency})
                <input aria-label={`Meal plan ${lineIndex + 1} rate`} type="number" step="0.01" min="0" {...form.register(`hotels.${hotelIndex}.mealPlanLines.${lineIndex}.sellingPrice`, { setValueAs: (v)=> v===''||v==null?null:Number(v), onChange: () => markOverridden(lineIndex) })} className={`${field} mt-1`} />
              </label>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Remove meal plan ${lineIndex + 1}`}
              title={`Remove meal plan ${lineIndex + 1}`}
              onClick={() => {
                mealPlanLines.remove(lineIndex);
                recalculateTotals();
              }}
            >
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-label="Add meal plan"
        disabled={mealPlanLines.fields.length >= 10}
        title={mealPlanLines.fields.length >= 10 ? 'A hotel option supports up to 10 meal plans.' : undefined}
        onClick={() => mealPlanLines.append(emptyMealLine())}
      >
        <Plus className="h-4 w-4" /> Add Meal Plan
      </Button>
    </div>
  );
}

interface CruiseLinesEditorProps {
  form: UseFormReturn<QuotationVersionInput>;
  serviceIndex: number;
  cruiseId: string | null | undefined;
  canCost: boolean;
  nights: number;
  recalculateTotals: () => void;
}

function CruiseRoomLinesEditor({ form, serviceIndex, cruiseId, canCost, nights, recalculateTotals }: CruiseLinesEditorProps) {
  const roomLines = useFieldArray({
    control: form.control,
    name: `services.${serviceIndex}.cruiseRoomLines` as never,
  });
  const watchedLines = useWatch({ control: form.control, name: `services.${serviceIndex}.cruiseRoomLines` as never }) as unknown as CruiseRoomLineInput[] ?? [];
  const detail = useCruise(cruiseId ?? undefined);
  // Prefer detailed cruise for pricing (has price), fallback to list
  const cruiseMastersList = useCruises(useMemo(() => new URLSearchParams({ status: 'ACTIVE', pageSize: '100' }), []));
  const listMaster = (cruiseMastersList.data?.data ?? []).find((m) => m.id === cruiseId);
  const cruiseMaster = (detail.data as unknown as { roomTypes?: Array<{ id: string; name: string; price?: number | null; status: string }> }) ?? listMaster as unknown as { roomTypes?: Array<{ id: string; name: string; price?: number | null; status: string }> } ?? null;
  const roomTypes = (cruiseMaster as unknown as { roomTypes?: Array<{ id: string; name: string; price?: number | null; status: string }> })?.roomTypes ?? [];
  const roomTypeOptions = withStandardCabinOptions(
    roomTypes.filter((r) => r.status === 'ACTIVE').map((room) => ({ id: room.id, label: room.name })),
  );
  const currency = (form.watch('currency') as string) ?? 'INR';
  const isSectionWise = (form.watch('pricingMode' as never) as unknown as string) === 'SECTION_WISE';
  const manualOverridesRef = useRef<Set<string>>(new Set());
  const markOverridden = (lineIndex: number) => manualOverridesRef.current.add(`${serviceIndex}-${lineIndex}-roomRate`);
  const isOverridden = (lineIndex: number) => manualOverridesRef.current.has(`${serviceIndex}-${lineIndex}-roomRate`);
  const clearOverrideForLine = (lineIndex: number) => manualOverridesRef.current.delete(`${serviceIndex}-${lineIndex}-roomRate`);

  const applyLine = (lineIndex: number, patch: Partial<CruiseRoomLineInput>) => {
    for (const [key, value] of Object.entries(patch))
      form.setValue(
        `services.${serviceIndex}.cruiseRoomLines.${lineIndex}.${key}` as never,
        value as never,
        { shouldDirty: true },
      );
    recalculateTotals();
  };

  // Auto-prefill roomRate when cruise/room/nights change, respecting manual override
  useEffect(() => {
    watchedLines.forEach((line, lineIndex) => {
      const roomTypeId = (line as unknown as { cruiseRoomTypeId?: string | null })?.cruiseRoomTypeId;
      const fallbackName = (line as unknown as { roomType?: string | null })?.roomType;
      if (!roomTypeId && !fallbackName?.trim()) return;
      if (isOverridden(lineIndex)) return;
      const room = findCruiseRoomType(cruiseMaster as never, roomTypeId, fallbackName);
      if (!room || room.price == null) return;
      const currentRate = (line as unknown as { roomRate?: number | null })?.roomRate ?? (line as unknown as { sellingPrice?: number | null })?.sellingPrice;
      const masterPrice = Number(room.price);
      if (currentRate != null && Number(currentRate) === masterPrice) return;
      // If not overridden, sync to master price (covers initial and room change)
      applyLine(lineIndex, { roomRate: masterPrice, sellingPrice: masterPrice });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cruiseId, detail.data, watchedLines.map((l) => (l as unknown as { cruiseRoomTypeId?: string })?.cruiseRoomTypeId).join(','), watchedLines.map((l) => (l as unknown as { roomType?: string })?.roomType).join('|'), cruiseMaster?.roomTypes?.length]);

  return (
    <div className="space-y-3">
      {roomLines.fields.map((lineField, lineIndex) => {
        const line = watchedLines[lineIndex] as unknown as CruiseRoomLineInput | undefined;
        const roomRate = Number((line?.roomRate ?? line?.sellingPrice ?? 0) as number) || 0;
        const rooms = Number(line?.rooms ?? 1) || 1;
        const lineTotal = roomRate * rooms * (nights || 1);
        const roomTypeForLine = findCruiseRoomType(cruiseMaster as never, line?.cruiseRoomTypeId, line?.roomType);
        const hasMasterPrice = roomTypeForLine ? roomTypeForLine.price != null : false;
        const showNoPriceHelper = Boolean(line?.cruiseRoomTypeId || line?.roomType?.trim()) && !hasMasterPrice && (line?.roomRate == null && line?.sellingPrice == null);
        const isUnavailable = Boolean(cruiseId && (line?.cruiseRoomTypeId || line?.roomType?.trim()) && !roomTypeForLine);
        return (
          <div key={lineField.id} className="rounded-lg bg-muted/30 border border-border/40 p-3.5">
            <div className="flex items-center justify-between border-b border-border/40 pb-2 mb-3">
              <span className={subsectionHeading}>Room {lineIndex + 1}</span>
              <Button type="button" size="sm" variant="ghost" aria-label={`Remove room ${lineIndex + 1}`} onClick={() => { roomLines.remove(lineIndex); recalculateTotals(); }}>
                <Trash2 className="h-4 w-4 text-red-600" /> Remove
              </Button>
            </div>
            <div className={`mt-2 grid gap-3 ${isSectionWise ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
              <label className="text-sm font-semibold text-slate-800 md:col-span-1">
                Room Type <span className="text-red-500">*</span>
                <span className="mt-1 block">
                  <MasterSelect
                    ariaLabel={`Room ${lineIndex + 1} type master`}
                    placeholder={cruiseId ? 'Link a room type' : 'Select cruise first'}
                    options={roomTypeOptions}
                    value={line?.cruiseRoomTypeId}
                    loading={Boolean(cruiseId) && detail.isPending}
                    fallbackLabel={line?.roomType ?? undefined}
                    onText={(text) => applyLine(lineIndex, { cruiseRoomTypeId: null, roomType: text.trim() ? text : null })}
                    onSelect={(option) => {
                      const room = roomTypes.find((entry) => entry.id === option?.id);
                      clearOverrideForLine(lineIndex);
                      if (option && !room) {
                        // A standard cabin suggestion is not a Cruise Master record: keep it
                        // as quotation-specific free text with no master link or price.
                        applyLine(lineIndex, { cruiseRoomTypeId: null, roomType: option.label });
                        return;
                      }
                      const patch: Partial<CruiseRoomLineInput> = {
                        cruiseRoomTypeId: option?.id ?? null,
                        ...(option ? { roomType: option.label } : { roomType: null }),
                      } as Partial<CruiseRoomLineInput>;
                      if (room && room.price != null) {
                        (patch as unknown as Record<string, unknown>).roomRate = Number(room.price);
                        (patch as unknown as Record<string, unknown>).sellingPrice = Number(room.price);
                      } else if (room) {
                        (patch as unknown as Record<string, unknown>).roomRate = null;
                        (patch as unknown as Record<string, unknown>).sellingPrice = null;
                      }
                      if (canCost && (room as unknown as { baseCost?: number | null })?.baseCost != null) {
                        (patch as unknown as Record<string, unknown>).internalCost = Number((room as unknown as { baseCost?: number | null })?.baseCost);
                      }
                      applyLine(lineIndex, patch);
                    }}
                  />
                </span>
                {isSectionWise && showNoPriceHelper && !isUnavailable && <span className="mt-1 block text-[11px] text-amber-600">No master price found for this room type.</span>}
              </label>
              <label className="text-sm font-semibold text-slate-800">
                Number of Rooms
                <input
                  aria-label={`Room ${lineIndex + 1} number of rooms`}
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  {...form.register(`services.${serviceIndex}.cruiseRoomLines.${lineIndex}.rooms` as never, {
                    setValueAs: (value) => (value === '' ? 1 : Number(value)),
                    onChange: () => recalculateTotals(),
                  })}
                  className={`${field} mt-1`}
                />
              </label>
              {isSectionWise && (
                <label className="text-sm font-semibold text-slate-800">
                  Room Rate / night ({currency})
                  <input
                    aria-label={`Room ${lineIndex + 1} rate per night`}
                    type="number"
                    step="0.01"
                    min={0}
                    {...form.register(`services.${serviceIndex}.cruiseRoomLines.${lineIndex}.roomRate` as never, {
                      setValueAs: (v) => (v === '' || v == null ? null : Number(v)),
                      onChange: () => markOverridden(lineIndex),
                    })}
                    className={`${field} mt-1`}
                  />
                  <span className="mt-1 block text-[11px] font-normal text-slate-500">
                    {rooms} × {nights || 1} nights × {roomRate.toFixed(2)} = {lineTotal.toFixed(2)}
                  </span>
                </label>
              )}
            </div>
            {isSectionWise && (
              <>
                <div className={`mt-3 ${calculatedCard} flex items-center justify-between`}>
                  <span className={calculatedLabel}>Line Amount</span>
                  <span className={calculatedValue}>{currency} {lineTotal.toFixed(2)}</span>
                </div>
                <span className="block text-[11px] text-muted-foreground">{rooms} room{rooms!==1?'s':''} × {nights||1} night{(nights||1)!==1?'s':''} × {roomRate.toFixed(2)} — calculated</span>
              </>
            )}
          </div>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-label="Add room"
        disabled={roomLines.fields.length >= 10}
        title={roomLines.fields.length >= 10 ? 'A cruise option supports up to 10 room allocations.' : undefined}
        onClick={() => roomLines.append(emptyCruiseRoomLine())}
      >
        <Plus className="h-4 w-4" /> Add Room
      </Button>
    </div>
  );
}

const emptyHotel = (
  sequence: number,
  selected = true,
  seed: Partial<HotelInputRow> = {},
): HotelInputRow => ({
  city: '',
  hotelName: '',
  category: null,
  roomType: null,
  mealPlan: null,
  hotelId: null,
  hotelRoomTypeId: null,
  hotelMealPlanId: null,
  rooms: null,
  // Stay dates are optional, so an untouched stay starts with unknown nights
  // (NULL) rather than 0 — 0 would fail validation and invent a duration.
  nights: null,
  checkInDate: null,
  checkOutDate: null,
  checkInTime: null,
  checkOutTime: null,
  showCheckInTime: false,
  showCheckOutTime: false,
  internalCost: 0,
  sellingPrice: 0,
  baseRoomPrice: null,
  extraBedQuantity: null,
  extraBedPrice: null,
  childWithoutBedQuantity: null,
  childWithoutBedPrice: null,
  pricingSource: null,
  selected,
  notes: null,
  sequence,
  images: [],
  imageSnapshotPresent: false,
  // A newly added stay starts with NO room allocation: Total Rooms stays
  // empty until the user explicitly adds room lines (via Add Room). A default
  // line here would silently count as one room and invent a total of 1.
  // Meal-plan rows behave the same way: no default "Meal Plan 1" — the user
  // adds one explicitly, so an untouched stay never shows an empty selection.
  roomLines: [],
  mealPlanLines: [],
  ...seed,
});

/**
 * A brand-new, fully independent blank Hotel Stay. Never clones the current or
 * previous stay — no hotel, no city, no dates, no rooms, no master links and no
 * image references. Used by "Add Hotel Before" / "Add Hotel After".
 */
const createEmptyHotelStay = (
  sequence: number,
  selected = true,
  seed: Partial<HotelInputRow> = {},
): HotelInputRow => emptyHotel(sequence, selected, seed);

/** True when a quotation hotel row's city matches a Hotel Master's city or destination. */
type DefaultHotelMaster = {
  id: string;
  name: string;
  status: string;
  isDefaultForCity: boolean;
  starCategory: number | null;
  city: { name: string };
  destination: { id: string; name: string };
  images: MasterImageMeta[];
};

/**
 * Minimal Destination Master shape needed to resolve an itinerary city to the
 * parent destination's stable id. Each destination embeds its linked cities, so
 * the index can be built from the already-loaded `useAllDestinations` feed without
 * a new API surface.
 */
export interface HotelDestinationSource {
  id: string;
  name?: string | null;
  cities?: Array<{ city?: { name?: string | null } | null } | null> | null;
}

/**
 * City → destination stable-id lookup from the Destination Master list.
 *
 * The lead itinerary stores a free-text CITY (`QueryItinerary.destination`), not
 * a destination name, so a default hotel scoped to a destination could never be
 * resolved by comparing that string to the destination name. This index maps a
 * normalized city name to every destination that links that city, letting the
 * builder select a destination's default hotels through the real relationship.
 */
export interface HotelDestinationIndex {
  /** normalized city name → destination ids that link that city (stable ids) */
  destinationIdsByCity: Map<string, string[]>;
  /** normalized destination name → stable destination id */
  destinationIdByName: Map<string, string>;
}

export function buildHotelDestinationIndex(
  destinations: HotelDestinationSource[] | null | undefined,
): HotelDestinationIndex {
  const destinationIdsByCity = new Map<string, string[]>();
  const destinationIdByName = new Map<string, string>();
  const add = (key: string, destinationId: string) => {
    if (!key) return;
    const existing = destinationIdsByCity.get(key);
    if (!existing) destinationIdsByCity.set(key, [destinationId]);
    else if (!existing.includes(destinationId)) existing.push(destinationId);
  };
  for (const destination of destinations ?? []) {
    const name = (destination.name ?? '').trim().toLowerCase();
    if (name && !destinationIdByName.has(name)) destinationIdByName.set(name, destination.id);
    for (const link of destination.cities ?? []) {
      const cityName = link?.city?.name;
      if (cityName) add(cityName.trim().toLowerCase(), destination.id);
    }
  }
  return { destinationIdsByCity, destinationIdByName };
}

/**
 * The city a lead itinerary stay should be matched against. New leads no
 * longer collect a city, so `destination` (the city slot) is often blank while
 * `country` holds the selected Destination Master. Falling back to the
 * destination keeps such a stay hotel-worthy and lets the destination default
 * resolve through the relationship index.
 */
export function resolveItineraryStayCity(stay: {
  destination?: string | null;
  country?: string | null;
} | null | undefined): string {
  return (stay?.destination ?? '').trim() || (stay?.country ?? '').trim();
}

/**
 * Every Destination Master id referenced by the quotation — by itinerary city,
 * itinerary destination name, current hotel-row city or destination summary.
 * Used to scope default-hotel queries to what the quotation actually needs.
 */
export function collectHotelDestinationIds({
  index,
  itinerary = [],
  hotelCities = [],
  destinationSummary,
}: {
  index: HotelDestinationIndex;
  itinerary?: Array<{ destination?: string | null; country?: string | null; nights?: number | null } | null> | null;
  hotelCities?: Array<string | null | undefined> | null;
  destinationSummary?: string | null;
}): string[] {
  const ids = new Set<string>();
  const addName = (raw: string | null | undefined) => {
    const key = (raw ?? '').trim().toLowerCase();
    if (!key) return;
    for (const id of index.destinationIdsByCity.get(key) ?? []) ids.add(id);
    const byName = index.destinationIdByName.get(key);
    if (byName) ids.add(byName);
  };
  for (const stay of itinerary ?? []) {
    if (stay && typeof stay.nights === 'number' && stay.nights <= 0) continue;
    addName(resolveItineraryStayCity(stay));
    addName(stay?.country);
  }
  for (const city of hotelCities ?? []) addName(city);
  const summary = (destinationSummary ?? '').trim();
  if (summary) {
    for (const part of summary.split(/[•,>/→|-]+/)) addName(part);
  }
  return [...ids].sort();
}

/** Segments that do not require hotel accommodation. */
const NON_HOTEL_CITIES = new Set([
  'cruise',
  'at sea',
  'at-sea',
  'at_sea',
  'airport',
  'transfer',
  'in transit',
  'in-transit',
  'in_transit',
  'bus journey',
  'bus-journey',
  'bus_journey',
  'fly',
  'flight',
  'departure',
  'arrival',
]);

const isHotelStay = (city: string | null | undefined): boolean => {
  const key = (city ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '');
  return key.length > 0 && !NON_HOTEL_CITIES.has(key);
};

/**
 * Non-accommodation itinerary segments (Cruise, Airport, In transit, …) named as
 * free text, e.g. "Singapore Cruise". Such a label is never proof a matching
 * hotel exists, so the best-city-name guess must not fire for it; only a default
 * hotel resolved through the destination relationship may fill it.
 */
const NON_HOTEL_SEGMENT_WORDS = new Set([
  'cruise',
  'airport',
  'transfer',
  'transit',
  'departure',
  'arrival',
  'flight',
  'fly',
  'sea',
  'embark',
  'disembark',
]);

const isNonHotelSegmentLabel = (city: string | null | undefined): boolean =>
  (city ?? '')
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((token) => NON_HOTEL_SEGMENT_WORDS.has(token));

/**
 * Defaults are destination-scoped (up to 10 per destination). Returns every
 * active default hotel for a stay row, in priority order:
 *
 *   1. exact city-tier  — the itinerary city names the hotel's own city;
 *   2. resolved destination-tier — the itinerary city is linked (via the
 *      Destination Master's cities) to the hotel's destination, so a default
 *      configured for the destination applies even when the itinerary city is a
 *      different city within it (e.g. "Singapore Cruise" → "Singapore" default);
 *   3. exact destination-tier — the itinerary city literally names the
 *      destination (legacy behaviour).
 *
 * Results are de-duplicated and sorted by name for a stable order. Matching is
 * always exact on a resolved identity (never substring), so hotels from other
 * destinations are never mixed in.
 */
export function matchDefaultHotels(
  rowCity: string,
  masters: DefaultHotelMaster[],
  destinationIndex?: HotelDestinationIndex,
) {
  const city = rowCity.trim().toLowerCase();
  if (!city) return [];
  const defaults = masters.filter((hotel) => hotel.status === 'ACTIVE' && hotel.isDefaultForCity);
  const byId = new Map<string, DefaultHotelMaster>();
  // 1. Exact city-tier.
  for (const hotel of defaults) {
    if (hotel.city?.name?.trim().toLowerCase() === city) byId.set(hotel.id, hotel);
  }
  // 2. Destination-tier through the resolved city → destination relationship.
  const resolvedDestinationIds = destinationIndex?.destinationIdsByCity.get(city) ?? [];
  if (resolvedDestinationIds.length) {
    const resolved = new Set(resolvedDestinationIds);
    for (const hotel of defaults) {
      if (hotel.destination?.id && resolved.has(hotel.destination.id)) byId.set(hotel.id, hotel);
    }
  }
  // 3. Exact destination-tier (legacy: the city string is the destination name).
  for (const hotel of defaults) {
    if (hotel.destination?.name?.trim().toLowerCase() === city) byId.set(hotel.id, hotel);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Row-level prefill eligibility. A stay is genuinely empty only when it has no
 * master link, no typed hotel name, no room/meal selection and no manually
 * entered money. This replaces the old whole-quotation `savedHotelCount === 0`
 * gate: an existing quotation may receive a default in a newly added (or still
 * empty) stay, while selected, manually entered, template-imported, duplicated
 * and saved rows are never touched.
 */
export function isHotelRowEmpty(row: Partial<HotelInputRow> | null | undefined): boolean {
  if (!row) return false;
  if (row.hotelId) return false;
  if ((row.hotelName ?? '').trim()) return false;
  if (row.hotelRoomTypeId || row.hotelMealPlanId) return false;
  if ((row.roomType ?? '').trim() || (row.mealPlan ?? '').trim()) return false;
  if (Number(row.internalCost ?? 0) > 0 || Number(row.sellingPrice ?? 0) > 0) return false;
  const lineHasData = (
    lines: Array<{
      roomType?: string | null;
      mealPlan?: string | null;
      roomTypeId?: string | null;
      mealPlanId?: string | null;
      internalCost?: number | null;
      sellingPrice?: number | null;
    }> | null | undefined,
  ) =>
    (lines ?? []).some(
      (line) =>
        Boolean(line) &&
        (Boolean((line!.roomType ?? '').trim()) ||
          Boolean((line!.mealPlan ?? '').trim()) ||
          Boolean(line!.roomTypeId) ||
          Boolean(line!.mealPlanId) ||
          Number(line!.internalCost ?? 0) > 0 ||
          Number(line!.sellingPrice ?? 0) > 0),
    );
  return !lineHasData(row.roomLines as never) && !lineHasData(row.mealPlanLines as never);
}

/**
 * The city context to use for an empty stay: its own city when known, else the
 * current itinerary/destination context (never a stale saved summary).
 */
export function resolveHotelRowCity(
  row: { city?: string | null | undefined } | null | undefined,
  fallbackCity: string | null | undefined,
): string {
  return (row?.city ?? '').trim() || (fallbackCity ?? '').trim();
}

/**
 * Candidate sightseeing masters for quotation prefill, in consumption order
 * (sequence → createdAt → id).
 *
 * The lead's selected destination identifies the eligible attractions. Rows are
 * scoped by the destination's stable id (preferred) or, when no id is known yet,
 * by the destination name/country token. City is deliberately ignored: a
 * destination such as "Vietnam Trio" owns attractions spread across Hanoi, Da
 * Nang and Phu Quoc, and every one of them must prefill in sightseeing sequence
 * order (1, 2, 3, …) regardless of which city it sits in.
 */
export function selectSightseeingPrefillMasters(
  masters: Sightseeing[],
  destinationToken: string | null | undefined,
  destinationIds: string[] = [],
): Sightseeing[] {
  const normalizedToken = (destinationToken ?? '').trim().toLowerCase();
  const idScope = new Set((destinationIds ?? []).map((id) => id.trim()).filter(Boolean));
  return [...(masters ?? [])]
    .filter((row) => row.status === 'ACTIVE')
    .filter((row) => {
      // The stable destination id is authoritative when we have one; a row with
      // no destination id can never be proven to belong to it, so it is dropped.
      if (idScope.size > 0) return Boolean(row.destination?.id && idScope.has(row.destination.id));
      if (!normalizedToken) return true;
      return [row.destination?.name, row.destination?.countryName]
        .map((value) => value?.toLowerCase())
        .some((value) => Boolean(value && value.includes(normalizedToken)));
    })
    .sort(
      (a, b) =>
        (a.sequence ?? 0) - (b.sequence ?? 0) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}

/** The best available active hotel for a city (first by name). */
const matchBestCityHotel = (city: string, masters: DefaultHotelMaster[]) => {
  const c = city.trim().toLowerCase();
  if (!c) return undefined;
  const active = masters.filter(
    (hotel) => hotel.status === 'ACTIVE' && hotel.city.name.trim().toLowerCase() === c,
  );
  if (!active.length) return undefined;
  active.sort((a, b) => a.name.localeCompare(b.name));
  return active[0];
};

/** Map one stay row onto one default hotel master (same mapping as manual selection). */
function mapRowToDefaultHotel(
  row: HotelInputRow,
  selected: DefaultHotelMaster | undefined,
): HotelInputRow {
  const cityName = (row.city ?? '').trim();
  const images = masterGallerySnapshot(selected?.images, selected?.name ?? 'Hotel');
  // Use the same date-aware master rate as a manual master selection
  // (season → base price). A master without a rate never invents a price and a
  // figure the user already typed is preserved.
  const rate = selected ? hotelRateForDate(selected as never, row.checkInDate) : null;
  const currentSelling = Number(row.sellingPrice ?? 0);
  const sellingPrice =
    rate != null && Number(rate) > 0 && !(currentSelling > 0) ? Number(rate) : currentSelling;
  return {
    ...row,
    hotelId: selected?.id ?? null,
    hotelRoomTypeId: null,
    hotelMealPlanId: null,
    hotelName: selected?.name ?? row.hotelName ?? '',
    city: selected ? selected.city.name : cityName,
    category: selected?.starCategory ? `${selected.starCategory} Star` : null,
    images,
    imageSnapshotPresent: masterGalleryPresence(selected),
    pdfImageUrl: images[0] ? quotationSnapshotImageIdentity(images[0]) : null,
    sellingPrice,
  };
}

/**
 * Expand lead-generated hotel rows through their destinations' default
 * hotels: one stay row per default hotel (up to 10 per destination), each
 * inheriting the stay's dates/nights/rooms. Defaults are resolved by the
 * destination relationship (itinerary city → Destination Master cities), so a
 * default configured for a destination applies to every city within it.
 *
 * Only when a destination has NO default does the row fall back to the best
 * hotel of the SAME city name (exact match) — and never for a non-hotel
 * segment label (Cruise, Airport, …). A row whose city matches no known hotel
 * stays empty rather than borrowing an unrelated hotel; a destination already
 * covered by an earlier row maps to a single default so stays are never
 * dropped and hotels never duplicated.
 */
export function expandDefaultHotelRows(
  rows: HotelInputRow[],
  masters: DefaultHotelMaster[],
  destinationIndex?: HotelDestinationIndex,
): HotelInputRow[] {
  if (!rows.length) return rows;
  const addedHotelIds = new Set<string>();
  for (const row of rows) {
    if (row.hotelId) addedHotelIds.add(row.hotelId);
  }
  const built: HotelInputRow[] = [];
  for (const row of rows) {
    const cityName = (row.city ?? '').trim();
    if (!cityName) continue;
    const defaults = matchDefaultHotels(cityName, masters, destinationIndex);
    const missing = defaults.filter((hotel) => !addedHotelIds.has(hotel.id));
    if (missing.length) {
      for (const hotel of missing) {
        addedHotelIds.add(hotel.id);
        built.push(mapRowToDefaultHotel(row, hotel));
      }
      continue;
    }
    if (defaults.length) {
      built.push(mapRowToDefaultHotel(row, defaults[0]));
      continue;
    }
    // No default for this destination: only fall back to the best hotel of the
    // exact same city (a legitimate city with no configured default). A
    // cruise/transfer-style label is never treated as proof a hotel exists, so
    // it stays empty instead of borrowing an unrelated alphabetical hotel.
    const bestHotel = isNonHotelSegmentLabel(cityName)
      ? undefined
      : matchBestCityHotel(cityName, masters);
    built.push(mapRowToDefaultHotel(row, bestHotel));
  }
  return built;
}

/** Vehicle master shape needed for destination prefill (subset of useVehicles rows). */
export interface PrefillVehicleMaster {
  id: string;
  name: string;
  status: string;
  vehicleType: string;
  description: string | null;
  price?: number | null;
  images: MasterImageMeta[];
  destinations?: Array<{ id: string; name: string }>;
}

/**
 * Every active vehicle assigned to a destination (stable destination-ID
 * match), sorted by name. No limit on matches: the 10-cap constrains
 * assignments per vehicle, never vehicles per destination.
 */
export function matchVehiclesForDestination(
  destinationId: string,
  masters: PrefillVehicleMaster[],
): PrefillVehicleMaster[] {
  if (!destinationId) return [];
  return masters
    .filter(
      (master) =>
        master.status === 'ACTIVE' &&
        (master.destinations ?? []).some((destination) => destination.id === destinationId),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Vehicle prefill applies to brand-new quotations; saved rows are never rewritten. */
export function shouldAutoPrefillVehicles(savedVehicleCount: number): boolean {
  return savedVehicleCount === 0;
}

/** Patch mapping one vehicle master onto a service row (same as manual selection). */
function vehicleRowPatch(master: PrefillVehicleMaster): Record<string, unknown> {
  const images = masterGallerySnapshot(master.images, master.name);
  return {
    city: master.vehicleType || null,
    vehicleId: master.id,
    name: master.name,
    description: master.description ?? null,
    images,
    imageSnapshotPresent: masterGalleryPresence(master),
    pdfImageUrl: images[0] ? quotationSnapshotImageIdentity(images[0]) : null,
    ...(master.price != null && Number(master.price) > 0
      ? { sellingPrice: Number(master.price) }
      : {}),
  };
}

/** One independent prefilled vehicle entry for a destination's section. */
export function mapMasterToVehicleRow(
  master: PrefillVehicleMaster,
  sequence: number,
): QuotationVersionInput['services'][number] {
  return {
    ...newVehicleServiceRow(sequence),
    ...vehicleRowPatch(master),
  } as QuotationVersionInput['services'][number];
}

/**
 * Build prefill rows for destinations in order: every matching vehicle not
 * already present (stable vehicle-ID dedupe across destinations, so a vehicle
 * assigned to several selected destinations appears once). Existing rows are
 * never touched.
 */
export function buildVehiclePrefillRows(
  destinationIds: string[],
  masters: PrefillVehicleMaster[],
  startSequence: number,
  existingVehicleIds: Set<string>,
): QuotationVersionInput['services'][number][] {
  const rows: QuotationVersionInput['services'][number][] = [];
  const seen = new Set(existingVehicleIds);
  let sequence = startSequence;
  for (const destinationId of destinationIds) {
    for (const master of matchVehiclesForDestination(destinationId, masters)) {
      if (seen.has(master.id)) continue;
      seen.add(master.id);
      rows.push(mapMasterToVehicleRow(master, sequence++));
    }
  }
  return rows;
}

/** Add-on master shape needed for destination-default prefill. */
export interface PrefillAddOnMaster {
  id: string;
  name: string;
  status: string;
  description: string | null;
  price?: number | null;
  currency?: string | null;
  pricingBasis?: string | null;
  /** Repeatable pricing options (legacy single price arrives as one entry). */
  pricing?: AddOnServicePricingEntry[];
  images: MasterImageMeta[];
  destinations?: Array<{ id: string; name: string; isDefault: boolean }>;
}

/**
 * Every active default add-on service for one destination (stable
 * destination-ID match), sorted by name. Default status is per destination:
 * the same service may be default for one destination and not for another.
 */
export function matchDefaultAddOnsForDestination(
  destinationId: string,
  masters: PrefillAddOnMaster[],
): PrefillAddOnMaster[] {
  if (!destinationId) return [];
  return masters
    .filter(
      (master) =>
        master.status === 'ACTIVE' &&
        (master.destinations ?? []).some(
          (destination) => destination.id === destinationId && destination.isDefault,
        ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Add-on default prefill applies to brand-new quotations; saved rows are never rewritten. */
export function shouldAutoPrefillAddons(savedAddonCount: number): boolean {
  return savedAddonCount === 0;
}

/** One independent prefilled add-on entry (same mapping as manual toggle). */
export function mapMasterToAddonRow(
  master: PrefillAddOnMaster,
  sequence: number,
): QuotationVersionInput['services'][number] {
  const snapshot = masterGallerySnapshot(master.images, master.name);
  // All options travel in the quotation-owned snapshot; the chargeable unit
  // price defaults to the first priced option (legacy single price otherwise).
  const pricingSnapshot = normalizeAddonPricingSnapshot(master);
  const chargeable =
    pricingSnapshot.find((entry) => entry.price != null)?.price ??
    (master.price != null ? Number(master.price) : null);
  const firstLabel = (pricingSnapshot[0]?.label ?? '').trim();

  return {
    serviceType: 'OTHER_ADD_ON',
    ...CLEARED_SERVICE_MASTERS,
    addOnServiceId: master.id,
    name: master.name,
    description: master.description ?? null,
    dayNumber: null,
    city: null,
    quantity: 1,
    pricingBasis: 'FIXED' as never,
    internalCost: 0,
    sellingPrice: chargeable != null ? Number(chargeable) : 0,
    pricingBasisLabel: firstLabel !== '' ? firstLabel : (master.pricingBasis ?? null),
    pricingSnapshot,
    taxCategory: null,
    notes: null,
    sequence,
    images: snapshot,
    imageSnapshotPresent: masterGalleryPresence(master),
    pdfImageUrl: snapshot[0] ? quotationSnapshotImageIdentity(snapshot[0]) : null,
  } as QuotationVersionInput['services'][number];
}

/**
 * Build prefill rows for destinations in order: every default add-on not
 * already present (stable add-on-ID dedupe across destinations, so a default
 * for several selected destinations appears once). Existing rows are never
 * touched.
 */
export function buildAddonPrefillRows(
  destinationIds: string[],
  masters: PrefillAddOnMaster[],
  startSequence: number,
  existingAddonIds: Set<string>,
): QuotationVersionInput['services'][number][] {
  const rows: QuotationVersionInput['services'][number][] = [];
  const seen = new Set(existingAddonIds);
  let sequence = startSequence;
  for (const destinationId of destinationIds) {
    for (const master of matchDefaultAddOnsForDestination(destinationId, masters)) {
      if (seen.has(master.id)) continue;
      seen.add(master.id);
      rows.push(mapMasterToAddonRow(master, sequence++));
    }
  }
  return rows;
}

/** A clean, empty Cruise service row; the section title defaults to "Cruise Details". */
const newCruiseServiceRow = (sequence: number) => ({
  serviceType: 'CRUISE' as const,
  ...CLEARED_SERVICE_MASTERS,
  name: '',
  description: null,
  dayNumber: null,
  city: null,
  quantity: 1,
  internalCost: 0,
  sellingPrice: 0,
  taxCategory: 'Cruise Details',
  notes: null,
  // Nights are optional: a new stay starts empty, never prefilled with 1.
  cruiseNights: null as unknown as number,
  // Rooms appear only when the user explicitly clicks Add Room: a new stay
  // starts with zero room rows, never a default ROOM 1.
  cruiseRoomLines: [],
  images: [],
  imageSnapshotPresent: false,
  pdfImageUrl: null,
  sequence,
});

/** A clean, empty Vehicle service row; the section title defaults to "Transportation". */
const newVehicleServiceRow = (sequence: number) => ({
  serviceType: 'VEHICLE_TRANSFER' as const,
  ...CLEARED_SERVICE_MASTERS,
  name: '',
  description: null,
  dayNumber: null,
  city: null,
  quantity: 1,
  internalCost: 0,
  sellingPrice: 0,
  pricingBasis: 'PER_DAY' as const,
  taxCategory: 'Transportation',
  notes: null,
  duration: null,
  images: [],
  imageSnapshotPresent: false,
  pdfImageUrl: null,
  sequence,
});

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Combine one policy across ordered destinations: single content is used as-is;
 * multiple distinct contents are joined under escaped destination headings.
 * Identical content from later destinations is dropped.
 */
const combineDestinationPolicy = (
  entries: Array<{ destination: string; content: string }>,
): string | null => {
  const seen = new Set<string>();
  const kept = entries.filter(({ content }) => {
    if (seen.has(content)) return false;
    seen.add(content);
    return true;
  });
  if (!kept.length) return null;
  if (kept.length === 1) return kept[0]!.content;
  return kept
    .map(({ destination, content }) => `<h3>${escapeHtml(destination)}</h3>${content}`)
    .join('\n');
};

/** Destination policy → quotation policy field mapping. */
const DESTINATION_POLICY_MAP = [
  ['inclusionsHtml', 'inclusions'],
  ['exclusionsHtml', 'exclusions'],
  ['paymentPolicies', 'paymentPolicies'],
  ['cancellationPolicies', 'cancellationPolicies'],
  ['bookingTerms', 'bookingTerms'],
  ['childPolicy', 'childPolicy'],
] as const;

type PolicyKey =
  'inclusionsHtml' | 'exclusionsHtml' | 'paymentPolicies' | 'cancellationPolicies' | 'bookingTerms' | 'childPolicy';

/** True when rich-text HTML contains visible content (editor-empty markup excluded). */
export const hasPolicyHtml = (html?: string | null): boolean =>
  Boolean(html && html.replace(/<[^>]*>/g, '').trim());

/** Resolve a policy field value: an explicitly stored quotation value (even an
 *  empty string from a cleared editor) is authoritative; otherwise fall back to
 *  the destination master default. Only null/undefined fall back, so clearing a
 *  policy no longer silently restores the destination master text on reopen. */
export const policyValue = (
  versionValue: string | null | undefined,
  masterValue: string | null | undefined,
): string | null => (versionValue === null || versionValue === undefined ? (masterValue ?? null) : versionValue);

/** Stable id for a By Traveler Additional Price Item (legacy rows get one on load). */
const newPricingRowId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `item-${crypto.randomUUID()}`
    : `item-${Math.random().toString(36).slice(2, 10)}`;

/** Build quotation-policy prefills from the destination masters in lead order. */
export const buildDestinationPolicyPrefill = (
  destinations: Destination[],
  destinationNames: string[],
): Partial<Record<PolicyKey, string>> => {
  const ordered = destinationNames
    .map((name) => {
      const key = name.trim().toLowerCase();
      return destinations.find((d) => d.name.trim().toLowerCase() === key);
    })
    .filter((d): d is Destination => Boolean(d));
  if (!ordered.length) return {};
  const result: Partial<Record<PolicyKey, string>> = {};
  for (const [quoteKey, destField] of DESTINATION_POLICY_MAP) {
    const combined = combineDestinationPolicy(
      ordered
        .map((d) => ({ destination: d.name, content: (d[destField] ?? '').trim() }))
        .filter((entry) => entry.content.length > 0),
    );
    if (combined) result[quoteKey] = combined;
  }
  return result;
};

/**
 * A hotel snapshot image thumbnail in the builder's image manager. Renders the
 * bookmark-preferred URL and falls back to the same image's thumbnail candidate
 * (mirroring the bookmark carousel) when the primary fails to load.
 */
function HotelImageThumb({
  image,
  alt,
  fallbackUrl,
}: {
  image: QuotationImage;
  alt: string;
  fallbackUrl?: string | null | undefined;
}) {
  const [useThumbnail, setUseThumbnail] = useState(false);
  const src =
    (useThumbnail && image.thumbnailUrl ? image.thumbnailUrl : image.url) ?? fallbackUrl ?? null;
  if (!src)
    return (
      <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400">
        <ImageIcon className="h-5 w-5" />
      </div>
    );
  return (
    <img
      src={src}
      alt={alt}
      className="h-16 w-24 shrink-0 rounded-md object-cover"
      onError={() => {
        if (!useThumbnail && image.thumbnailUrl) setUseThumbnail(true);
      }}
    />
  );
}

/** Shared quotation-only gallery controls for Hotel/Vehicle/Cruise images. */
function QuotationImageManager({
  label,
  ariaPrefix,
  images,
  pdfImageUrl,
  fallbackUrls,
  onMove,
  onRemove,
  onSelectPdf,
}: {
  label: string;
  ariaPrefix: string;
  images: QuotationImage[];
  pdfImageUrl?: string | null | undefined;
  fallbackUrls?: Record<string, string | undefined>;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  onSelectPdf: (identity: string) => void;
}) {
  if (!images.length) return null;
  const selected =
    images.find((image) => quotationSnapshotImageIdentity(image) === pdfImageUrl) ?? images[0];
  const selectedIdentity = selected ? quotationSnapshotImageIdentity(selected) : null;
  return (
    <div className="space-y-2.5 border-t border-slate-200 p-4">
      <h4 className="text-sm font-semibold text-slate-800">
        {label}{' '}
        <span className="font-normal text-slate-400">
          ({images.length}) · order saved with the quotation
        </span>
      </h4>
      {images.map((image, imageIndex) => {
        const identity = quotationSnapshotImageIdentity(image);
        const fallbackUrl = identity ? fallbackUrls?.[identity] : undefined;
        return (
          <div
            key={`${identity ?? 'image'}-${imageIndex}`}
            className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-2.5"
          >
            <HotelImageThumb
              image={image}
              fallbackUrl={fallbackUrl}
              alt={image.alt ?? `${label} ${imageIndex + 1}`}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={imageIndex === 0}
                aria-label={`Move ${ariaPrefix} image ${imageIndex + 1} left`}
                onClick={() => onMove(imageIndex, -1)}
              >
                <ArrowLeft className="h-4 w-4" /> Move Left
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={imageIndex === images.length - 1}
                aria-label={`Move ${ariaPrefix} image ${imageIndex + 1} right`}
                onClick={() => onMove(imageIndex, 1)}
              >
                Move Right <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-label={`Remove ${ariaPrefix} image ${imageIndex + 1}`}
                onClick={() => onRemove(imageIndex)}
              >
                <X className="h-4 w-4" /> Remove
              </Button>
            </div>
            {identity && (
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name={`${ariaPrefix}-pdf-image`}
                  aria-label={`Use ${ariaPrefix} image ${imageIndex + 1} in PDF`}
                  checked={identity === selectedIdentity}
                  onChange={() => onSelectPdf(identity)}
                  className="accent-brand-600"
                />
                Use in PDF
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PersistInitialQuotationSnapshot({
  enabled,
  ready,
  onPersist,
}: {
  enabled: boolean;
  ready: boolean;
  onPersist: () => void;
}) {
  const attempted = useRef(false);
  const persistRef = useRef(onPersist);
  persistRef.current = onPersist;
  useEffect(() => {
    if (!enabled || !ready || attempted.current) return;
    attempted.current = true;
    const timer = window.setTimeout(() => persistRef.current(), 0);
    return () => window.clearTimeout(timer);
  }, [enabled, ready]);
  return null;
}

/** Canonical pricing-category order and their customer-facing labels. */
const PRICING_SECTION_LABELS: Record<string, string> = {
  flight: 'Flights',
  hotel: 'Hotels',
  cruise: 'Cruise',
  vehicle: 'Transportation',
  sightseeing: 'Sightseeing',
  addon: 'Add-ons',
  visa: 'Visa',
};
const DEFAULT_PRICING_ORDER = Object.keys(PRICING_SECTION_LABELS);

/**
 * Editable traveller mix keys for the "Summary & Pricing" tab. The bounds mirror
 * the quotation schema (adults ≥ 1, others ≥ 0; adults ≤ 200, children ≤ 100) so
 * a manually entered count can never be persisted as invalid.
 */
type TravelerCountKey = 'adults' | 'cwb' | 'cwob' | 'infants';
const TRAVELER_COUNT_MIN: Record<TravelerCountKey, number> = {
  adults: 1,
  cwb: 0,
  cwob: 0,
  infants: 0,
};
const TRAVELER_COUNT_MAX: Record<TravelerCountKey, number> = {
  adults: 200,
  cwb: 100,
  cwob: 100,
  infants: 100,
};
const clampTravelerCount = (key: TravelerCountKey, value: number): number =>
  Math.min(TRAVELER_COUNT_MAX[key], Math.max(TRAVELER_COUNT_MIN[key], Math.floor(value)));

export function QuotationBuilderPage() {
  const { quotationId = '', versionId = '' } = useParams();
  const navigate = useNavigate();
  const { hasPermission, user } = useAuth();
  const canCost = hasPermission(PERMISSIONS.QUOTATIONS_VIEW_COSTING);
  const canManageAirlineMedia = hasPermission(PERMISSIONS.MASTER_AIRLINES_MANAGE_MEDIA);
  const quotation = useQuotation(quotationId);
  const save = useUpdateQuotationVersion(quotationId, versionId);
  // Traveller counts live on the quotation (copied from the lead), not in the
  // version snapshot, so manual edits are persisted with a quotation-level PATCH
  // before the version save recomputes the stored totals from them.
  const updateQuotation = useUpdateQuotation(quotationId);
  const weblinkSettings = useUpdateQuotationWeblinkSettings(quotationId);
  const weblinkName = useUpdateQuotationWeblinkName(quotationId);
  const [weblinkNameValue, setWeblinkNameValue] = useState('');
  const [weblinkNameError, setWeblinkNameError] = useState('');
  const addOnMasters = useAddOnServices(
    useMemo(() => new URLSearchParams({ status: 'ACTIVE', pageSize: '100' }), []),
  );
  const hotelMasters = useHotels(
    useMemo(() => new URLSearchParams({ status: 'ACTIVE', pageSize: '100' }), []),
  );
  const cruiseMasters = useCruises(
    useMemo(() => new URLSearchParams({ status: 'ACTIVE', pageSize: '100' }), []),
  );
  const destinationMasters = useAllDestinations(
    useMemo(() => new URLSearchParams({ status: 'ACTIVE' }), []),
  );
  // City → destination stable-id index used to resolve an itinerary city to the
  // parent destination whose default hotels should prefill (see
  // matchDefaultHotels). Rebuilt only when the destination feed changes.
  const hotelDestinationIndex = useMemo(
    () => buildHotelDestinationIndex(destinationMasters.data?.data ?? []),
    [destinationMasters.data?.data],
  );
  // Automatic default-hotel prefill state. Automatic initialization is tracked
  // separately from an explicit user choice so Hotel is never re-enabled after
  // the user turns it off.
  const autoHotelRef = useRef<{ userToggledHotel: boolean; enabledByAuto: boolean }>({
    userToggledHotel: false,
    enabledByAuto: false,
  });
  // Add-on defaults the user explicitly removed in the table. The automatic
  // population below must not resurrect them while the same version is open.
  // Reset whenever a different version loads (checked inside the effect).
  const dismissedAddonsRef = useRef<{ versionId: string | null; ids: Set<string> }>({
    versionId: null,
    ids: new Set(),
  });
  const hotelPreviewImportsRef = useRef<Set<string>>(new Set());
  // Automatic vehicle prefill: for NEW quotations, each selected destination's
  // Manual cruise cabin-rate overrides per service row index (sellingPrice). Set when user types, cleared on room/cruise change.
  const cruisePriceOverridesRef = useRef<Set<number>>(new Set());
  // Hotel TOTAL ROOMS rows currently being typed into, per stay row id. While
  // a row is in this set, clearing the field to type a replacement must not
  // snap the display back to the calculated sum mid-keystroke. Entries are
  // removed once a real value is typed, on blur with nothing stored, or via
  // "Reset to calculated total". Persisted truth lives in the row's
  // `roomsOverride`, never here — row ids (not indices) survive reorder.
  const hotelRoomsTypingRef = useRef<Set<string>>(new Set());
  // Vehicle description manual override per vehicle index – set when user edits, cleared when vehicle model changes
  const vehicleDescriptionOverriddenRef = useRef<Set<number>>(new Set());
  const vehicleMasters = useVehicles(
    useMemo(() => new URLSearchParams({ status: 'ACTIVE', pageSize: '100' }), []),
  );
  // Sightseeing is the default subtab whenever the builder opens a quotation;
  // the tab is local UI state (never persisted), so each open starts here.
  const [activeTab, setActiveTab] = useState('sightseeing');
  // Overflow container for the sub-tab bar: the active tab is scrolled into
  // view on switch so it never hides outside the visible strip.
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  // Edge-arrow visibility for the tab strip: shown only while scrolling in
  // that direction is possible. Recomputed on scroll and tab switches.
  const [tabScroll, setTabScroll] = useState({ left: false, right: false });
  const updateTabScroll = () => {
    const el = tabBarRef.current;
    if (!el) return;
    setTabScroll({
      left: el.scrollLeft > 0,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  };
  useEffect(() => {
    tabBarRef.current
      ?.querySelector<HTMLElement>('[data-active-tab="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    updateTabScroll();
  }, [activeTab]);
  const scrollTabs = (direction: 1 | -1) => {
    tabBarRef.current?.scrollBy?.({ left: direction * 240, behavior: 'smooth' });
  };
  // If the temporarily hidden Visa tab is somehow the active tab, fall back to
  // the nearest visible tab instead of showing a blank panel.
  useEffect(() => {
    if (!SHOW_VISA_QUOTATION_TAB && activeTab === 'visa') setActiveTab('vehicle');
  }, [activeTab]);
  // Destination Expert is temporarily hidden – same fallback as Visa.
  useEffect(() => {
    if (!SHOW_DESTINATION_EXPERT_TAB && activeTab === 'destinationExpert') setActiveTab('setting');
  }, [activeTab]);
  // Cruise and Vehicle start excluded: the user explicitly enables them (auto-creating the
  // first entry). Saved quotations with rows re-enable on load.
  const [excluded, setExcluded] = useState<Record<string, boolean>>({ cruise: true, vehicle: true });
  // Local-only expand/collapse for Hotel Stay cards. UI state only — never
  // persisted. Every stay starts collapsed whenever the builder is opened.
  const [expandedHotels, setExpandedHotels] = useState<Record<string, boolean>>({});
  // Most recently expanded hotel stay (field id): the live preview follows
  // this card. Cleared when that stay collapses; removal falls back
  // gracefully to the section (see the preview target below).
  const [lastExpandedHotelRowId, setLastExpandedHotelRowId] = useState<string | null>(null);
  // Local-only expand/collapse for Cruise Stay cards, keyed by row id. UI state
  // only — never persisted, and it never resets the underlying form data.
  // Every cruise card starts collapsed whenever the Cruise subtab is shown.
  const [expandedCruises, setExpandedCruises] = useState<Record<string, boolean>>({});
  useEffect(() => {
    // Re-opening the Cruise subtab resets to the all-collapsed default. Only
    // the expand/collapse UI state is cleared; cruise field values are kept.
    if (activeTab === 'cruise') setExpandedCruises({});
  }, [activeTab]);
  // Local-only expand/collapse for Vehicle cards, keyed by row id. UI state
  // only — never persisted, and it never resets the underlying form data.
  // Every vehicle card starts collapsed whenever the Vehicle subtab is shown.
  const [expandedVehicles, setExpandedVehicles] = useState<Record<string, boolean>>({});
  useEffect(() => {
    // Re-opening the Vehicle subtab resets to the all-collapsed default. Only
    // the expand/collapse UI state is cleared; vehicle field values are kept.
    if (activeTab === 'vehicle') setExpandedVehicles({});
  }, [activeTab]);
  // Selected sightseeing day position (reported by SightseeingSection): the
  // live preview follows this day. Position-based, so reorder/add/remove stay
  // exact via the matching source index stamped on each rendered day.
  const [activeSightseeingDay, setActiveSightseeingDay] = useState(0);
  // Expanded flight record position (reported by FlightRecordCard): the live
  // preview follows this flight's journey legs. Null until the user expands
  // a flight; collapsing the active one falls back to the section.
  const [activeFlightIndex, setActiveFlightIndex] = useState<number | null>(null);
  // Local-only expand/collapse for the Weblink Section Order accordion. UI
  // state only — never persisted. Always starts collapsed on every load.
  const [sectionOrderOpen, setSectionOrderOpen] = useState(false);
  // Extra Charges drawer state — By Section only
  const [extraChargeDrawerOpen, setExtraChargeDrawerOpen] = useState(false);
  const [editingExtraIndex, setEditingExtraIndex] = useState<number | null>(null);
  const [extraDraft, setExtraDraft] = useState<{ label: string; amount: string; description: string; category: string }>({ label: '', amount: '', description: '', category: '' });
  const [extraDraftError, setExtraDraftError] = useState('');
  useEffect(() => {
    setWeblinkNameValue(quotation.data?.publicSlug ?? '');
  }, [quotation.data?.publicSlug]);
  const normalizedWeblinkSlug = normalizePublicSlug(weblinkNameValue);
  const weblinkNamePreview =
    normalizedWeblinkSlug &&
    !isReservedPublicSlug(normalizedWeblinkSlug) &&
    quotation.data?.publicSlugBaseUrl
      ? `${quotation.data.publicSlugBaseUrl}/${normalizedWeblinkSlug}`
      : null;
  const saveWeblinkName = () => {
    setWeblinkNameError('');
    const value = weblinkNameValue.trim();
    if (value && !normalizePublicSlug(value)) {
      setWeblinkNameError('Enter a valid Weblink name.');
      return;
    }
    weblinkName.mutate(
      { publicSlug: value ? normalizePublicSlug(value) : null },
      {
        onSuccess: (result) => setWeblinkNameValue(result.publicSlug ?? ''),
        onError: (error) =>
          setWeblinkNameError(
            error instanceof Error && error.message
              ? error.message
              : 'Unable to save Weblink name.',
          ),
      },
    );
  };
  // Tracks whether the user has explicitly toggled a section's Include checkbox
  // so the init-time sync (from the lead's requested services) never re-enables
  // a section after a manual choice.
  const autoToggleRef = useRef<Set<string>>(new Set());
  // Version 1 is initially created before the builder's master-driven prefills
  // are available. Persist that completed client snapshot exactly once so the
  // public weblink and PDFs never read the sparse server seed.
  const initialSnapshotRef = useRef({ attempted: false, autoSaving: false });
  // Wait for the reset/prefill effect itself, not merely its backing queries.
  // Otherwise V1 can persist the sparse server seed one effect too early.
  const [initializedFormVersionId, setInitializedFormVersionId] = useState<string | null>(null);
  // Manual traveller-count edits from "Summary & Pricing". Empty until the user
  // types, so the lead/quotation prefill keeps working; once edited the user's
  // value wins and is never reset by a refetch, another form field, or a tab
  // switch. Stored as raw strings so an in-progress entry (e.g. clearing before
  // retyping) is preserved; the numeric value is normalised for pricing.
  const [travelerCountEdits, setTravelerCountEdits] = useState<
    Partial<Record<TravelerCountKey, string>>
  >({});
  // A different quotation or version starts from a clean prefill again.
  useEffect(() => {
    setTravelerCountEdits({});
  }, [quotationId, versionId]);
  // Keep the resolver in sync with the latest include/exclude state without
  // re-creating the whole form. Hotel is the only tab that always carries a
  // default empty row, so excluding it must bypass hotel validation entirely.
  const excludedRef = useRef(excluded);
  useEffect(() => {
    excludedRef.current = excluded;
  }, [excluded]);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const [flightImagePreviewUrls, setFlightImagePreviewUrls] = useState<Record<string, string>>({});
  const [flightImageUploading, setFlightImageUploading] = useState(false);
  const [flightImageError, setFlightImageError] = useState('');
  // Sightseeing quotation-document image URLs keyed by document id, mirroring
  // the flight pattern: saved attachments resolve below, fresh uploads patch
  // the map through onSightseeingPreviewUrl so the preview updates instantly.
  const [sightseeingPreviewUrls, setSightseeingPreviewUrls] = useState<Record<string, string>>({});
  const handleSightseeingPreviewUrl = useCallback((documentId: string, url: string) => {
    setSightseeingPreviewUrls((current) => ({ ...current, [documentId]: url }));
  }, []);
  // Persistent side-by-side live preview: the editor narrows and the complete
  // customer quotation stays mounted beside it until the user exits the mode.
  // This is the single quotation preview feature. Open by default on desktop
  // and mobile; a single `livePreviewPinned` boolean is the only open/close
  // state (no separate pane switch).
  const [livePreviewPinned, setLivePreviewPinned] = useState(true);
  // Per-click navigation signal for the live preview. The preview must follow
  // EVERY tab selection, including re-clicking the already-active tab (React
  // bails out of a same-value `setActiveTab`, which would otherwise leave the
  // resolved preview target — and therefore the scroll — unchanged). This
  // counter increments on each tab click so the preview re-navigates even when
  // the section value is identical; plain edits never touch it, so typing can
  // never yank the reader's scroll position.
  const [previewNavRequest, setPreviewNavRequest] = useState(0);
  const form = useForm<QuotationVersionInput>({
    resolver: async (values, context, options) => {
      // When a section is excluded, its rows must not be required. Hotel rows
      // and Cruise/Vehicle service rows are normalised away so an empty default row
      // never blocks a draft save.
      let prepared: QuotationVersionInput = values;
      if (excludedRef.current.hotel) prepared = { ...prepared, hotels: [] };
      if (excludedRef.current.cruise)
        prepared = {
          ...prepared,
          services: (prepared.services ?? []).filter((service) => service.serviceType !== 'CRUISE'),
        };
      if (excludedRef.current.vehicle)
        prepared = {
          ...prepared,
          services: (prepared.services ?? []).filter((service) => service.serviceType !== 'VEHICLE_TRANSFER'),
        };
      // Additional Price Items: drop blank-label / non-positive rows so an
      // in-progress row never blocks a save. They are ignored by every pricing
      // engine when the quotation is section-priced, so keeping them here never
      // changes a By Section total.
      prepared = {
        ...prepared,
        packageCustomItems: (prepared.packageCustomItems ?? []).filter(
          (item) => (item.label ?? '').trim().length > 0 && Number(item.amount) > 0,
        ),
      };
      return zodResolver(quotationVersionInputSchema)(prepared, context, options);
    },
    defaultValues: defaults,
  });
  const itinerary = useFieldArray({ control: form.control, name: 'itinerary' });
  const watchedPricingMode = useWatch({ control: form.control, name: 'pricingMode' });
  const isSectionWiseMode = watchedPricingMode === 'SECTION_WISE';
  const visibleTabs = useMemo(
    () => TABS.filter((tab) => isSectionWiseMode || tab.key !== 'pricingBreakdown'),
    [isSectionWiseMode],
  );
  useEffect(() => {
    if (!isSectionWiseMode && activeTab === 'pricingBreakdown') setActiveTab('summary');
  }, [activeTab, isSectionWiseMode]);
  const hotels = useFieldArray({ control: form.control, name: 'hotels' });
  /** Import saved hotel bookmarks into the quotation form (DB only). */
  const importHotelBookmark = (bookmarks: LiveSearchBookmark[]) => {
    // The bookmark never writes the section Description (the provider summary
    // goes only into each stay Remark). Keep an existing manually entered
    // Description so a re-import never wipes it.
    const existingDescription = form.getValues('hotelDetails')?.description ?? null;
    // One independent stay per valid bookmark, in the entered order. Section
    // amount reflects the last imported hotel's saved price.
    const imported = bookmarks.map((bookmark) => hotelBookmarkToDetails(bookmark));
    const primary = imported[0];
    if (primary) {
      const last = imported[imported.length - 1]!;
      form.setValue(
        'hotelDetails',
        {
          ...last.hotelDetails,
          description: existingDescription,
          images: [],
          pdfImageUrl: null,
        },
        { shouldDirty: true },
      );
      if (bookmarks[0]?.currency)
        form.setValue('currency', bookmarks[0].currency, { shouldDirty: true });
    }
    // Append the imported stays as additional independent rows, preserving any
    // existing hotel stays already in the quotation.
    hotels.append(imported.map((entry) => entry.hotelRow));
    setExcluded((prev) => ({ ...prev, hotel: false }));
  };
  const services = useFieldArray({ control: form.control, name: 'services' });
  const faqs = useFieldArray({ control: form.control, name: 'faqs' });
  const flightRecords = useFieldArray({ control: form.control, name: 'flightDetails.flights' });
  // Live preview item target: the active item within the active tab's public
  // section, derived ONLY from selection state (tab, selected day, expanded
  // hotel/flight) — never from field text — so typing can never retrigger
  // navigation. Positions map exactly because the public quotation renders the
  // same arrays in the same order (each rendered item carries its source
  // position as `data-preview-item`). Tabs without a per-item selection
  // affordance (cruise, vehicle, add-ons, FAQs, inclusions, pricing, settings)
  // resolve to section-level navigation via an empty item list.
  const previewTargetItems = useMemo((): string[] => {
    if (activeTab === 'sightseeing') return [`day:${Math.max(0, activeSightseeingDay)}`];
    if (activeTab === 'hotel' && lastExpandedHotelRowId) {
      if (!(expandedHotels[lastExpandedHotelRowId] ?? false)) return [];
      const position = hotels.fields.findIndex((field) => field.id === lastExpandedHotelRowId);
      return position >= 0 ? [`hotel:${position}`] : [];
    }
    if (activeTab === 'flight' && activeFlightIndex != null) {
      if (activeFlightIndex < 0 || activeFlightIndex >= flightRecords.fields.length) return [];
      return [
        `flight:flight-${activeFlightIndex}-outbound`,
        `flight:flight-${activeFlightIndex}-return`,
      ];
    }
    return [];
  }, [
    activeTab,
    activeSightseeingDay,
    lastExpandedHotelRowId,
    expandedHotels,
    hotels.fields,
    activeFlightIndex,
    flightRecords.fields,
  ]);
  const airlines = useAirlines(
    useMemo(() => new URLSearchParams({ status: 'ACTIVE', pageSize: '100' }), []),
  );
  const createAirline = useCreateAirline();
  const queryClient = useQueryClient();
  // Master lists the live preview resolves presentations from. These are the
  // builder's own picker queries (already loaded); the preview never refetches
  // lists — only signed download URLs and uncached hotel details on demand.
  const previewMasters = useMemo(
    () => ({
      destinations: destinationMasters.data?.data ?? [],
      cruises: cruiseMasters.data?.data ?? [],
      vehicles: vehicleMasters.data?.data ?? [],
      airlines: airlines.data?.data ?? [],
    }),
    [
      destinationMasters.data?.data,
      cruiseMasters.data?.data,
      vehicleMasters.data?.data,
      airlines.data?.data,
    ],
  );
  const expertUsersQuery = useUsers(useMemo(() => new URLSearchParams({ pageSize: '100' }), []));
  const settingsQuery = useSettings();
  // Automatic weblink display texts (hero + profile) for the Settings tab
  // placeholders: resolved exactly like the public rendering, with no
  // overrides, from the quotation's own data. Static per quotation load —
  // the auto values themselves depend only on non-editable lead data here.
  const weblinkAutoDisplay = useMemo(() => {
    const itinerary = (quotation.data?.query?.itinerary ?? []) as Array<{
      country?: string | null;
      nights?: number | null;
    }>;
    return resolveWeblinkDisplay(
      {
        destinations: previewDestinations(itinerary, quotation.data?.destinationSummary ?? ''),
        destinationSummary: quotation.data?.destinationSummary ?? '',
        durationNights: previewDurationNights(itinerary),
        travelStartDate: quotation.data?.travelStartDate ?? null,
        travelEndDate: quotation.data?.travelEndDate ?? null,
        customerName: quotation.data?.customerName ?? '',
      },
      { weblinkHeading: null, packageHeading: null, weblinkDurationText: null, weblinkProfileDestination: null },
    );
  }, [quotation.data]);
  const destinationExpertPresetsQuery = useDestinationExpertPresets();
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [expertImportLoading, setExpertImportLoading] = useState(false);
  const [expertImportError, setExpertImportError] = useState<string | null>(null);
  const [expertImportSuccess, setExpertImportSuccess] = useState<string | null>(null);
  const watchedExpertConfig = useWatch({ control: form.control, name: 'destinationExpertConfig' });
  const filteredDestinationExpertPresets = useMemo(() => {
    const all = destinationExpertPresetsQuery.data ?? [];
    if (!all.length) return [];
    const tokens = new Set<string>();
    const add = (v: string | null | undefined) => {
      for (const part of (v ?? '').split(/[•,>/→|-]+/)) {
        const t = part.trim().toLowerCase();
        if (t) tokens.add(t);
      }
    };
    for (const stay of quotation.data?.query?.itinerary ?? []) {
      add((stay as unknown as { country?: string | null })?.country);
      add((stay as unknown as { destination?: string | null })?.destination);
    }
    add(quotation.data?.destinationSummary);
    if (!tokens.size) return all;
    return all.filter((p) => {
      const key = p.destination.trim().toLowerCase();
      return [...tokens].some((t) => key === t || key.includes(t) || t.includes(key));
    });
  }, [destinationExpertPresetsQuery.data, quotation.data]);
  const masterFaqsQuery = useFaqs(
    useMemo(() => new URLSearchParams({ status: 'ACTIVE', pageSize: '100' }), []),
  );
  const faqPrefillAttemptedRef = useRef(false);
  const [importedFaqDestination, setImportedFaqDestination] = useState<string | null>(null);

  // Real company/expert fallback contacts (never fake). Used to prefill when selecting expert.
  const getExpertFallback = (expertId: string | null) => {
    const expert = (expertUsersQuery.data?.data ?? []).find(
      (u: { id: string }) => u.id === expertId,
    ) as unknown as { whatsappNumber?: string | null; phone?: string | null; email?: string | null } | undefined;
    const companyPhone = settingsQuery.data?.profile.phone ?? null;
    const companyEmail = settingsQuery.data?.profile.email ?? null;
    const whatsappNumber =
      expert?.whatsappNumber?.trim() || expert?.phone?.trim() || companyPhone?.trim() || null;
    const callNumber = expert?.phone?.trim() || companyPhone?.trim() || null;
    const email = expert?.email?.trim() || companyEmail?.trim() || null;
    return { whatsappNumber, callNumber, email };
  };
  // Always force Destination Expert to current user (particular user can create data for itself)
  useEffect(() => {
    if (watchedExpertConfig?.enabled && user?.id && watchedExpertConfig.expertUserId !== user.id) {
      const cur = form.getValues('destinationExpertConfig') as unknown as Record<string, unknown> | null;
      const fallback = getExpertFallback(user.id);
      form.setValue(
        'destinationExpertConfig',
        {
          ...(cur ?? {}),
          enabled: true,
          expertUserId: user.id,
          whatsappNumber: (cur as Record<string, unknown> | null)?.whatsappNumber || fallback.whatsappNumber,
          callNumber: (cur as Record<string, unknown> | null)?.callNumber || fallback.callNumber,
          email: (cur as Record<string, unknown> | null)?.email || fallback.email,
        } as never,
        { shouldDirty: true },
      );
    }
  }, [user?.id, watchedExpertConfig?.enabled, watchedExpertConfig?.expertUserId]);

  // Sightseeing master resolved by destinationId for each lead itinerary stay
  // instead of imprecise free-text search — guarantees complete city coverage.
  const destinationIdSet = useMemo(() => {
    const ids = new Set<string>();
    if (!destinationMasters.data?.data) return ids;
    const byName = new Map<string, string>();
    for (const dest of destinationMasters.data.data)
      byName.set(dest.name.trim().toLowerCase(), dest.id);
    for (const stay of quotation.data?.query?.itinerary ?? []) {
      const key = stay.country?.trim().toLowerCase();
      if (key) {
        const id = byName.get(key);
        if (id) ids.add(id);
      }
    }
    return ids;
  }, [destinationMasters.data?.data, quotation.data?.query?.itinerary]);
  // Vehicle prefill must react to destinations selected in the *quotation builder*
  // itself (itinerary / hotels / destinationSummary), not only the static lead.
  // This powers "select destination → vehicles appear" without manual Add.
  const watchedFormItinerary = useWatch({ control: form.control, name: 'itinerary' });
  const watchedFormHotels = useWatch({ control: form.control, name: 'hotels' });
  const watchedDestinationSummary = useWatch({ control: form.control, name: 'destinationSummary' });
  const vehicleEffectiveDestinationIds = useMemo(() => {
    const ids = new Set<string>(destinationIdSet);
    if (!destinationMasters.data?.data) return ids;
    const byName = new Map<string, string>();
    for (const dest of destinationMasters.data.data)
      byName.set(dest.name.trim().toLowerCase(), dest.id);
    for (const row of (watchedFormItinerary ?? []) as Array<Record<string, unknown>>) {
      for (const raw of [(row as { country?: string })?.country, (row as { destination?: string })?.destination]) {
        const key = String(raw ?? '').trim().toLowerCase();
        if (!key) continue;
        const id = byName.get(key);
        if (id) ids.add(id);
      }
    }
    for (const row of (watchedFormHotels ?? []) as Array<Record<string, unknown>>) {
      const key = String((row as { city?: string })?.city ?? '').trim().toLowerCase();
      if (!key) continue;
      const id = byName.get(key);
      if (id) ids.add(id);
    }
    const summary = String(watchedDestinationSummary ?? '').trim();
    if (summary) {
      for (const part of summary.split(/[•,>/→|-]+/)) {
        const key = part.trim().toLowerCase();
        if (!key) continue;
        const id = byName.get(key);
        if (id) ids.add(id);
      }
    }
    return ids;
  }, [destinationIdSet, destinationMasters.data?.data, watchedFormItinerary, watchedFormHotels, watchedDestinationSummary]);
  // Destinations whose hotels can apply to this quotation: resolved from the
  // lead itinerary, the currently edited itinerary, the live hotel rows and the
  // destination summary. Stable ids (not names) scope every default query.
  const hotelDestinationIds = useMemo(
    () =>
      collectHotelDestinationIds({
        index: hotelDestinationIndex,
        itinerary: [
          ...(quotation.data?.query?.itinerary ?? []),
          ...(((watchedFormItinerary ?? []) as Array<Record<string, unknown>>) ?? []).map((row) => ({
            destination: String((row as { destination?: unknown })?.destination ?? ''),
            country: String((row as { country?: unknown })?.country ?? ''),
            nights: null,
          })),
        ],
        hotelCities: ((watchedFormHotels ?? []) as Array<Record<string, unknown>>).map((row) =>
          String((row as { city?: unknown })?.city ?? ''),
        ),
        destinationSummary: String(watchedDestinationSummary ?? ''),
      }),
    [
      hotelDestinationIndex,
      quotation.data?.query?.itinerary,
      watchedFormItinerary,
      watchedFormHotels,
      watchedDestinationSummary,
    ],
  );
  // Complete, destination-scoped hotel pool (all ACTIVE hotels of the relevant
  // destinations, every page). Defaults are resolved from this pool instead of
  // the first 100 newest hotels, so a default beyond that window still applies.
  const hotelPrefillPool = useHotelsForDestinations(hotelDestinationIds);
  // Stabilise the pool reference: `combine` builds a fresh array, so key the
  // memo on the sorted id signature — identical content keeps the same array
  // reference and the init `form.reset` effect does not loop.
  const hotelPoolSignature = useMemo(
    () => hotelPrefillPool.data.map((hotel) => hotel.id).join('|'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hotelPrefillPool.data.map((hotel) => hotel.id).join('|')],
  );
  const hotelDestinationSignature = hotelDestinationIds.join('|');
  // Until a destination can be resolved there is nothing to scope a query by;
  // fall back to the legacy paged feed so a city-only quotation still prefills.
  const hotelPrefillMasters = useMemo<DefaultHotelMaster[]>(
    () =>
      hotelDestinationIds.length
        ? (hotelPrefillPool.data as unknown as DefaultHotelMaster[])
        : ((hotelMasters.data?.data ?? []) as unknown as DefaultHotelMaster[]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hotelDestinationSignature, hotelPoolSignature, hotelMasters.data?.data],
  );
  const hotelPrefillReady = hotelDestinationIds.length === 0 || !hotelPrefillPool.isPending;
  // Per-destination vehicle masters for auto-prefill: for each quotation destination ID,
  // fetch ACTIVE vehicles linked to that destination via the backend's destinationId filter.
  // Uses the actual Vehicle Master destination link (vehicle → many destinations).
  const vehiclesByDestination = useQueries({
    queries: [...vehicleEffectiveDestinationIds].map((destinationId) => ({
      queryKey: ['masters', 'vehicles', 'byDestination', destinationId],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiClient.get<Page<any>>(
          `/masters/vehicles?status=ACTIVE&pageSize=100&destinationId=${encodeURIComponent(destinationId)}`,
          signal,
        ),
      enabled: !!destinationId,
    })),
  });
  // Per-destination default add-on services for auto-populate: for each
  // quotation destination ID, fetch ACTIVE add-ons marked default for it.
  // Reuses the same effective destination IDs as the vehicle prefill.
  const addonsByDestination = useQueries({
    queries: [...vehicleEffectiveDestinationIds].map((destinationId) => ({
      queryKey: ['masters', 'add-on-services', 'byDestination', destinationId, 'defaults'],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiClient.get<Page<PrefillAddOnMaster>>(
          `/masters/add-on-services?status=ACTIVE&pageSize=100&destinationId=${encodeURIComponent(destinationId)}&isDefault=true`,
          signal,
        ),
      enabled: !!destinationId,
    })),
  });
  // Resolved Master Destination name (country) from the lead itinerary — the
  // sightseeing feed resolves activities by destination, while the quotation's
  // destinationSummary often holds the city (e.g. "Kuala Lumpur").
  const sightseeingDestinationName = useMemo(() => {
    const byName = new Map<string, string>();
    for (const dest of destinationMasters.data?.data ?? [])
      byName.set(dest.name.trim().toLowerCase(), dest.name.trim());
    for (const stay of quotation.data?.query?.itinerary ?? []) {
      const key = stay.country?.trim().toLowerCase();
      if (key) {
        const name = byName.get(key);
        if (name) return name;
      }
    }
    return null;
  }, [destinationMasters.data?.data, quotation.data?.query?.itinerary]);
  const sightseeingMasters = useSightseeingList(
    useMemo(() => {
      const params = new URLSearchParams({ status: 'ACTIVE', pageSize: '100' });
      const firstId = [...destinationIdSet][0];
      if (firstId) params.set('destinationId', firstId);
      return params;
    }, [destinationIdSet]),
  );
  const version = quotation.data?.versions.find((row) => row.id === versionId);
  const builderVersion = useMemo(
    () => (version ? normalizeQuotationVersionForBuilder(version) : undefined),
    [version],
  );

  // Automatic profile-card values for the Settings placeholders, resolved with
  // no overrides so the builder previews exactly what the public weblink shows.
  const weblinkAutoProfile = useMemo(() => {
    const d = quotation.data;
    const travelers = [
      d?.adults && `${d.adults} Adult${d.adults > 1 ? 's' : ''}`,
      d?.childrenWithBed && `${d.childrenWithBed} CWB`,
      d?.childrenWithoutBed && `${d.childrenWithoutBed} CWOB`,
      d?.infants && `${d.infants} Infant${d.infants > 1 ? 's' : ''}`,
    ]
      .filter(Boolean)
      .join(', ');
    return resolveWeblinkProfile({
      autoValues: {
        travelerName: d?.customerName ?? '',
        travelDate: dateShort(d?.travelStartDate ?? null) ?? 'Flexible',
        duration: weblinkAutoDisplay.durationText ?? 'As advised',
        travelers,
        cwbAges: '',
        cwobAges: '',
        infantAges: '',
        quotationId: formatPublicQuotationNumber(d?.quotationNumber ?? ''),
        destinations: weblinkAutoDisplay.profileDestination,
      },
      autoPreparedBy: {
        name: builderVersion?.createdBy?.fullName ?? d?.createdBy?.fullName ?? '',
        phone: settingsQuery.data?.profile?.phone ?? '',
        email: settingsQuery.data?.profile?.email ?? '',
      },
      overrides: null,
    });
  }, [quotation.data, weblinkAutoDisplay, builderVersion, settingsQuery.data]);
  const watchedWeblinkProfile = form.watch('weblinkProfile');
  const setWeblinkProfileField = (
    id: WeblinkProfileFieldId,
    patch: { label?: string | null; value?: string | null; hidden?: boolean },
  ) => {
    const base = form.getValues('weblinkProfile') ?? {};
    form.setValue(
      'weblinkProfile',
      { ...base, [id]: { ...(base[id] ?? {}), ...patch } },
      { shouldDirty: true },
    );
  };
  const setWeblinkProfilePreparedBy = (patch: {
    label?: string | null;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    hidden?: boolean;
  }) => {
    const base = form.getValues('weblinkProfile') ?? {};
    form.setValue(
      'weblinkProfile',
      { ...base, preparedBy: { ...(base.preparedBy ?? {}), ...patch } },
      { shouldDirty: true },
    );
  };

  // Quotation destination name tokens (lead itinerary country/destination + summary)
  // used to match destination-attached master FAQs.
  const quotationDestinationTokens = useMemo(() => {
    const tokens = new Set<string>();
    const add = (value: string | null | undefined) => {
      for (const part of (value ?? '').split(/[•,>/→|-]+/)) {
        const trimmed = part.trim().toLowerCase();
        if (trimmed) tokens.add(trimmed);
      }
    };
    for (const stay of quotation.data?.query?.itinerary ?? []) {
      add(stay.country);
      add(stay.destination);
    }
    add(quotation.data?.destinationSummary);
    return tokens;
  }, [quotation.data?.query?.itinerary, quotation.data?.destinationSummary]);

  // Prefill quotation FAQs from the FAQ master based on this quotation's
  // destination. Runs once when the FAQ list is still empty so saved FAQs are
  // never overwritten, and a manual "Import FAQs" button stays available.
  const importMasterFaqs = () => {
    const master = masterFaqsQuery.data?.data ?? [];
    if (!master.length) return;
    const matches = (destinations: string[] | null | undefined) => {
      if (!destinations?.length) return true;
      return destinations.some((destination) => {
        const key = destination.trim().toLowerCase();
        return [...quotationDestinationTokens].some(
          (token) => key === token || key.includes(token) || token.includes(key),
        );
      });
    };
    const rows = master.filter((faq) => matches(faq.destinations));
    if (!rows.length) return;
    const current = (form.getValues('faqs') ?? []).map((f) => f.question.trim().toLowerCase());
    const toAdd = rows.filter(
      (row) => !current.includes(row.question.trim().toLowerCase()),
    );
    if (!toAdd.length) return;
    toAdd.forEach((row) => faqs.append({ question: row.question, answer: row.answer }));
    const destNames = [
      ...new Set(
        (rows.flatMap((r) => r.destinations ?? []) as string[]).filter(Boolean),
      ),
    ];
    setImportedFaqDestination(destNames.length ? destNames.join(', ') : 'this destination');
  };
  useEffect(() => {
    if (faqPrefillAttemptedRef.current) return;
    if (!builderVersion) return;
    if (faqs.fields.length > 0) {
      faqPrefillAttemptedRef.current = true;
      return;
    }
    if (!masterFaqsQuery.data) return;
    faqPrefillAttemptedRef.current = true;
    importMasterFaqs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builderVersion, faqs.fields.length, masterFaqsQuery.data]);

  useEffect(() => {
    const details = builderVersion?.flightDetails;
    const documentIds = details?.images?.length
      ? details.images.map((image) => image.documentId)
      : details?.imageDocumentId
        ? [details.imageDocumentId]
        : [];
    if (documentIds.length === 0) {
      setFlightImagePreviewUrls({});
      return;
    }
    let active = true;
    void Promise.all(
      documentIds.map(async (documentId) => {
        try {
          return [documentId, await quotationDocumentInlineUrl(quotationId, documentId)] as const;
        } catch {
          return [documentId, ''] as const;
        }
      }),
    ).then((entries) => {
      if (active) setFlightImagePreviewUrls(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [quotationId, builderVersion?.flightDetails]);

  // Sightseeing activity attachment URLs for the live preview, mirroring the
  // flight pattern above: saved documents resolve here, fresh uploads patch
  // the map through onSightseeingPreviewUrl.
  useEffect(() => {
    const documentIds = [
      ...new Set(
        (builderVersion?.sightseeingDetails?.days ?? []).flatMap((day) =>
          (day.activities ?? [])
            .map((activity) => activity.imageDocumentId)
            .filter((id): id is string => Boolean(id)),
        ),
      ),
    ];
    if (documentIds.length === 0) {
      setSightseeingPreviewUrls({});
      return;
    }
    let active = true;
    void Promise.all(
      documentIds.map(async (documentId) => {
        try {
          return [documentId, await quotationDocumentInlineUrl(quotationId, documentId)] as const;
        } catch {
          return [documentId, ''] as const;
        }
      }),
    ).then((entries) => {
      if (active) setSightseeingPreviewUrls(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [quotationId, builderVersion?.sightseeingDetails]);
  // Tabs requested by the Lead — the source of truth for the red `*` on each
  // service tab. Derived from the lead's own service selections, never from the
  // quotation's saved state (so a requested-but-unchecked service still shows
  // its `*`, meaning "requested on the Lead").
  const leadRequested = useMemo(
    () => leadRequestedTabs(quotation.data?.query),
    [quotation.data?.query],
  );
  useEffect(() => {
    if (!builderVersion) return;
    const version = builderVersion;
    // Prefill a fresh Flight tab from the lead: outbound = departure city → main
    // destination on the travel-start date; return is the reverse on travel-end.
    const stripCode = (value: string | null | undefined) =>
      (value ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    const depCity = stripCode(quotation.data?.query?.departureCity);
    const destCity = (quotation.data?.destinationSummary ?? '').split(/[•(→>,]/)[0]?.trim() ?? '';
    const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
    const startStr = dateOnly(quotation.data?.travelStartDate);
    const endStr = dateOnly(quotation.data?.travelEndDate);
    // Return date = travel start + total lead nights (falls back to travel end).
    const leadTotalNights = (quotation.data?.query?.itinerary ?? []).reduce(
      (sum, row) => sum + (row.nights ?? 0),
      0,
    );
    const addDays = (iso: string | null, days: number) => {
      if (!iso) return null;
      const day = new Date(iso);
      day.setDate(day.getDate() + days);
      return day.toISOString().slice(0, 10);
    };
    const returnStr = leadTotalNights > 0 && startStr ? addDays(startStr, leadTotalNights) : endStr;
    // Prefill a day-per-night sightseeing itinerary (+1 final travel day) from the
    // lead. Each day receives at most ONE primary activity, taken from the ACTIVE
    // master attractions linked to the lead's destination in ascending
    // sightseeing sequence order. City is never used to filter, select or order
    // attractions: a destination like "Vietnam Trio" spans several cities (Hanoi,
    // Da Nang, Phu Quoc) and all of its numbered attractions must prefill in
    // sequence order (1, 2, 3, …) regardless of city.
    const leadCities: string[] = [];
    for (const row of quotation.data?.query?.itinerary ?? [])
      for (let n = 0; n < (row.nights ?? 0); n += 1)
        leadCities.push((row.destination ?? '').trim());
    const sightDayCount = Math.max(1, leadCities.length + (leadCities.length ? 1 : 0));
    const dayCities = Array.from(
      { length: sightDayCount },
      (_, i) => leadCities[i] ?? leadCities[leadCities.length - 1] ?? '',
    );
    const destinationToken = (quotation.data?.destinationSummary ?? '')
      .split(/[•(→>,]/)[0]
      ?.trim()
      ?.toLowerCase();
    // Scope the prefill to the lead's destinations by stable id (resolved in
    // destinationIdSet) so attractions from any other destination can never be
    // attached. The name token is only a fallback until the masters load.
    const orderedMasters = selectSightseeingPrefillMasters(
      sightseeingMasters.data?.data ?? [],
      destinationToken,
      [...destinationIdSet],
    );

    /** Detect a departure activity by normalized title. */
    const normTitle = (value: string | null | undefined) =>
      (value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, ' ');
    const isDepartureTitle = (title: string | null | undefined) => {
      const n = normTitle(title);
      return n.includes('departure') || /check[\s-]?out\s+and\s+departure/i.test(n);
    };

    // If configured, reserve the first departure-titled master for the final
    // day, still in sequence order (city is never used to pick or reorder it).
    const departureMasters = orderedMasters.filter((row) => isDepartureTitle(row.title));
    const departureMaster = departureMasters[0] ?? null;

    const usedIds = new Set<string>();
    // Reserve the optional departure master so it is never consumed by earlier days.
    if (departureMaster) usedIds.add(departureMaster.id);
    let sequenceCursor = 0;
    // Consume attractions strictly in the master's ascending sequence order; the
    // city a day belongs to never reorders or filters the selection.
    const nextForDay = (isLastDay: boolean): Sightseeing | null => {
      if (isLastDay && departureMaster) return departureMaster;
      while (
        sequenceCursor < orderedMasters.length &&
        usedIds.has(orderedMasters[sequenceCursor]!.id)
      )
        sequenceCursor += 1;
      const next = orderedMasters[sequenceCursor];
      if (next) {
        usedIds.add(next.id);
        sequenceCursor += 1;
      }
      return next ?? null;
    };
    const toActivity = (row: Sightseeing) => {
      const images = masterGallerySnapshot(row.images, row.title);
      // Shared full-replacement mapping with the manual search-bar selection:
      // the activity's overall transfer comes from the master's mealDefaults.
      // Null keeps the builder fallback (day NO_TRANSFER) for masters without
      // defaults. resolveSightseeingMealPrefill is retained for the overlay
      // computation below; the transfer itself matches the replacement helper.
      const mealPrefill = resolveSightseeingMealPrefill(row);
      return {
        sightseeingId: row.id,
        name: row.title,
        startTime: row.suggestedStartTime ?? null,
        showTime: Boolean(row.suggestedStartTime),
        duration: row.estimatedHours != null ? `${row.estimatedHours} hours` : null,
        city: row.city?.name ?? null,
        description: row.description ?? null,
        imageUrl: null,
        images,
        imageSnapshotPresent: masterGalleryPresence(row),
        pdfImageUrl: images[0] ? quotationSnapshotImageIdentity(images[0]) : null,
        dailyTransfer: mealPrefill.activityTransfer ?? null,
        pricingOptions: emptySightseeingActivity().pricingOptions,
        sequence: 1,
      };
    };
    const prefilledSightseeing = {
      include: true,
      sectionTitle: 'Your Itinerary',
      amount: 0,
      description: null,
      days: dayCities.map((city, i) => {
        const isLastDay = i === dayCities.length - 1;
        const primary = nextForDay(isLastDay);
        // The day is labelled with the attraction's own city (Hanoi, Da Nang,
        // Phu Quoc …), falling back to any lead city when the day is empty.
        const dayCity = primary?.city?.name ?? city;
        // Shared full-replacement mapping with the manual search-bar
        // selection: a day created for a master gets that master's complete
        // meal/transfer configuration (canonical defaults for anything the
        // master leaves unconfigured), identical to picking the same master
        // manually. Days without a primary keep `emptySightseeingDay`
        // defaults. Saved quotations are never rewritten here (hydration
        // preserves them — see the `form.reset` below).
        const baseDay = emptySightseeingDay(i + 1);
        const replacement = primary ? resolveSightseeingMealReplacement(primary) : null;
        const dayMeals = replacement?.meals ?? baseDay.meals;
        const dayMealPreferences: Record<string, { mode: unknown; transferDetails: unknown }> =
          replacement
            ? {
                breakfast: { ...replacement.mealPreferences.breakfast },
                lunch: { ...replacement.mealPreferences.lunch },
                dinner: { ...replacement.mealPreferences.dinner },
              }
            : {
                ...(baseDay.mealPreferences as Record<
                  string,
                  { mode: unknown; transferDetails: unknown }
                >),
              };
        return emptySightseeingDay(i + 1, {
          // Day titles render verbatim: the formatter never injects a
          // separator, so master titles, names and cities are kept as-is.
          title: primary
            ? formatItineraryDayTitle(i + 1, primary.title)
            : dayCity
              ? formatItineraryDayTitle(i + 1, dayCity)
              : `Day ${i + 1}`,
          city: dayCity || null,
          date: addDays(startStr, i),
          meals: dayMeals,
          mealPreferences: dayMealPreferences as never,
          activities: primary ? [toActivity(primary)] : [emptySightseeingActivity()],
        });
      }),
    };
    // Build hotel stay rows from the lead itinerary.  Non-hotel segments
    // (Cruise, Airport, Transfer, etc.) are excluded.  Consecutive same-city
    // segments are merged into a single continuous stay.
    const rawStays = (quotation.data?.query?.itinerary ?? []).filter(
      (stay) => stay.nights > 0 && isHotelStay(resolveItineraryStayCity(stay)),
    );
    const mergedStays: typeof rawStays = [];
    for (const stay of rawStays) {
      const prev = mergedStays[mergedStays.length - 1];
      const stayCity = resolveItineraryStayCity(stay).trim().toLowerCase();
      if (prev && resolveItineraryStayCity(prev).trim().toLowerCase() === stayCity) {
        prev.nights += stay.nights;
      } else {
        mergedStays.push({ ...stay });
      }
    }
    // Initial hotel stays: one row per merged hotel-worthy stay, so every
    // destination in a multi-city itinerary gets its own stay (previously only
    // the first stay was materialised). Consecutive same-city segments were
    // merged above. A blank lead city still resolves through the destination
    // (`country`) so the destination default can apply.
    // When the itinerary produces exactly one hotel city (even when it
    // appears multiple times interrupted by Cruise etc.), that single
    // Hotel Stay must cover the quotation's complete total nights, not
    // only the land-segment nights.
    const itineraryHotelRows: HotelInputRow[] = (() => {
      if (!mergedStays.length) return [];
      let cursor = startStr ? new Date(startStr) : null;
      const isSingleHotelCity = mergedStays.length === 1 && leadTotalNights > (mergedStays[0]?.nights ?? 0);
      return mergedStays.map((stay, index) => {
        const nightsForStay = isSingleHotelCity ? leadTotalNights : (stay.nights ?? 0);
        const checkIn = stay.arrivalDate ? new Date(stay.arrivalDate) : cursor;
        const derivedCheckOut = checkIn ? new Date(checkIn) : null;
        if (derivedCheckOut) derivedCheckOut.setDate(derivedCheckOut.getDate() + nightsForStay);
        const checkOut = stay.departureDate ? new Date(stay.departureDate) : derivedCheckOut;
        if (checkOut) cursor = new Date(checkOut);
        return emptyHotel(index + 1, true, {
          city: resolveItineraryStayCity(stay),
          // No rooms seeding (see createHotelRow): unassigned stays stay empty.
          nights: nightsForStay,
          checkInDate: checkIn ? new Date(checkIn) : null,
          checkOutDate: checkOut,
        });
      });
    })();
    const fallbackNights =
      startStr && endStr
        ? Math.max(
            1,
            Math.round((new Date(endStr).getTime() - new Date(startStr).getTime()) / 86_400_000),
          )
        : 1;
    const fallbackCity =
      (quotation.data?.destinationSummary ?? '').split(/[•(→>,]/)[0]?.trim() ?? '';
    const leadHotelRows: HotelInputRow[] = itineraryHotelRows.length
      ? itineraryHotelRows
      : fallbackCity || startStr || endStr
        ? [
            emptyHotel(1, true, {
              city: fallbackCity,
              // No rooms seeding (see createHotelRow): unassigned stays stay empty.
              nights: fallbackNights,
              checkInDate: startStr ? new Date(startStr) : null,
              checkOutDate: returnStr ? new Date(returnStr) : endStr ? new Date(endStr) : null,
            }),
          ]
        : [];
    const base = defaultFlightDetails();
    const prefilledFlight: NonNullable<QuotationVersionInput['flightDetails']> = {
      ...base,
      flights: [
        {
          bookmarkCode: null,
          journeyType: 'ROUND_TRIP',
          outbound: {
            ...base.outbound,
            fromCity: depCity || null,
            toCity: destCity || null,
            routeFrom: depCity || null,
            routeTo: destCity || null,
            segments: [
              {
                ...emptySegment(),
                from: depCity || null,
                to: destCity || null,
                departureDate: startStr,
                arrivalDate: startStr,
              },
            ],
          },
          returnJourney: {
            ...base.returnJourney,
            fromCity: destCity || null,
            toCity: depCity || null,
            routeFrom: destCity || null,
            routeTo: depCity || null,
            segments: [
              {
                ...emptySegment(),
                from: destCity || null,
                to: depCity || null,
                departureDate: returnStr,
                arrivalDate: returnStr,
              },
            ],
          },
        },
      ],
      outbound: {
        ...base.outbound,
        fromCity: depCity || null,
        toCity: destCity || null,
        routeFrom: depCity || null,
        routeTo: destCity || null,
        segments: [
          {
            ...emptySegment(),
            from: depCity || null,
            to: destCity || null,
            departureDate: startStr,
            arrivalDate: startStr,
          },
        ],
      },
      returnJourney: {
        ...base.returnJourney,
        fromCity: destCity || null,
        toCity: depCity || null,
        routeFrom: destCity || null,
        routeTo: depCity || null,
        segments: [
          {
            ...emptySegment(),
            from: destCity || null,
            to: depCity || null,
            departureDate: returnStr,
            arrivalDate: returnStr,
          },
        ],
      },
    };
    vehicleDescriptionOverriddenRef.current.clear();
    // Saved hotel rows are normalised exactly as before; only genuinely empty
    // rows are eligible for a default. Selected/saved/template/duplicated rows
    // (any master id or typed hotel information) are never touched. A brand-new
    // quotation keeps the established multi-default expansion.
    const initialSavedHotelRows: HotelInputRow[] = version.hotels.map((row, index) => {
      const matchingStay =
        leadHotelRows.find(
          (stay) =>
            (stay.city ?? '').trim().toLowerCase() === (row.city ?? '').trim().toLowerCase(),
        ) ?? leadHotelRows[index];
      return withSynthesizedLines({
        ...row,
        checkInDate: row.checkInDate
          ? new Date(row.checkInDate)
          : (matchingStay?.checkInDate ?? (startStr ? new Date(startStr) : null)),
        checkOutDate: row.checkOutDate
          ? new Date(row.checkOutDate)
          : (matchingStay?.checkOutDate ??
            (returnStr ? new Date(returnStr) : endStr ? new Date(endStr) : null)),
        showCheckInTime: Boolean(row.checkInTime?.trim()),
        showCheckOutTime: Boolean(row.checkOutTime?.trim()),
        internalCost: row.internalCost ? Number(row.internalCost) : 0,
        sellingPrice: row.sellingPrice ? Number(row.sellingPrice) : 0,
        // Backward compatibility: older quotations stored the bookmark
        // gallery at section level (hotelDetails.images). Migrate it onto
        // the single hotel stay so the per-stay image manager and PDF
        // selection keep working. Rows that already carry their own
        // images (newer saves) are left untouched.
        images: (row.imageSnapshotPresent
          ? (row.images ?? [])
          : version.hotels.length === 1 &&
              Array.isArray(version.hotelDetails?.images) &&
              version.hotelDetails.images.length > 0
            ? version.hotelDetails.images.map((image) => ({
                url: image.url,
                thumbnailUrl: null,
                alt: image.alt ?? null,
              }))
            : (row.images ?? [])) as NonNullable<
          QuotationVersionInput['hotels']
        >[number]['images'],
        imageSnapshotPresent:
          (row.imageSnapshotPresent ?? Boolean(row.images?.length)) ||
          (version.hotels.length === 1 &&
            Array.isArray(version.hotelDetails?.images) &&
            version.hotelDetails.images.length > 0),
        pdfImageUrl:
          row.pdfImageUrl ??
          (version.hotels.length === 1 ? (version.hotelDetails?.pdfImageUrl ?? null) : null),
      } as unknown as HotelInputRow);
    });
    const initialHotelRows: HotelInputRow[] = initialSavedHotelRows.length
      ? (() => {
          const fallbackCity = leadHotelRows[0]?.city ?? '';
          const presentHotelIds = new Set(
            initialSavedHotelRows
              .map((row) => row.hotelId)
              .filter((id): id is string => Boolean(id)),
          );
          return initialSavedHotelRows.map((row) => {
            if (!isHotelRowEmpty(row)) return row;
            const city = resolveHotelRowCity(row, fallbackCity);
            // Exactly one default per saved empty row, never one already used by
            // another stay (duplicate rows are worse than an empty stay).
            const defaultHotel = matchDefaultHotels(
              city,
              hotelPrefillMasters,
              hotelDestinationIndex,
            ).find((hotel) => !presentHotelIds.has(hotel.id));
            if (!defaultHotel) return row;
            presentHotelIds.add(defaultHotel.id);
            return mapRowToDefaultHotel({ ...row, city }, defaultHotel);
          });
        })()
      : expandDefaultHotelRows(
          leadHotelRows,
          hotelPrefillMasters,
          hotelDestinationIndex,
        ).map(withSynthesizedLines);
    const legacyTitle = version.title.trim().toLowerCase();
    const legacyDestinationTitle =
      `${version.destinationSummary.trim()} travel proposal`.toLowerCase();
    const legacyPrimaryDestinationTitle = `${destCity} travel proposal`.toLowerCase();
    const leadTitle =
      destCity && quotation.data?.customerName
        ? `${destCity} Package for ${quotation.data.customerName}`
        : version.title;
    // Policy prefill from the lead's Destination Masters, in destination order.
    // Saved quotation policy values always win over destination content.
    const destinationPolicyPrefill = buildDestinationPolicyPrefill(
      destinationMasters.data?.data ?? [],
      (quotation.data?.query?.itinerary ?? [])
        .map((stay) => stay.country?.trim())
        .filter(Boolean) as string[],
    );
    form.reset({
      title:
        legacyTitle === legacyDestinationTitle || legacyTitle === legacyPrimaryDestinationTitle
          ? leadTitle
          : version.title,
      introduction: version.introduction,
      weblinkHeading: version.weblinkHeading ?? null,
      packageHeading: version.packageHeading ?? null,
      weblinkDurationText: version.weblinkDurationText ?? null,
      weblinkProfileDestination: version.weblinkProfileDestination ?? null,
      weblinkProfile: version.weblinkProfile ?? null,
      destinationSummary: version.destinationSummary?.trim()
        ? version.destinationSummary
        : deriveDestinationSummary(
            quotation.data?.destinationSummary,
            quotation.data?.query?.itinerary ?? [],
          ),
      travelStartDate: version.travelStartDate ? new Date(version.travelStartDate) : null,
      travelEndDate: version.travelEndDate ? new Date(version.travelEndDate) : null,
      currency: version.currency,
      pricingMode: normalizePricingMode(version.pricingMode) as QuotationVersionInput['pricingMode'],
      pricingHeading: version.pricingHeading ?? 'Price Breakdown',
      pricingSubheading: version.pricingSubheading ?? null,
      pricingDisplayOrder:
        Array.isArray((version as { pricingDisplayOrder?: unknown }).pricingDisplayOrder)
          ? ((version as { pricingDisplayOrder?: unknown }).pricingDisplayOrder as string[])
          : undefined,
      pricingRowOrder: Array.isArray((version as { pricingRowOrder?: unknown }).pricingRowOrder)
        ? ((version as { pricingRowOrder?: unknown }).pricingRowOrder as string[])
        : undefined,
      markupMode: version.markupMode as QuotationVersionInput['markupMode'],
      markupValue: Number(version.markupValue),
      taxRate: Number(version.taxRate),
      discountAmount: Number(version.discountAmount),
      perAdultPrice: Number(version.perAdultPrice ?? 0),
      perChildWithBedPrice: Number(version.perChildWithBedPrice ?? 0),
      perChildWithoutBedPrice: Number(version.perChildWithoutBedPrice ?? 0),
      perInfantPrice: Number(version.perInfantPrice ?? 0),
      packageCustomItems: Array.isArray(
        (version as unknown as { packageCustomItems?: unknown }).packageCustomItems,
      )
        ? (
            (version as unknown as {
              packageCustomItems: Array<{ id?: unknown; label?: string | null; amount?: unknown }>;
            }).packageCustomItems ?? []
          ).map((item) => ({
            id:
              typeof item.id === 'string' && item.id.trim().length > 0
                ? item.id.trim()
                : newPricingRowId(),
            label: String(item.label ?? ''),
            amount: Number(item.amount ?? 0),
          }))
        : [],
      taxNote: version.taxNote ?? null,
      netAmount: Number(version.netAmount ?? 0),
      initialPaymentAmount: Number(version.initialPaymentAmount ?? 0),
      paymentLink: version.paymentLink ?? null,
      showServiceChargesSeparately: version.showServiceChargesSeparately ?? false,
      markServiceChargesOutside: version.markServiceChargesOutside ?? false,
      hidePricing: version.hidePricing ?? false,
      showIndividualPricing: version.showIndividualPricing ?? false,
      showQuickNav: version.showQuickNav ?? true,
      quickNavSticky: version.quickNavSticky ?? true,
      inclusionsHtml: policyValue(version.inclusionsHtml, destinationPolicyPrefill.inclusionsHtml),
      exclusionsHtml: policyValue(version.exclusionsHtml, destinationPolicyPrefill.exclusionsHtml),
      paymentPolicies: policyValue(
        version.paymentPolicies,
        destinationPolicyPrefill.paymentPolicies,
      ),
      cancellationPolicies: policyValue(
        version.cancellationPolicies,
        destinationPolicyPrefill.cancellationPolicies,
      ),
      bookingTerms: policyValue(version.bookingTerms, destinationPolicyPrefill.bookingTerms),
      childPolicy: policyValue(version.childPolicy, destinationPolicyPrefill.childPolicy),
      includeVisa: version.includeVisa ?? true,
      visaSectionTitle: version.visaSectionTitle ?? null,
      visaAmount: Number(version.visaAmount ?? 0),
      visaDestination: version.visaDestination ?? null,
      visaType: version.visaType ?? null,
      visaServiceCharge: Number(version.visaServiceCharge ?? 0),
      visaGstPercent: Number(version.visaGstPercent ?? 0),
      visaVfsCharge: Number(version.visaVfsCharge ?? 0),
      customCharges: Array.isArray((version as unknown as { customCharges?: unknown }).customCharges)
        ? ((version as unknown as { customCharges: Array<{ label: string; amount: number; description?: string | null; category?: string | null }> }).customCharges ?? []).map((c) => ({
            label: c.label,
            amount: c.amount,
            description: (c as { description?: string | null }).description ?? null,
            category: (c as { category?: string | null }).category ?? null,
          }))
        : [],
      flightDetails: version.flightDetails
        ? {
            ...defaultFlightDetails(),
            ...normalizeFlightDetails(version.flightDetails),
            images: version.flightDetails.images?.length
              ? version.flightDetails.images.map((image) => ({
                  ...image,
                  description: image.description ?? image.heading ?? null,
                  heading: null,
                }))
              : version.flightDetails.imageDocumentId
                ? [
                    {
                      documentId: version.flightDetails.imageDocumentId,
                      fileName: version.flightDetails.imageFileName,
                      description: null,
                      heading: null,
                    },
                  ]
                : [],
            flights: (
              (
                normalizeFlightDetails(version.flightDetails) as unknown as {
                  flights?: Array<{
                    bookmarkCode?: string | null;
                    journeyType?: 'ROUND_TRIP' | 'ONEWAY_OUTBOUND' | 'ONEWAY_RETURN';
                    outbound?: {
                      fromCity?: string | null;
                      toCity?: string | null;
                      routeFrom?: string | null;
                      routeTo?: string | null;
                      travelClass?: string | null;
                      segments?: FlightSegmentInput[];
                    };
                    returnJourney?: {
                      fromCity?: string | null;
                      toCity?: string | null;
                      routeFrom?: string | null;
                      routeTo?: string | null;
                      travelClass?: string | null;
                      segments?: FlightSegmentInput[];
                    };
                  }>;
                }
              ).flights ?? []
            ).map((record) => hydrateFlightRecord(record, defaultFlightDetails())),
          }
        : prefilledFlight,
      hotelDetails: version.hotelDetails
        ? {
            ...defaultHotelDetails(),
            ...version.hotelDetails,
            sectionTitle: hotelSectionTitle(version.hotelDetails.sectionTitle),
          }
        : defaultHotelDetails(),
      addOnDetails: version.addOnDetails
        ? {
            include: version.addOnDetails.include !== false,
            sectionTitle: version.addOnDetails.sectionTitle ?? 'Additional Services',
          }
        : { include: true, sectionTitle: 'Additional Services' },
      sightseeingDetails:
        version.sightseeingDetails && version.sightseeingDetails.days?.length
          ? withSightseeingPricingRows({
              ...version.sightseeingDetails,
              // Migrate the previous default without touching custom titles.
              sectionTitle: sightseeingSectionTitle(version.sightseeingDetails.sectionTitle),
            })
          : prefilledSightseeing,
      notes: version.notes,
      internalNotes: version.internalNotes ?? null,
      itinerary: repairLegacyItinerary(
        version.itinerary,
        quotation.data?.query?.itinerary ?? [],
      ).map((row) => ({
        ...row,
        date: row.date ? new Date(row.date) : null,
      })),
      hotels: initialHotelRows,
      services: version.services.map((row) => {
        const base = {
          serviceType: row.serviceType as ServiceType,
          airlineId: row.airlineId ?? null,
          cruiseId: row.cruiseId ?? null,
          cruiseRoomTypeId: row.cruiseRoomTypeId ?? null,
          vehicleId: row.vehicleId ?? null,
          sightseeingId: row.sightseeingId ?? null,
          addOnServiceId: row.addOnServiceId ?? null,
          name: row.name,
          description: row.description,
          dayNumber: row.dayNumber,
          city: row.city,
          quantity: Number(row.quantity),
          internalCost: row.unitCost ? Number(row.unitCost) : 0,
          sellingPrice: Number(row.unitSellingPrice),
          // Cruise rows default their section title to "Cruise Details" when the
          // snapshot never stored one (legacy/custom rows), while custom titles
          // are always preserved.
          taxCategory:
            row.serviceType === 'CRUISE' && !(row.taxCategory ?? '').trim()
              ? 'Cruise Details'
              : row.taxCategory,
          notes: row.notes,
          duration: (row as unknown as { duration?: string | null })?.duration ?? null,
          // Quotation-owned add-on pricing snapshot (every option) plus the
          // section-wise basis. These fields were previously omitted from this
          // explicit mapper, so reopening a quotation silently dropped every
          // add-on pricing option and its label: the builder then showed the
          // master defaults via fallback while the weblink rendered a single
          // synthesized amount with no label, and the next save made the loss
          // permanent. An explicit empty array is preserved too, so deleting
          // every option never resurrects the master defaults on reload.
          pricingBasis: (row.pricingBasis ?? null) as QuotationVersionInput['services'][number]['pricingBasis'],
          pricingBasisLabel: row.pricingBasisLabel ?? null,
          pricingSnapshot: (row.pricingSnapshot ?? null) as QuotationVersionInput['services'][number]['pricingSnapshot'],
          cruiseNights: (row as unknown as { cruiseNights?: number | null })?.cruiseNights ?? null,
          cruiseRoomLines: Array.isArray((row as unknown as { cruiseRoomLines?: unknown[] })?.cruiseRoomLines)
            ? ((row as unknown as { cruiseRoomLines: unknown[] }).cruiseRoomLines as unknown as QuotationVersionInput['services'][number]['cruiseRoomLines'])
            : undefined,
          images: row.images ?? [],
          imageSnapshotPresent: row.imageSnapshotPresent ?? Boolean(row.images?.length),
          pdfImageUrl: row.pdfImageUrl ?? null,
          sequence: row.sequence,
        };
        if (base.serviceType === 'CRUISE') {
          return withCruiseSynthesizedLines(base as unknown as CruiseServiceInput) as unknown as typeof base;
        }
        return base;
      }),
      inclusions: version.inclusions,
      exclusions: version.exclusions,
      terms: version.terms,
      faqs: Array.isArray((version as unknown as { faqs?: unknown }).faqs)
        ? ((version as unknown as { faqs: Array<{ question: string; answer: string }> }).faqs ?? [])
        : [],
      weblinkSectionOrder: Array.isArray(
        (version as unknown as { weblinkSectionOrder?: unknown }).weblinkSectionOrder,
      )
        ? ((version as unknown as { weblinkSectionOrder: string[] })
            .weblinkSectionOrder as string[])
        : null,
      destinationExpertConfig: (version as unknown as { destinationExpertConfig?: unknown })
        .destinationExpertConfig
        ? ((
            version as unknown as {
              destinationExpertConfig: QuotationVersionInput['destinationExpertConfig'];
            }
          ).destinationExpertConfig as QuotationVersionInput['destinationExpertConfig'])
        : null,
    }, { keepDirtyValues: true });
    // A quotation with prefilled/default/selected hotel rows keeps the Hotel
    // section included unless the user explicitly turned it off. A saved
    // quotation's `hotelDetails.include` is authoritative (an explicitly
    // excluded hotel stays excluded).
    const prefilledHotelRows = initialHotelRows;
    const savedHotelInclude = version.hotelDetails?.include ?? true;
    if (savedHotelInclude && !autoHotelRef.current.userToggledHotel) {
      if (prefilledHotelRows.some((row) => row.hotelId) || version.hotels.length > 0) {
        autoHotelRef.current.enabledByAuto = true;
        setExcluded((current) => ({ ...current, hotel: false }));
      }
    } else if (!savedHotelInclude && !autoHotelRef.current.userToggledHotel) {
      setExcluded((current) => ({ ...current, hotel: true }));
    }
    // Cruise Include default, derived from the version's OWN saved CRUISE rows.
    // A NEW quotation created from a Lead has its version services seeded from
    // the Lead's requested services, so a lead-requested Cruise is included
    // (checked) by default. An existing draft's saved service rows reflect the
    // user's Include choice (an unchecked Cruise has no saved row), so reopening
    // preserves that state — the Lead is never re-applied over a saved choice.
    // An explicit user toggle always wins.
    if (!autoToggleRef.current.has('cruise')) {
      const hasSavedCruiseRow = (version.services ?? []).some(
        (row) => row.serviceType === 'CRUISE',
      );
      setExcluded((current) => ({ ...current, cruise: !hasSavedCruiseRow }));
    }
    if (!autoToggleRef.current.has('vehicle')) {
      const hasSavedVehicleRow = (version.services ?? []).some(
        (row) => row.serviceType === 'VEHICLE_TRANSFER',
      );
      setExcluded((current) => ({ ...current, vehicle: !hasSavedVehicleRow }));
    }
    // Flight top-level include: a NEW quotation defaults from the Lead's
    // requested services; an existing quotation keeps its saved value (see
    // defaultFlightInclude). The checkbox stays fully manual afterwards.
    const flightIncludeDefault = defaultFlightInclude(
      version.flightDetails,
      leadRequested.has('flight'),
    );
    if (flightIncludeDefault !== null) {
      form.setValue('flightDetails.include', flightIncludeDefault, {
        shouldDirty: false,
      });
    }
    // Add-on Services top-level include: a NEW quotation defaults from the
    // Lead's requested services; an existing quotation keeps its saved state.
    // `version.addOnDetails` is null on a brand-new version, so default it once.
    if (!version.addOnDetails) {
      const addOnIncluded = leadRequested.has('addon');
      form.setValue(
        'addOnDetails',
        { include: addOnIncluded, sectionTitle: 'Additional Services' },
        { shouldDirty: false },
      );
    }
    setInitializedFormVersionId(version.id);
  }, [
    version,
    form,
    quotation.data,
    sightseeingMasters.data,
    hotelPrefillMasters,
    destinationMasters.data,
    hotelDestinationIndex,
    leadRequested,
  ]);

  const watchedHotels = useWatch({ control: form.control, name: 'hotels' });

  /**
   * TOTAL ROOMS resolution per stay: the explicit `roomsOverride` when one is
   * stored (typed this session or loaded), otherwise the live allocation sum
   * (or the saved scalar for legacy rows without allocations).
   */
  type HotelRoomsView = {
    rooms?: number | null | undefined;
    roomsOverride?: number | null | undefined;
  } | null | undefined;

  const roomsOverrideOf = (hotel: HotelRoomsView): number | null =>
    typeof hotel?.roomsOverride === 'number' ? hotel.roomsOverride : null;

  const isRoomsManual = (rowId: string | undefined, hotel: HotelRoomsView): boolean => {
    if (rowId !== undefined && hotelRoomsTypingRef.current.has(rowId)) return true;
    return roomsOverrideOf(hotel) !== null;
  };

  const resolveHotelRooms = (
    rowId: string | undefined,
    hotel: HotelRoomsView,
  ): { value: number | null; manual: boolean } => {
    const saved = typeof hotel?.rooms === 'number' ? hotel.rooms : null;
    const calculated = hotelRoomLinesTotalRooms(hotel);
    if (isRoomsManual(rowId, hotel)) return { value: saved, manual: true };
    return { value: calculated ?? saved, manual: false };
  };

  // Keep automatic totals synchronized with room allocations. Rows with a
  // stored override — or being actively edited — are never touched.
  useEffect(() => {
    (watchedHotels ?? []).forEach((hotel, index) => {
      const rowId = hotels.fields[index]?.id;
      const calculated = hotelRoomLinesTotalRooms(hotel);
      if (calculated === null) return;
      if (resolveHotelRooms(rowId, hotel).manual) return;
      const current = (hotel as { rooms?: unknown })?.rooms ?? null;
      if (current !== calculated) {
        form.setValue(`hotels.${index}.rooms`, calculated, { shouldDirty: false });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    (watchedHotels ?? [])
      .map((hotel) => JSON.stringify((hotel?.roomLines ?? []).map((line) => line?.rooms ?? null)))
      .join('|'),
  ]);
  const watchedServices = useWatch({ control: form.control, name: 'services' });
  const watchedAddOnInclude = useWatch({ control: form.control, name: 'addOnDetails.include' });
  const markupMode = useWatch({ control: form.control, name: 'markupMode' });
  const markupValue = useWatch({ control: form.control, name: 'markupValue' }) ?? 0;
  const taxRate = useWatch({ control: form.control, name: 'taxRate' }) ?? 0;
  const discount = useWatch({ control: form.control, name: 'discountAmount' }) ?? 0;

  const applyPatch = (path: 'hotels' | 'services', index: number, patch: object) => {
    for (const [key, value] of Object.entries(patch))
      form.setValue(`${path}.${index}.${key}` as 'hotels.0.hotelName', value as never, {
        shouldDirty: true,
      });
  };
  const applyHotel = (index: number, patch: HotelRowPatch) => applyPatch('hotels', index, patch);
  const applyService = (index: number, patch: ServiceRowPatch) =>
    applyPatch('services', index, patch);

  // Cruise: auto-prefill cabin rate from master when room selected, respecting manual override.
  // Handles both stable ID and legacy name-only (city) fallback.
  useEffect(() => {
    if (!cruiseMasters.data?.data) return;
    const masters = cruiseMasters.data.data as unknown as Array<{ id: string; roomTypes?: Array<{ id: string; name: string; price?: number | null; status: string }> }>;
    (watchedServices ?? []).forEach((row, index) => {
      if ((row as unknown as { serviceType: string })?.serviceType !== 'CRUISE') return;
      const cruiseId = (row as unknown as { cruiseId?: string | null })?.cruiseId;
      const roomTypeId = (row as unknown as { cruiseRoomTypeId?: string | null })?.cruiseRoomTypeId;
      const fallbackName = (row as unknown as { city?: string | null })?.city;
      if (!cruiseId) return;
      if (!roomTypeId && !fallbackName?.trim()) return;
      const master = masters.find((m) => m.id === cruiseId);
      if (!master) return;
      const room = findCruiseRoomType(master as never, roomTypeId, fallbackName);
      if (!room) return;
      // Legacy: if id missing but name matched, migrate id to stable value
      if (!roomTypeId && fallbackName?.trim() && room.id) {
        applyService(index, { cruiseRoomTypeId: room.id, city: room.name });
      }
      if (room.price == null) return;
      if (cruisePriceOverridesRef.current.has(index)) return;
      const currentPrice = (row as unknown as { sellingPrice?: number | null })?.sellingPrice;
      const masterPrice = Number(room.price);
      if (currentPrice != null && Number(currentPrice) === masterPrice) return;
      // If not overridden, sync to master price (covers initial fill and room change)
      applyService(index, { sellingPrice: masterPrice });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cruiseMasters.data, watchedServices?.map((s) => `${(s as unknown as { cruiseId?: string })?.cruiseId}-${(s as unknown as { cruiseRoomTypeId?: string })?.cruiseRoomTypeId}-${(s as unknown as { city?: string })?.city}`).join('|')]);

  /**
   * A room/meal allocation's master selection writes its own additive selling
   * figure onto the line; the row's sellingPrice/internalCost become the sum
   * across ALL allocations — the same additive rule the single room+meal pair
   * always used, never accumulated twice. Manual figures are kept when no line
   * carries a master price.
   */
  const recalculateHotelTotals = (index: number) => {
    const row = form.getValues(`hotels.${index}`) as HotelInputRow;
    const lines = [...(row.roomLines ?? []), ...(row.mealPlanLines ?? [])];
    if (!lines.some((line) => line?.sellingPrice != null)) return;
    const selling = lines.reduce((sum, line) => sum + (Number(line?.sellingPrice) || 0), 0);
    form.setValue(`hotels.${index}.sellingPrice`, selling as never, { shouldDirty: true });
    if (canCost && lines.some((line) => line?.internalCost != null)) {
      const cost = lines.reduce((sum, line) => sum + (Number(line?.internalCost) || 0), 0);
      form.setValue(`hotels.${index}.internalCost`, cost as never, { shouldDirty: true });
    }
  };

  // Unsaved Master refs deliberately carry no expiring URL. Enrich them for
  // editing in the background, while merging into the latest order so delayed
  // responses never restore images the user removed or moved.
  useEffect(() => {
    (watchedHotels ?? []).forEach((row, index) => {
      const current = (row.images ?? []) as QuotationImage[];
      if (!row.hotelId || !row.imageSnapshotPresent) return;
      if (!current.some((image) => image.masterImageId && !image.url)) return;
      const key = `${index}:${row.hotelId}:${current
        .map((image) => quotationSnapshotImageIdentity(image) ?? '')
        .join(',')}`;
      if (hotelPreviewImportsRef.current.has(key)) return;
      hotelPreviewImportsRef.current.add(key);
      void importMasterGalleryPreviews(row.hotelId, current, hotelImageUrl).then((previewed) => {
        if (form.getValues(`hotels.${index}.hotelId`) !== row.hotelId) return;
        form.setValue(
          `hotels.${index}.images`,
          mergeMasterGalleryPreviews(form.getValues(`hotels.${index}.images`), previewed) as never,
          { shouldDirty: false },
        );
      });
    });
  }, [watchedHotels, form]);

  // Per-stay bookmark snapshot image management. Every hotel stay owns its own
  // image list and its own "Use in PDF" selection. Reordering and removal only
  // edit this quotation's saved copy — the bookmark itself is never touched.
  // Removing the PDF-selected image moves the selection to the first remaining
  // image, matching the PDF's fallback rule.
  const moveHotelImage = (stayIndex: number, index: number, direction: -1 | 1) => {
    const current = (watchedHotels?.[stayIndex]?.images ?? []) as QuotationImage[];
    const target = index + direction;
    if (target < 0 || target >= current.length) return;
    const next = [...current];
    [next[index], next[target]] = [next[target]!, next[index]!];
    form.setValue(`hotels.${stayIndex}.images`, next as never, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(`hotels.${stayIndex}.imageSnapshotPresent`, true, { shouldDirty: true });
  };
  const removeHotelImage = (stayIndex: number, index: number) => {
    const current = (watchedHotels?.[stayIndex]?.images ?? []) as QuotationImage[];
    const removed = current[index];
    const next = current.filter((_, imageIndex) => imageIndex !== index);
    form.setValue(`hotels.${stayIndex}.images`, next as never, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(`hotels.${stayIndex}.imageSnapshotPresent`, true, { shouldDirty: true });
    if (
      removed &&
      watchedHotels?.[stayIndex]?.pdfImageUrl === quotationSnapshotImageIdentity(removed)
    )
      form.setValue(
        `hotels.${stayIndex}.pdfImageUrl`,
        next[0] ? quotationSnapshotImageIdentity(next[0]) : null,
        {
          shouldDirty: true,
        },
      );
  };
  const setHotelPdfImage = (stayIndex: number, identity: string) =>
    form.setValue(`hotels.${stayIndex}.pdfImageUrl`, identity, { shouldDirty: true });

  const moveServiceImage = (serviceIndex: number, imageIndex: number, direction: -1 | 1) => {
    const current = (watchedServices?.[serviceIndex]?.images ?? []) as QuotationImage[];
    const target = imageIndex + direction;
    if (target < 0 || target >= current.length) return;
    const next = [...current];
    [next[imageIndex], next[target]] = [next[target]!, next[imageIndex]!];
    form.setValue(`services.${serviceIndex}.images`, next, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(`services.${serviceIndex}.imageSnapshotPresent`, true, { shouldDirty: true });
  };
  const removeServiceImage = (serviceIndex: number, imageIndex: number) => {
    const current = (watchedServices?.[serviceIndex]?.images ?? []) as QuotationImage[];
    const removed = current[imageIndex];
    const next = current.filter((_, index) => index !== imageIndex);
    form.setValue(`services.${serviceIndex}.images`, next, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(`services.${serviceIndex}.imageSnapshotPresent`, true, { shouldDirty: true });
    if (
      removed &&
      watchedServices?.[serviceIndex]?.pdfImageUrl === quotationSnapshotImageIdentity(removed)
    )
      form.setValue(
        `services.${serviceIndex}.pdfImageUrl`,
        next[0] ? quotationSnapshotImageIdentity(next[0]) : null,
        { shouldDirty: true },
      );
  };
  const setServicePdfImage = (serviceIndex: number, identity: string) =>
    form.setValue(`services.${serviceIndex}.pdfImageUrl`, identity, { shouldDirty: true });

  // Prefill default hotels for genuinely empty rows after initialization:
  // newly added stays ("Add Hotel", before/after, option) and saved empty rows
  // in an existing quotation. Rows with a master link, typed hotel information
  // or manual money are never touched, so saved/template/duplicated selections
  // and prices survive. Re-runs skip filled rows, so defaults are never
  // duplicated.
  useEffect(() => {
    const state = autoHotelRef.current;
    // Only an explicitly excluded Hotel section blocks population. Manually
    // enabling the section (which used to set `userToggledHotel`) no longer
    // prevents a new empty stay from receiving its default.
    if (excluded.hotel) return;
    if (!hotelPrefillReady) return;
    const masters = hotelPrefillMasters;
    if (!masters.length) return;
    const rows = (watchedHotels ?? []) as HotelInputRow[];
    const formItinerary = (watchedFormItinerary ?? []) as Array<Record<string, unknown>>;
    // Current edited itinerary first, then the lead, then any existing row and
    // finally the live destination summary. Never the saved summary alone.
    const resolvesInIndex = (city: string) => {
      const key = city.trim().toLowerCase();
      if (!key) return false;
      return (
        hotelDestinationIndex.destinationIdsByCity.has(key) ||
        hotelDestinationIndex.destinationIdByName.has(key)
      );
    };
    const fallbackCity = (() => {
      for (const itineraryRow of formItinerary) {
        for (const raw of [itineraryRow.destination, itineraryRow.overnightLocation]) {
          const city = String(raw ?? '').trim();
          if (city && isHotelStay(city) && resolvesInIndex(city)) return city;
        }
      }
      for (const stay of quotation.data?.query?.itinerary ?? []) {
        const city = resolveItineraryStayCity(stay);
        if (city && isHotelStay(city)) return city;
      }
      const rowCity = rows.map((row) => (row.city ?? '').trim()).find(Boolean);
      if (rowCity) return rowCity;
      return (
        String(watchedDestinationSummary ?? '')
          .split(/[•(→>,]/)[0]
          ?.trim() ?? ''
      );
    })();
    // The established multi-default behaviour only applies to a brand-new
    // quotation built from the lead. An existing quotation gets exactly one
    // default per empty stay.
    const brandNew = (version?.hotels?.length ?? 0) === 0;
    let nextSequence = hotels.fields.length + 1;
    const presentHotelIds = new Set(
      rows.map((row) => row.hotelId).filter((id): id is string => Boolean(id)),
    );
    let matched = false;
    const fillRowWithDefault = (index: number, defaultHotel: DefaultHotelMaster) => {
      const images = masterGallerySnapshot(defaultHotel.images, defaultHotel.name);
      const matchedRate = hotelRateForDate(defaultHotel as never, rows[index]?.checkInDate);
      const price = matchedRate != null && Number(matchedRate) > 0 ? Number(matchedRate) : null;
      // Same mapping as a manual master selection (see HotelMasterFields).
      for (const [key, patchValue] of Object.entries({
        hotelId: defaultHotel.id,
        hotelRoomTypeId: null,
        hotelMealPlanId: null,
        hotelName: defaultHotel.name,
        city: defaultHotel.city.name,
        category: defaultHotel.starCategory ? `${defaultHotel.starCategory} Star` : null,
        images,
        imageSnapshotPresent: masterGalleryPresence(defaultHotel),
        pdfImageUrl: images[0] ? quotationSnapshotImageIdentity(images[0]) : null,
        ...(price != null ? { sellingPrice: price } : {}),
      })) {
        form.setValue(`hotels.${index}.${key}` as 'hotels.0.hotelName', patchValue as never, {
          shouldDirty: true,
        });
      }
      if (price != null) {
        const sectionAmount = form.getValues('hotelDetails.amount' as never) as unknown;
        const sectionEmpty =
          sectionAmount == null || sectionAmount === '' || Number(sectionAmount) === 0;
        if (sectionEmpty)
          form.setValue('hotelDetails.amount', price as never, { shouldDirty: true });
      }
      presentHotelIds.add(defaultHotel.id);
    };
    rows.forEach((row, index) => {
      if (!isHotelRowEmpty(row)) return;
      const cityName = resolveHotelRowCity(row, fallbackCity);
      if (!cityName) return;
      const defaults = matchDefaultHotels(cityName, masters, hotelDestinationIndex).filter(
        (hotel) => !presentHotelIds.has(hotel.id),
      );
      if (!defaults.length) return;
      matched = true;
      // The builder row itself is filled in place; this keeps its id, room
      // allocation state and dates.
      if (!(row.city ?? '').trim())
        form.setValue(`hotels.${index}.city`, cityName, { shouldDirty: true });
      fillRowWithDefault(index, defaults[0]!);
      if (!brandNew) return;
      // Remaining defaults become their own stays cloned from this row's
      // dates/nights/rooms (multi-default behaviour for new quotations).
      for (const hotel of defaults.slice(1)) {
        if (presentHotelIds.has(hotel.id)) continue;
        hotels.append({
          ...mapRowToDefaultHotel(row, hotel),
          city: hotel.city.name,
          sequence: nextSequence++,
          selected: true,
        });
        presentHotelIds.add(hotel.id);
      }
    });
    if (matched && !state.enabledByAuto) {
      state.enabledByAuto = true;
      setExcluded((current) => ({ ...current, hotel: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    watchedHotels,
    hotelPrefillReady,
    hotelPrefillMasters,
    hotelDestinationIndex,
    watchedFormItinerary,
    watchedDestinationSummary,
    excluded.hotel,
    quotation.data?.query?.itinerary,
    version,
    form,
  ]);

  /**
   * Fill the first empty vehicle row (if any) and append the remaining
   * matches as independent entries. Returns how many vehicles were placed.
   * Never touches rows the user already filled; masters are never modified.
   */
  const placeMissingVehicles = (missing: PrefillVehicleMaster[]): number => {
    if (!missing.length) return 0;
    const rows = (form.getValues('services') ?? []) as Array<{
      serviceType?: string;
      vehicleId?: string | null;
      name?: string | null;
    }>;
    const queue = [...missing];
    // Any vehicle row without a selected model is fillable, including the
    // placeholder row a NEW quotation is seeded with from the lead's requested
    // services (serviceType-driven `name`, no `vehicleId`).
    const emptyIndex = rows.findIndex(
      (row) => row.serviceType === 'VEHICLE_TRANSFER' && !row.vehicleId,
    );
    if (emptyIndex >= 0) {
      const first = queue.shift()!;
      for (const [key, patchValue] of Object.entries(vehicleRowPatch(first))) {
        form.setValue(`services.${emptyIndex}.${key}` as 'services.0.name', patchValue as never, {
          shouldDirty: true,
        });
      }
    }
    let sequence = services.fields.length + 1;
    for (const master of queue) {
      services.append(mapMasterToVehicleRow(master, sequence++) as never);
    }
    return missing.length;
  };

  // Automatic vehicle prefill for NEW quotations: for every destination,
  // find ALL ACTIVE vehicles linked to that destination ID and populate
  // missing rows. Reacts when destination IDs or vehicle masters become
  // available (initial load, async fetch, new destination added).
  useEffect(() => {
    if (!version) return;
    if (!destinationMasters.data) return;
    // A NEW quotation seeded from the lead's requested services can contain a
    // placeholder VEHICLE_TRANSFER row (no vehicleId). That is not a "saved
    // vehicle", so it must not block automatic master-based prefill. Only rows
    // with an actually-selected vehicle count as already-saved.
    const savedVehicleCount = (version.services ?? []).filter(
      (service) => service.serviceType === 'VEHICLE_TRANSFER' && service.vehicleId,
    ).length;
    if (!shouldAutoPrefillVehicles(savedVehicleCount)) return;
    if (initializedFormVersionId !== version.id) return;
    if (excluded.vehicle) return;
    const effectiveIds = [...vehicleEffectiveDestinationIds];
    if (!effectiveIds.length) return;
    // Wait until all per-destination vehicle queries have loaded (index-aligned)
    const isAnyPending = effectiveIds.some((_, idx) => {
      const q = vehiclesByDestination[idx];
      return !q || q.isPending || !q.data;
    });
    if (isAnyPending) return;
    // Collect all vehicles returned for each destination (already filtered by backend)
    const allMasters: PrefillVehicleMaster[] = [];
    for (let idx = 0; idx < effectiveIds.length; idx++) {
      const q = vehiclesByDestination[idx];
      const data = (q?.data as unknown as Page<any> | undefined)?.data ?? [];
      for (const v of data) {
        allMasters.push(v as unknown as PrefillVehicleMaster);
      }
    }
    const present = new Set(
      (
        ((form.getValues('services') ?? []) as Array<{
          serviceType?: string;
          vehicleId?: string | null;
        }>) ?? []
      )
        .filter((row) => row.serviceType === 'VEHICLE_TRANSFER' && row.vehicleId)
        .map((row) => row.vehicleId as string),
    );
    const missing: PrefillVehicleMaster[] = [];
    const seen = new Set(present);
    for (const master of allMasters) {
      if (seen.has(master.id)) continue;
      seen.add(master.id);
      missing.push(master);
    }
    if (missing.length) placeMissingVehicles(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, initializedFormVersionId, destinationMasters.data, vehicleEffectiveDestinationIds, excluded.vehicle, form, vehiclesByDestination]);

  // Automatic default add-on population for NEW quotations: for every
  // effective destination, append every default add-on master not already
  // present. Saved quotations (any linked add-on row) are authoritative and
  // never rewritten; explicitly removed defaults are never resurrected while
  // the same version is open; unchecking the Add-On Services include stops it.
  useEffect(() => {
    if (!version) return;
    if (dismissedAddonsRef.current.versionId !== version.id) {
      dismissedAddonsRef.current = { versionId: version.id, ids: new Set() };
    }
    const savedAddonCount = (version.services ?? []).filter(
      (service) => (service as { addOnServiceId?: string | null }).addOnServiceId,
    ).length;
    if (!shouldAutoPrefillAddons(savedAddonCount)) return;
    if (initializedFormVersionId !== version.id) return;
    if (watchedAddOnInclude === false) return;
    const effectiveIds = [...vehicleEffectiveDestinationIds];
    if (!effectiveIds.length) return;
    // Wait until all per-destination default queries have loaded.
    const isAnyPending = effectiveIds.some((_, idx) => {
      const q = addonsByDestination[idx];
      return !q || q.isPending || !q.data;
    });
    if (isAnyPending) return;
    const allMasters: PrefillAddOnMaster[] = [];
    for (let idx = 0; idx < effectiveIds.length; idx++) {
      const q = addonsByDestination[idx];
      const data = (q?.data as unknown as Page<PrefillAddOnMaster> | undefined)?.data ?? [];
      for (const master of data) allMasters.push(master as unknown as PrefillAddOnMaster);
    }
    const present = new Set(
      (
        ((form.getValues('services') ?? []) as Array<{
          addOnServiceId?: string | null;
        }>) ?? []
      )
        .filter((row) => row.addOnServiceId)
        .map((row) => row.addOnServiceId as string),
    );
    for (const row of buildAddonPrefillRows(
      effectiveIds,
      allMasters,
      services.fields.length + 1,
      present,
    )) {
      if (dismissedAddonsRef.current.ids.has(row.addOnServiceId as string)) continue;
      services.append(row as never);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, initializedFormVersionId, destinationMasters.data, vehicleEffectiveDestinationIds, watchedAddOnInclude, form, addonsByDestination]);

  const hotelDefaultCity = useMemo(() => {
    const resolves = (city: string) => {
      const key = city.trim().toLowerCase();
      return Boolean(
        key &&
          (hotelDestinationIndex.destinationIdsByCity.has(key) ||
            hotelDestinationIndex.destinationIdByName.has(key)),
      );
    };
    const fromItinerary = ((watchedFormItinerary ?? []) as Array<Record<string, unknown>>)
      .flatMap((row) => [row.destination, row.overnightLocation])
      .map((value) => String(value ?? '').trim())
      .find((city) => city && isHotelStay(city) && resolves(city));
    if (fromItinerary) return fromItinerary;
    for (const stay of quotation.data?.query?.itinerary ?? []) {
      const city = resolveItineraryStayCity(stay);
      if (city && isHotelStay(city)) return city;
    }
    return (
      String(watchedDestinationSummary ?? '')
        .split(/[•(→>,]/)[0]
        ?.trim() ?? ''
    );
  }, [
    watchedFormItinerary,
    watchedDestinationSummary,
    quotation.data?.query?.itinerary,
    hotelDestinationIndex,
  ]);

  const createHotelRow = (
    sequence: number,
    selected: boolean,
    seed: Partial<HotelInputRow> = {},
  ) => {
    const start = quotation.data?.travelStartDate;
    const end = quotation.data?.travelEndDate;
    // Derived from the quotation travel window when both edges exist;
    // otherwise NULL (unknown) — stay dates are optional and a missing window
    // must not invent a 1-night duration.
    const stayNights =
      start && end
        ? Math.max(
            1,
            Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000),
          )
        : null;
    return emptyHotel(sequence, selected, {
      // The current edited itinerary wins over the saved quotation summary; the
      // summary is only the last resort when the builder has no destination yet.
      city: hotelDefaultCity,
      // No rooms seeding: a newly added stay must not count as one room.
      // Total Rooms stays empty until the user adds room allocations.
      nights: stayNights,
      checkInDate: start ? new Date(start) : null,
      checkOutDate: end ? new Date(end) : null,
      ...seed,
    });
  };

  const appendHotel = (selected: boolean, seed: Partial<HotelInputRow> = {}) => {
    hotels.append(createHotelRow(hotels.fields.length + 1, selected, seed));
  };

  /**
   * Add Hotel Before/After: a blank, independent stay that inherits only the
   * neighbouring stay's destination/city. Inheriting the city lets the default
   * prefill resolve the right destination; the hotel itself is never cloned.
   */
  const neighbourHotelCity = (index: number) =>
    ((watchedHotels?.[index] as HotelInputRow | undefined)?.city ?? '').trim() ||
    hotelDefaultCity;

  const insertHotelAfter = (index: number) => {
    hotels.insert(
      index + 1,
      createEmptyHotelStay(index + 2, true, { city: neighbourHotelCity(index) }),
    );
  };

  const insertHotelBefore = (index: number) => {
    hotels.insert(
      index,
      createEmptyHotelStay(index + 1, true, { city: neighbourHotelCity(index) }),
    );
  };

  const estimate = useMemo(() => {
    const hotelRows = watchedHotels ?? [];
    const serviceRows = watchedServices ?? [];
    const isAddon = (row: { serviceType?: string }) =>
      ADDON_TYPES.includes((row.serviceType ?? '') as ServiceType);
    const packageServices = serviceRows.filter((row) => !isAddon(row));
    const addonServices = serviceRows.filter(isAddon);
    // Add-on services are quoted separately and are NOT part of the package total.
    const addOnIncluded = form.watch('addOnDetails.include') !== false;
    const addon = addOnIncluded
      ? addonServices
          .map((row) => Number(row.sellingPrice ?? 0) * Number(row.quantity ?? 1))
          .reduce((a, b) => a + b, 0)
      : 0;
    const cost = [
      ...hotelRows.map((row) => Number(row.internalCost ?? 0)),
      ...packageServices.map((row) => Number(row.internalCost ?? 0) * Number(row.quantity ?? 1)),
    ].reduce((a, b) => a + b, 0);
    const selling = [
      ...hotelRows.map((row) => Number(row.sellingPrice ?? 0)),
      ...packageServices.map((row) => Number(row.sellingPrice ?? 0) * Number(row.quantity ?? 1)),
    ].reduce((a, b) => a + b, 0);
    const markup =
      markupMode === 'PERCENTAGE'
        ? (selling * Number(markupValue)) / 100
        : markupMode === 'FIXED'
          ? Number(markupValue)
          : 0;
    const preTax = Math.max(0, selling + markup - Number(discount));
    const tax = (preTax * Number(taxRate)) / 100;
    return { cost, selling, markup, tax, addon, final: preTax + tax, margin: preTax - cost };
  }, [watchedHotels, watchedServices, markupMode, markupValue, taxRate, discount]);

  if (quotation.isLoading) return <div className="h-96 animate-pulse rounded-xl bg-card" />;
  if (!quotation.data || !version)
    return <div className="rounded-xl bg-card p-12 text-center">Draft version unavailable.</div>;
  if (version.status !== 'DRAFT')
    return (
      <div className="rounded-xl bg-card p-12 text-center">
        Finalized versions are immutable. Create a revision to edit.
      </div>
    );

  const q = quotation.data;
  const itineraryNights = (q.query?.itinerary ?? []).reduce(
    (sum, row) => sum + (row.nights ?? 0),
    0,
  );
  const dateNights =
    q.travelStartDate && q.travelEndDate
      ? Math.max(
          0,
          Math.round(
            (new Date(q.travelEndDate).getTime() - new Date(q.travelStartDate).getTime()) /
              86_400_000,
          ),
        )
      : null;
  const nights = itineraryNights > 0 ? itineraryNights : dateNights || null;

  // Reference "Summary & Pricing": the package total is per-passenger pricing
  // multiplied by this lead's traveller mix. The mix is prefilled from the
  // quotation snapshot but stays editable — a manual edit (kept as a draft
  // string) overrides the prefill after validation, and is normalised to a
  // non-negative whole number within the schema bounds for pricing.
  const basePax = {
    adults: q.adults ?? 0,
    cwb: q.childrenWithBed ?? 0,
    cwob: q.childrenWithoutBed ?? 0,
    infants: q.infants ?? 0,
  };
  const paxNumberFor = (key: TravelerCountKey): number => {
    const draft = travelerCountEdits[key];
    if (draft === undefined) return basePax[key];
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) return basePax[key];
    return clampTravelerCount(key, parsed);
  };
  const pax: Record<TravelerCountKey, number> = {
    adults: paxNumberFor('adults'),
    cwb: paxNumberFor('cwb'),
    cwob: paxNumberFor('cwob'),
    infants: paxNumberFor('infants'),
  };
  const travelerCountsChanged =
    pax.adults !== basePax.adults ||
    pax.cwb !== basePax.cwb ||
    pax.cwob !== basePax.cwob ||
    pax.infants !== basePax.infants;
  const onTravelerCountChange = (key: TravelerCountKey, raw: string) => {
    setTravelerCountEdits((prev) => ({ ...prev, [key]: raw }));
  };
  // On blur an empty or invalid entry snaps back to a valid whole number instead
  // of lingering as an uneditable blank.
  const onTravelerCountBlur = (key: TravelerCountKey) => {
    setTravelerCountEdits((prev) => {
      const draft = prev[key];
      if (draft === undefined) return prev;
      const parsed = Number(draft);
      const normalized =
        draft.trim() === '' || !Number.isFinite(parsed)
          ? clampTravelerCount(key, basePax[key])
          : clampTravelerCount(key, parsed);
      return { ...prev, [key]: String(normalized) };
    });
  };
  const travellers = [
    pax.adults ? `${pax.adults} Adult(s)` : '',
    pax.cwb + pax.cwob ? `${pax.cwb + pax.cwob} Child(ren)` : '',
    pax.infants ? `${pax.infants} Infant(s)` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const perPax = {
    adult: Number(form.watch('perAdultPrice') ?? 0),
    cwb: Number(form.watch('perChildWithBedPrice') ?? 0),
    cwob: Number(form.watch('perChildWithoutBedPrice') ?? 0),
    infant: Number(form.watch('perInfantPrice') ?? 0),
  };
  // "Tax Note on Total Price" shows the saved note directly (no "keep existing"
  // sentinel). A hidden/unset note maps to the explicit "Do not show" option so
  // the control always has a real selection.
  const savedTaxNote = form.watch('taxNote');
  const taxNoteSelectValue = isPublicTaxNote(savedTaxNote)
    ? savedTaxNote.trim()
    : QUOTATION_TAX_NOTE_HIDDEN;
  const travelerPackageTotal =
    perPax.adult * pax.adults +
    perPax.cwb * pax.cwb +
    perPax.cwob * pax.cwob +
    perPax.infant * pax.infants;
  // Additional Price Items — flat package charges (By Traveler only). Only
  // valid positive-amount rows contribute so a blank/invalid amount can never
  // corrupt the live total.
  const packageCustomItems = form.watch('packageCustomItems') ?? [];
  const packageCustomItemsTotal = packageCustomItems.reduce(
    (sum, item) =>
      sum + (item.label?.trim() && Number(item.amount) > 0 ? Number(item.amount) : 0),
    0,
  );
  // The traveler subtotal plus any fixed additional price items. This single
  // value drives every live display (Summary & Pricing, the Pricing Breakdown
  // and the total package price) so they can never drift from the resolver.
  const packageTotal = travelerPackageTotal + packageCustomItemsTotal;
  // Builder-only row ordering for the By Traveler Price Breakdown. The effective
  // order is the saved `pricingRowOrder` (filtered to live rows) with any new
  // rows appended: traveler rows first, then custom items.
  const orderablePricingRowIds = orderPricingRows(
    [
      ...TRAVELER_PRICING_ROW_IDS.map((id) => ({ id })),
      ...packageCustomItems.map((item, index) => ({ id: item.id ?? `custom-${index}` })),
    ],
    form.watch('pricingRowOrder'),
  ).map((row) => row.id);
  const movePricingRow = (id: string, direction: -1 | 1) => {
    const index = orderablePricingRowIds.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= orderablePricingRowIds.length) return;
    const next = [...orderablePricingRowIds];
    [next[index], next[target]] = [next[target]!, next[index]!];
    form.setValue('pricingRowOrder', next, { shouldDirty: true });
  };
  const packageMargin = packageTotal - Number(form.watch('netAmount') ?? 0);
  const currency = form.watch('currency');
  // Currency-aware money formatting (₹10,000.00, $10,000.00, …). Indian
  // grouping for INR; the runtime default locale for every other currency.
  const formatMoney = (value: number, digits = 2) => {
    const code = (currency || 'INR').toUpperCase();
    const safe = Number.isFinite(value) ? value : 0;
    try {
      return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : undefined, {
        style: 'currency',
        currency: code,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(safe);
    } catch {
      return `${code} ${safe.toFixed(digits)}`;
    }
  };
  // Single shared pricing resolver for the builder. Every view (Summary &
  // Pricing, Pricing Breakdown and the summary card) reads the same numbers so
  // the grand total can never drift between them.
  const resolveCurrentPricing = (modeOverride?: string) =>
    resolveQuotationPricing({
      version: {
        pricingMode: modeOverride ?? form.watch('pricingMode'),
        finalAmount: packageTotal > 0 ? packageTotal : 0,
        currency,
        flightDetails: form.watch('flightDetails'),
        hotelDetails: form.watch('hotelDetails'),
        hotels: form.watch('hotels'),
        sightseeingDetails: form.watch('sightseeingDetails'),
        services: form.watch('services'),
        includeVisa: form.watch('includeVisa'),
        visaAmount: form.watch('visaAmount'),
        visaServiceCharge: form.watch('visaServiceCharge'),
        visaGstPercent: form.watch('visaGstPercent'),
        visaVfsCharge: form.watch('visaVfsCharge'),
        discountAmount: form.watch('discountAmount'),
        taxRate: form.watch('taxRate'),
        perAdultPrice: form.watch('perAdultPrice'),
        perChildWithBedPrice: form.watch('perChildWithBedPrice'),
        perChildWithoutBedPrice: form.watch('perChildWithoutBedPrice'),
        perInfantPrice: form.watch('perInfantPrice'),
        packageCustomItems: form.watch('packageCustomItems'),
      },
      quotation: {
        adults: pax.adults,
        childrenWithBed: pax.cwb,
        childrenWithoutBed: pax.cwob,
        infants: pax.infants,
        currency,
      },
    });
  // The Quotation Summary card's single total: the section total in
  // section-wise mode, otherwise the per-passenger package total (falling back
  // to the live itemized final total for legacy quotations with no
  // per-passenger prices). Add-ons are never shown as a separate bar — they
  // live inside the section total. The section-wise decision always comes from
  // the resolver's normalized pricing mode, never the raw form string, so the
  // summary card, the Pricing Breakdown tab and the Summary & Pricing tab can
  // never disagree about the mode.
  const livePricing = resolveCurrentPricing();
  const isSectionWisePricing = livePricing.pricingMode === 'SECTION_WISE';
  // The single authoritative builder total. In section-wise mode this is always
  // the resolver's sectionTotal. It also becomes the sectionTotal when the
  // quotation is section-priced (no per-person package price) even if the
  // stored pricing mode is the legacy TOTAL default — otherwise the summary
  // card would show ₹0 instead of the sum of the priced sections. A real
  // per-person package total always wins in TOTAL mode.
  const hasPackagePrice = packageTotal > 0;
  const summaryTotal =
    isSectionWisePricing || (!hasPackagePrice && livePricing.sectionTotal > 0)
      ? livePricing.grandTotal
      : hasPackagePrice
        ? livePricing.grandTotal
        : estimate.final;
  // Authoritative pricing-completeness validation is enforced by the backend
  // on finalization; the builder previously mirrored it in a read-only
  // "Pricing Validation" warning box, which has been removed.

  const validationMessageFor = (path: string, message: string) => {
    const serviceMatch = path.match(/^services\.(\d+)\.(.+)$/);
    if (serviceMatch) {
      const index = Number(serviceMatch[1]);
      const fieldName = serviceMatch[2];
      const service = form.getValues(`services.${index}` as FieldPath<QuotationVersionInput>) as
        QuotationVersionInput['services'][number] | undefined;
      const label =
        service?.serviceType === 'CRUISE'
          ? 'Cruise'
          : service?.serviceType === 'VEHICLE_TRANSFER'
            ? 'Vehicle'
            : service?.serviceType === 'OTHER_ADD_ON'
              ? 'Add-on service'
              : service?.serviceType === 'SIGHTSEEING'
                ? 'Sightseeing service'
                : service?.serviceType === 'FLIGHT'
                  ? 'Flight service'
                  : 'Service';
      if (fieldName === 'description' && /characters|too long/i.test(message))
        return `${label} ${index + 1} description is too long.`;
      if (fieldName === 'name') return `${label} ${index + 1} needs a name.`;
      return `${label} ${index + 1}: ${message}`;
    }
    const hotelMatch = path.match(/^hotels\.(\d+)\.(.+)$/);
    if (hotelMatch) {
      const index = Number(hotelMatch[1]) + 1;
      const fieldName = hotelMatch[2];
      if (fieldName === 'hotelName') return `Hotel stay ${index} needs a hotel name.`;
      if (fieldName === 'images') return `Hotel stay ${index} images could not be read.`;
      return `Hotel stay ${index}: ${message}`;
    }
    if (path === 'inclusionsHtml') return 'Inclusions content is too long.';
    if (path === 'exclusionsHtml') return 'Exclusions content is too long.';
    if (path === 'title') return 'Quotation title is required.';
    if (path === 'currency') return 'Currency must be a 3-letter code.';
    if (path.includes('images')) return 'One image gallery could not be read.';
    return `${path.replace(/\.\d+\./g, ' ').replace(/\./g, ' ')}: ${message}`;
  };

  // Persist a manually edited traveller mix before the version save. The
  // version's stored totals are recomputed by the backend from the quotation's
  // counts, so the counts must land first. No-op when the prefill is unchanged.
  const persistTravelerCounts = async () => {
    if (!travelerCountsChanged) return;
    await updateQuotation.mutateAsync({
      adults: pax.adults,
      childrenWithBed: pax.cwb,
      childrenWithoutBed: pax.cwob,
      infants: pax.infants,
    });
  };

  const submit = form.handleSubmit(
    (value) => {
      if (
        value.flightDetails?.entryMode !== 'IMAGE' &&
        hasInvalidFlightTiming(value.flightDetails)
      ) {
        setInvalidFields([
          'flightDetails: Arrival date and time must be after departure date and time.',
        ]);
        setActiveTab('flight');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      setInvalidFields([]);
      const seq = <T extends object>(rows: T[]) =>
        rows.map((row, index) => ({ ...row, sequence: index + 1 }));
      // Persist the auto-calculated segment durations (the field is read-only UI).
      const withDurations = (
        journey: NonNullable<QuotationVersionInput['flightDetails']>['outbound'],
      ) => ({
        ...journey,
        segments: (journey.segments ?? []).map((s) => ({
          ...s,
          duration:
            computeDuration(s.departureDate, s.departureTime, s.arrivalDate, s.arrivalTime) ||
            s.duration ||
            null,
        })),
      });
      const flightDetails = value.flightDetails
        ? {
            ...value.flightDetails,
            flights: (value.flightDetails.flights ?? []).map((flight) => {
              const keepRaw = value.flightDetails?.entryMode === 'IMAGE';
              return {
                ...flight,
                outbound: keepRaw ? flight.outbound : withDurations(flight.outbound),
                returnJourney: keepRaw ? flight.returnJourney : withDurations(flight.returnJourney),
              };
            }),
          }
        : value.flightDetails;
      const submittedServices = value.services;
      // Excluded sections are removed from the persisted snapshot.
      const persistedServices = (() => {
        let filtered: typeof submittedServices = submittedServices;
        if (excluded.cruise) filtered = filtered.filter((service) => service.serviceType !== 'CRUISE');
        if (excluded.vehicle) filtered = filtered.filter((service) => service.serviceType !== 'VEHICLE_TRANSFER');
        return filtered;
      })();
      void (async () => {
        try {
          await persistTravelerCounts();
        } catch {
          // Never save the version against stale counts if the count PATCH fails.
          initialSnapshotRef.current.autoSaving = false;
          return;
        }
        save.mutate(
        {
          ...value,
          flightDetails,
          hotelDetails: {
            sectionTitle: value.hotelDetails?.sectionTitle ?? 'Your Hotels',
            amount: value.hotelDetails?.amount ?? 0,
            description: value.hotelDetails?.description ?? null,
            include: !excludedRef.current.hotel,
            // Persist the bookmark image order and the "Use in PDF" selection
            // so the weblink carousel and the generated PDF survive re-saves.
            images: value.hotelDetails?.images ?? [],
            pdfImageUrl: value.hotelDetails?.pdfImageUrl ?? null,
          },
          addOnDetails: {
            include: value.addOnDetails?.include !== false,
            sectionTitle: value.addOnDetails?.sectionTitle ?? 'Additional Services',
          },
          sightseeingDetails: value.sightseeingDetails
            ? {
                ...value.sightseeingDetails,
                days: value.sightseeingDetails.days.map((day, dayIndex) => ({
                  ...day,
                  dayNumber: dayIndex + 1,
                  title: formatItineraryDayTitle(dayIndex + 1, day.title),
                  activities: day.activities.map((activity, activityIndex) => ({
                    ...activity,
                    sequence: activityIndex + 1,
                  })),
                })),
              }
            : value.sightseeingDetails,
          itinerary: seq(value.itinerary).map((row, index) => ({ ...row, dayNumber: index + 1 })),
          hotels: seq(value.hotels)
            .map((hotel, index) => {
              // Untouched default allocations are dropped; partially filled
              // ones are kept so validation reports the exact room number.
              const roomLines = (hotel.roomLines ?? []).filter(roomLineHasData);
              const mealPlanLines = (hotel.mealPlanLines ?? []).filter(mealLineHasData);
              const firstRoom = roomLines[0];
              const firstMeal = mealPlanLines[0];
              return {
                ...hotel,
                // Persist the calendar-date-derived nights whenever valid dates
                // exist, so re-saving repairs historical incorrect night counts.
                // Stay dates are optional: with either date missing the snapshot
                // keeps NULL (unknown) — never 0, which fails validation, and
                // never a stale count from previously cleared dates.
                nights:
                  hotelStayNights(hotel.checkInDate, hotel.checkOutDate) ??
                  (typeof hotel.nights === 'number' && hotel.nights > 0 ? hotel.nights : null),
                roomLines,
                mealPlanLines,
                // Mirror the first allocation onto the legacy scalar columns so
                // older readers (PDF fallbacks, booking import, exports) always
                // see a coherent snapshot; `rooms` is the total across ALL
                // allocations.
                ...(roomLines.length
                  ? {
                      hotelRoomTypeId: firstRoom?.hotelRoomTypeId ?? null,
                      roomType: firstRoom?.roomType ?? null,
                      // Persist the displayed total: the manual override when
                      // one exists, otherwise the live allocation sum.
                      rooms:
                        resolveHotelRooms(hotels.fields[index]?.id, hotel).value ??
                        roomLines.reduce((sum, line) => sum + (Number(line.rooms) || 1), 0),
                      extraBedQuantity: firstRoom?.extraBedQuantity ?? null,
                      extraBedPrice: firstRoom?.extraBedPrice ?? null,
                      childWithoutBedQuantity: firstRoom?.childWithoutBedQuantity ?? null,
                      childWithoutBedPrice: firstRoom?.childWithoutBedPrice ?? null,
                      baseRoomPrice: firstRoom?.baseRoomPrice ?? null,
                      pricingSource: firstRoom?.pricingSource ?? null,
                    }
                  : {}),
                ...(mealPlanLines.length
                  ? {
                      hotelMealPlanId: firstMeal?.hotelMealPlanId ?? null,
                      mealPlan: firstMeal?.mealPlan ?? null,
                    }
                  : {}),
              };
            })
            // Draft Hotel Stays added via "Add Hotel Before/After" but never
            // named have no hotel name — they must not be persisted (the API
            // also rejects empty hotel rows).
            .filter((hotel) => (hotel.hotelName ?? '').trim().length > 0),
          customCharges: (value.customCharges ?? [])
            .filter((c) => c.label?.trim() && Number(c.amount) > 0)
            .map((c) => ({
              label: c.label!.trim(),
              amount: Number(c.amount),
              description: (c as { description?: string | null }).description?.trim() || null,
              category: (c as { category?: string | null }).category?.trim() || null,
            })),
          packageCustomItems: (value.packageCustomItems ?? [])
            .filter((item) => item.label?.trim() && Number(item.amount) > 0)
            .map((item) => ({
              ...(item.id ? { id: item.id } : {}),
              label: item.label!.trim(),
              amount: Number(item.amount),
            })),
          services: seq(
            (persistedServices as unknown as QuotationVersionInput['services']).map((service: QuotationVersionInput['services'][number]) => {
                if ((service as unknown as { serviceType: string })?.serviceType !== 'CRUISE') return service;
                const svc = service as unknown as QuotationVersionInput['services'][number] & {
                  cruiseRoomLines?: QuotationCruiseRoomLine[];
                  cruiseNights?: number | null;
                  quantity?: number;
                  sellingPrice?: number;
                };
                const lines = ((svc as unknown as { cruiseRoomLines?: QuotationCruiseRoomLine[] }).cruiseRoomLines ?? []).filter(cruiseRoomLineHasData) as QuotationCruiseRoomLine[];
                // Keep partially filled lines for validation; drop untouched defaults
                // Nights stay null when empty (never defaulted); the shared
                // helper totals rate × rooms without a multiplier then.
                const nights = (svc as unknown as { cruiseNights?: number | null }).cruiseNights ?? null;
                const total = lines.reduce((sum: number, line: QuotationCruiseRoomLine) => {
                  const rate = (line.roomRate ?? line.sellingPrice ?? 0) as number;
                  const rooms = (line.rooms ?? 1) as number;
                  return sum + Number(rate || 0) * Number(rooms || 1) * Number(nights || 1);
                }, 0);
                return {
                  ...(svc as unknown as Record<string, unknown>),
                  cruiseRoomLines: lines,
                  // Mirror total for legacy readers (PDF fallback) – quantity stays 1, sellingPrice is total
                  quantity: 1,
                  sellingPrice: total,
                  // With rooms, mirror the first line's type; with none, clear
                  // the type scalars so stale values can never resurrect a
                  // removed room from legacy synthesis on reload.
                  ...(lines[0]
                    ? { cruiseRoomTypeId: (lines[0] as QuotationCruiseRoomLine).cruiseRoomTypeId ?? null, city: (lines[0] as QuotationCruiseRoomLine).roomType ?? null }
                    : { cruiseRoomTypeId: null, city: null }),
                } as unknown as QuotationVersionInput['services'][number];
              })
              .filter((service) => {
                const t = (service as unknown as { serviceType: string })?.serviceType;
                if (t === 'CRUISE') {
                  const svc = service as unknown as { name?: string | null; cruiseId?: string | null };
                  return Boolean((svc.name ?? '').trim() || svc.cruiseId);
                }
                if (t === 'VEHICLE_TRANSFER') {
                  const svc = service as unknown as { name?: string | null; vehicleId?: string | null };
                  return Boolean((svc.name ?? '').trim() || svc.vehicleId);
                }
                return true;
              }),
          ),
          inclusions: seq(value.inclusions),
          exclusions: seq(value.exclusions),
          terms: seq(value.terms),
          faqs: (value.faqs ?? [])
            .map((row) => ({
              question: (row.question ?? '').trim(),
              answer: (row.answer ?? '').trim(),
            }))
            .filter((row) => row.question && row.answer),
          weblinkSectionOrder: value.weblinkSectionOrder?.length
            ? resolveWeblinkSectionOrder(value.weblinkSectionOrder)
            : null,
          weblinkProfile: normalizeWeblinkProfileConfig(value.weblinkProfile),
          destinationExpertConfig: value.destinationExpertConfig
            ? {
                enabled: Boolean(value.destinationExpertConfig.enabled),
                expertUserId: value.destinationExpertConfig.expertUserId ?? null,
                heading: (value.destinationExpertConfig.heading ?? '').trim() || null,
                customIntroduction:
                  (value.destinationExpertConfig.customIntroduction ?? '').trim() || null,
                whatsappNumber:
                  ((value.destinationExpertConfig as unknown as Record<string, unknown>).whatsappNumber as string | null | undefined)?.trim() || null,
                callNumber:
                  ((value.destinationExpertConfig as unknown as Record<string, unknown>).callNumber as string | null | undefined)?.trim() || null,
                email:
                  ((value.destinationExpertConfig as unknown as Record<string, unknown>).email as string | null | undefined)?.trim().toLowerCase() || null,
                showWhatsapp: value.destinationExpertConfig.showWhatsapp !== false,
                showCall: value.destinationExpertConfig.showCall !== false,
                showEmail: value.destinationExpertConfig.showEmail !== false,
                showExperience: value.destinationExpertConfig.showExperience !== false,
                showTripsPlanned: value.destinationExpertConfig.showTripsPlanned !== false,
                  showLanguages: value.destinationExpertConfig.showLanguages !== false,
                  jobTitle: ((value.destinationExpertConfig as unknown as Record<string, unknown>).jobTitle as string | null | undefined)?.trim() || null,
                  bio: ((value.destinationExpertConfig as unknown as Record<string, unknown>).bio as string | null | undefined)?.trim() || null,
                  specialization: ((value.destinationExpertConfig as unknown as Record<string, unknown>).specialization as string | null | undefined)?.trim() || null,
                  yearsOfExperience: (value.destinationExpertConfig as unknown as { yearsOfExperience?: number | null }).yearsOfExperience ?? null,
                  tripsPlanned: (value.destinationExpertConfig as unknown as { tripsPlanned?: number | null }).tripsPlanned ?? null,
                  languages: ((value.destinationExpertConfig as unknown as Record<string, unknown>).languages as string | null | undefined)?.trim() || null,
                  gender: ((value.destinationExpertConfig as unknown as Record<string, unknown>).gender as string | null | undefined) as 'MALE' | 'FEMALE' | null ?? null,
                  profileImageUrl: ((value.destinationExpertConfig as unknown as Record<string, unknown>).profileImageUrl as string | null | undefined)?.trim() || null,
                  destination: ((value.destinationExpertConfig as unknown as Record<string, unknown>).destination as string | null | undefined)?.trim() || null,
                } as unknown as NonNullable<QuotationVersionInput['destinationExpertConfig']>
              : null,
        },
        {
          onSuccess: () => {
            if (initialSnapshotRef.current.autoSaving) {
              initialSnapshotRef.current.autoSaving = false;
              return;
            }
            navigate(`/quotations/${quotationId}`);
          },
          onError: () => {
            initialSnapshotRef.current.autoSaving = false;
          },
        },
        );
      })();
    },
    (errors) => {
      // Surface why a save was blocked instead of failing silently.
      const paths: string[] = [];
      const walk = (node: unknown, prefix: string) => {
        if (!node || typeof node !== 'object') return;
        const record = node as Record<string, unknown>;
        if (typeof record.message === 'string') {
          paths.push(validationMessageFor(prefix.replace(/\.$/, ''), record.message));
          return;
        }
        for (const key of Object.keys(record)) {
          if (key === 'ref' || key === 'type') continue;
          walk(record[key], `${prefix}${key}.`);
        }
      };
      walk(errors, '');
      setInvalidFields(paths.slice(0, 15));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  );

  const isIncluded = (key: string) => !excluded[key];
  const toggleInclude = (key: string) => {
    // Any explicit toggle is a user choice: automatic prefill from the Lead must
    // never re-enable a section afterwards.
    autoToggleRef.current.add(key);
    // Only turning Hotel OFF blocks automatic prefill. Turning it ON clears the
    // block so a newly added empty stay can still receive its default.
    if (key === 'hotel') {
      const next = !excluded[key];
      autoHotelRef.current.userToggledHotel = next;
    }
    const next = !excluded[key];
    setExcluded((current) => ({ ...current, [key]: next }));
    // Turning Hotel off (`next === true` → excluded) must drop any stale Hotel
    // field errors immediately so an empty hidden row cannot keep blocking a
    // draft save. Other sections' errors are left untouched.
    if (key === 'hotel' && next) {
      form.clearErrors(['hotels', 'hotelDetails']);
      setInvalidFields((current) =>
        current.filter((entry) => !/^(hotels|hotelDetails)(\.|:)/.test(entry)),
      );
    }
    // Turning Cruise/Vehicle on auto-creates exactly one clean entry when none exist,
    // or fills the empty section title of an existing entry; turning it off
    // clears its service-row errors.
    if (key === 'cruise') {
      if (!next) {
        const cruiseIndexes = (services.fields ?? [])
          .map((_, index) => index)
          .filter((index) => watchedServices?.[index]?.serviceType === 'CRUISE');
        if (!cruiseIndexes.length) {
          services.append(newCruiseServiceRow(services.fields.length + 1));
        } else {
          // Never replace a custom title — only fill an empty/whitespace one.
          const primaryIndex = cruiseIndexes[0]!;
          const current = watchedServices?.[primaryIndex]?.taxCategory;
          if (!(current ?? '').trim())
            applyService(primaryIndex, { taxCategory: 'Cruise Details' });
        }
      } else {
        const cruiseIndexes = (services.fields ?? [])
          .map((_, index) => index)
          .filter((index) => watchedServices?.[index]?.serviceType === 'CRUISE');
        if (cruiseIndexes.length) {
          form.clearErrors(
            cruiseIndexes.map((index) => `services.${index}` as FieldPath<QuotationVersionInput>),
          );
          setInvalidFields((current) =>
            current.filter((entry) => {
              const match = entry.match(/^services\.(\d+)/);
              return !(match && cruiseIndexes.includes(Number(match[1])));
            }),
          );
        }
      }
    }
    if (key === 'vehicle') {
      if (!next) {
        // Turning Vehicle ON: for NEW quotations automatically prefill ALL matching vehicles
        // for current destinations via destinationId-filtered API.
        const savedVehicleCountForToggle = (version?.services ?? []).filter(
          (service) => service.serviceType === 'VEHICLE_TRANSFER' && service.vehicleId,
        ).length;
        if (shouldAutoPrefillVehicles(savedVehicleCountForToggle) && destinationMasters.data) {
          const effectiveIds = [...vehicleEffectiveDestinationIds];
          if (effectiveIds.length) {
            // If any destination still loading, defer to the effect (don't create blank row yet)
            const isAnyPending = effectiveIds.some((_, idx) => {
              const q = vehiclesByDestination[idx];
              return !q || q.isPending || !q.data;
            });
            if (isAnyPending) return;
            // Collect vehicles already filtered by backend for each destination (index-aligned)
            const allMasters: PrefillVehicleMaster[] = [];
            for (let idx = 0; idx < effectiveIds.length; idx++) {
              const q = vehiclesByDestination[idx];
              const data = (q?.data as unknown as Page<any> | undefined)?.data ?? [];
              for (const v of data) allMasters.push(v as unknown as PrefillVehicleMaster);
            }
            const present = new Set(
              (
                ((form.getValues('services') ?? []) as Array<{
                  serviceType?: string;
                  vehicleId?: string | null;
                }>) ?? []
              )
                .filter((row) => row.serviceType === 'VEHICLE_TRANSFER' && row.vehicleId)
                .map((row) => row.vehicleId as string),
            );
            const missing: PrefillVehicleMaster[] = [];
            const seen = new Set(present);
            for (const master of allMasters) {
              if (seen.has(master.id)) continue;
              seen.add(master.id);
              missing.push(master);
            }
            if (missing.length) {
              placeMissingVehicles(missing);
              return;
            }
          }
        }
        const vehicleIndexes = (services.fields ?? [])
          .map((_, index) => index)
          .filter((index) => watchedServices?.[index]?.serviceType === 'VEHICLE_TRANSFER');
        if (!vehicleIndexes.length) {
          // Seed a blank row only when there is something to pick. With no
          // active vehicles the section shows its empty state instead of a
          // blank picker (and nothing is auto-prefilled for the destination).
          if ((vehicleMasters.data?.data ?? []).length > 0) {
            services.append(newVehicleServiceRow(services.fields.length + 1));
          }
        } else {
          const primaryIndex = vehicleIndexes[0]!;
          const current = watchedServices?.[primaryIndex]?.taxCategory;
          if (!(current ?? '').trim())
            applyService(primaryIndex, { taxCategory: 'Transportation' });
        }
      } else {
        const vehicleIndexes = (services.fields ?? [])
          .map((_, index) => index)
          .filter((index) => watchedServices?.[index]?.serviceType === 'VEHICLE_TRANSFER');
        if (vehicleIndexes.length) {
          form.clearErrors(
            vehicleIndexes.map((index) => `services.${index}` as FieldPath<QuotationVersionInput>),
          );
          setInvalidFields((current) =>
            current.filter((entry) => {
              const match = entry.match(/^services\.(\d+)/);
              return !(match && vehicleIndexes.includes(Number(match[1])));
            }),
          );
        }
      }
    }
  };

  /** A coloured section header bar like the reference tabs' bodies. */
  const IncludeBar = ({ tabKey, label }: { tabKey: string; label: string }) => (
    <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
      <input type="checkbox" checked={isIncluded(tabKey)} onChange={() => toggleInclude(tabKey)} />
      Include {label} in Quotation
    </label>
  );

  /** Render the service rows belonging to a tab, plus an add button. */
  const serviceTab = (tab: TabDef) => {
    const types = tab.types ?? [];
    const rows = services.fields
      .map((row, index) => ({ row, index }))
      .filter(({ index }) =>
        types.includes((watchedServices?.[index]?.serviceType ?? 'SIGHTSEEING') as ServiceType),
      );
    return (
      <div className="space-y-4">
        <IncludeBar tabKey={tab.key} label={tab.label} />
        {isIncluded(tab.key) && (
          <>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  services.append({
                    serviceType: types[0] ?? 'OTHER_ADD_ON',
                    ...CLEARED_SERVICE_MASTERS,
                    name: '',
                    description: null,
                    dayNumber: null,
                    city: null,
                    quantity: 1,
                    internalCost: 0,
                    sellingPrice: 0,
                    taxCategory: null,
                    notes: null,
                    sequence: services.fields.length + 1,
                  })
                }
              >
                <Plus className="h-4 w-4" /> Add {tab.label}
              </Button>
            </div>
            {rows.length === 0 && (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">
                No {tab.label.toLowerCase()} added yet.
              </p>
            )}
            {rows.map(({ row, index }) => (
              <article key={row.id} className="grid gap-3 rounded-lg border p-4 md:grid-cols-4">
                <select
                  aria-label="Service type"
                  {...form.register(`services.${index}.serviceType`, {
                    onChange: () => applyService(index, CLEARED_SERVICE_MASTERS),
                  })}
                  className={field}
                >
                  {(tab.types ?? []).map((value) => (
                    <option key={value} value={value}>
                      {labelForLookup(value)}
                    </option>
                  ))}
                </select>
                <ServiceMasterFields
                  serviceType={watchedServices?.[index]?.serviceType ?? 'SIGHTSEEING'}
                  value={{
                    airlineId: watchedServices?.[index]?.airlineId,
                    cruiseId: watchedServices?.[index]?.cruiseId,
                    cruiseRoomTypeId: watchedServices?.[index]?.cruiseRoomTypeId,
                    vehicleId: watchedServices?.[index]?.vehicleId,
                    sightseeingId: watchedServices?.[index]?.sightseeingId,
                    addOnServiceId: watchedServices?.[index]?.addOnServiceId,
                  }}
                  onChange={(patch) => applyService(index, patch)}
                />
                <input
                  aria-label="Service name"
                  placeholder="Name / title"
                  {...form.register(`services.${index}.name`)}
                  className={field}
                />
                <input
                  aria-label="Service city"
                  placeholder="City"
                  {...form.register(`services.${index}.city`)}
                  className={field}
                />
                <input
                  aria-label="Service day"
                  type="number"
                  placeholder="Day"
                  {...form.register(`services.${index}.dayNumber`, { setValueAs: nullable })}
                  className={field}
                />
                <input
                  aria-label="Quantity"
                  type="number"
                  step="0.01"
                  placeholder="Qty"
                  {...form.register(`services.${index}.quantity`, {
                    setValueAs: (value) => {
                      const parsed = Number(value);
                      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
                    },
                  })}
                  className={field}
                />
                {canCost && (
                  <input
                    aria-label="Service unit cost"
                    type="number"
                    step="0.01"
                    placeholder="Unit cost"
                    {...form.register(`services.${index}.internalCost`, { setValueAs: nullable })}
                    className={field}
                  />
                )}
                <input
                  aria-label="Service unit selling"
                  type="number"
                  step="0.01"
                  placeholder="Selling price"
                  {...form.register(`services.${index}.sellingPrice`, { setValueAs: nullable })}
                  className={field}
                />
                <textarea
                  aria-label="Service description"
                  rows={2}
                  placeholder="Description"
                  {...form.register(`services.${index}.description`)}
                  className={`${field} md:col-span-3`}
                />
                <div className="flex items-end">
                  <Button size="sm" variant="ghost" onClick={() => services.remove(index)}>
                    <Trash2 className="h-4 w-4 text-red-600" /> Remove
                  </Button>
                </div>
              </article>
            ))}
          </>
        )}
      </div>
    );
  };

  /** Reference Vehicle tab: one or more vehicle masters, each independently repeatable. */
  const vehicleTab = () => {
    const vehicleRows = services.fields
      .map((row, index) => ({ row, index }))
      .filter(({ index }) => watchedServices?.[index]?.serviceType === 'VEHICLE_TRANSFER');
    const masters = vehicleMasters.data?.data ?? [];
    // The vehicle picker is deliberately destination-independent: every ACTIVE
    // vehicle the tenant can see is offered, whatever destinations it is linked
    // to (destination linkage drives the automatic prefill only, never the
    // dropdown options). `masters` therefore holds the full active catalogue.
    const vehiclesLoading = vehicleMasters.isPending;
    const hasActiveVehicles = masters.length > 0;
    const primaryIndex = vehicleRows[0]?.index;
    const primary = primaryIndex !== undefined ? (watchedServices?.[primaryIndex] as unknown as QuotationVersionInput['services'][number] | undefined) : undefined;
    const isVehicleSectionWise = (form.watch('pricingMode') as string) === 'SECTION_WISE';
    const vehicleTotal = vehicleRows.reduce((sum, { index }) => {
      const svc = watchedServices?.[index] as unknown as { quantity?: number | null; pricingBasis?: string | null; sellingPrice?: number | null } | undefined;
      const qty = svc?.quantity != null ? Number(svc.quantity) : 1;
      const basis = String(svc?.pricingBasis ?? 'PER_DAY');
      const rate = Number((svc as unknown as { sellingPrice?: number | null })?.sellingPrice ?? 0);
      const mult = basis === 'FIXED' ? 1 : Math.max(1, Math.floor(qty || 1));
      return sum + rate * mult;
    }, 0);
    return (
      <div className="space-y-5">
        <IncludeBar tabKey="vehicle" label="Vehicle" />
        {isIncluded('vehicle') && (
          <>
            {primaryIndex !== undefined && (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-800">
                  Section Title
                  <input
                    aria-label="Vehicle section title"
                    maxLength={80}
                    value={primary?.taxCategory ?? ''}
                    onChange={(event) =>
                      applyService(primaryIndex, { taxCategory: event.target.value || null })
                    }
                    className={`${field} mt-1`}
                  />
                </label>
              </div>
            )}
            {isVehicleSectionWise && primary && (
              <div className={`${calculatedCard} flex items-center justify-between`}>
                <span className={calculatedLabel}>Transportation Total</span>
                <span className={calculatedValue}>
                  {formatMoney(vehicleTotal)} {vehicleRows.length > 1 ? `· ${vehicleRows.length} vehicles` : ''}
                </span>
              </div>
            )}
            {hasActiveVehicles && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => services.append(newVehicleServiceRow(services.fields.length + 1))}
                >
                  <Plus className="h-4 w-4" /> Add Vehicle
                </Button>
              </div>
            )}
            {!vehiclesLoading && !hasActiveVehicles && (
              // No selectable vehicles at all: explain it instead of rendering
              // blank pickers. Existing saved rows (if any) still render below.
              <p
                role="status"
                className="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-slate-500"
              >
                No active vehicles are available for your company yet. Add vehicles in{' '}
                <span className="font-medium text-slate-700">Masters → Vehicles</span> to select them
                here.
              </p>
            )}
            {vehicleRows.length === 0 && hasActiveVehicles && (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">
                No vehicle added yet. Add the first vehicle below.
              </p>
            )}
            <div className="space-y-4">
              {vehicleRows.map(({ row, index }, vehiclePosition) => {
                const vehicle = watchedServices?.[index] as unknown as QuotationVersionInput['services'][number] | undefined;
                // Every vehicle card starts collapsed; state is keyed by row id.
                const isVehicleExpanded = expandedVehicles[row.id] ?? false;
                const isFirstVehicle = vehiclePosition === 0;
                const isLastVehicle = vehiclePosition === vehicleRows.length - 1;
                // Move up/down by one vehicle position, preserving each row's data.
                const moveVehicle = (direction: -1 | 1) => {
                  const target = vehicleRows[vehiclePosition + direction];
                  if (target) services.move(index, target.index);
                };
                const vehicleType = (vehicle as unknown as { city?: string | null })?.city ?? '';
                const vehicleId = (vehicle as unknown as { vehicleId?: string | null })?.vehicleId ?? '';
                const vehicleName = (vehicle as unknown as { name?: string | null })?.name ?? '';
                const usage = (vehicle as unknown as { notes?: string | null })?.notes ?? '';
                const duration = (vehicle as unknown as { duration?: string | null })?.duration ?? '';
                const description = (vehicle as unknown as { description?: string | null })?.description ?? '';
                const amount = Number((vehicle as unknown as { sellingPrice?: number | null })?.sellingPrice ?? 0);
                const pricingBasis = String((vehicle as unknown as { pricingBasis?: string | null })?.pricingBasis ?? 'PER_DAY');
                const quantity = Number((vehicle as unknown as { quantity?: number | null })?.quantity ?? 1);
                const vehicleTypes = [...new Set(masters.map((m) => m.vehicleType).filter(Boolean) as string[])]
                  .concat(
                    vehicleType && !masters.some((m) => m.vehicleType === vehicleType) ? [vehicleType] : [],
                  )
                  .sort((a, b) => a.localeCompare(b));
                const models = vehicleType ? masters.filter((m) => m.vehicleType === vehicleType) : [];
                // A reopened row keeps its saved vehicle visible even when that
                // master is no longer in the active list (e.g. it was
                // deactivated), so the selection never silently blanks. Inactive
                // masters are never added to the selectable list — only this
                // already-saved value is echoed back.
                const currentModelOption =
                  vehicleId && !models.some((m) => m.id === vehicleId)
                    ? { id: vehicleId, name: vehicleName || 'Selected vehicle' }
                    : null;
                return (
                  <article
                    key={row.id}
                    className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
                  >
                    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <button
                          type="button"
                          aria-expanded={isVehicleExpanded ? 'true' : 'false'}
                          aria-label={`${isVehicleExpanded ? 'Collapse' : 'Expand'} vehicle ${vehiclePosition + 1}`}
                          title={`${isVehicleExpanded ? 'Collapse' : 'Expand'} vehicle ${vehiclePosition + 1}`}
                          onClick={() =>
                            setExpandedVehicles((current) => ({
                              ...current,
                              [row.id]: !isVehicleExpanded,
                            }))
                          }
                          className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                        >
                          <ChevronDown
                            aria-hidden="true"
                            className={`h-5 w-5 transition-transform ${isVehicleExpanded ? 'rotate-180' : ''}`}
                          />
                        </button>
                        <div className="min-w-0">
                          <h4 className="truncate font-semibold text-[16px] text-slate-800">
                            {vehicleName.trim() || 'Vehicle'}
                          </h4>
                        </div>
                      </div>
                      {/* Icon trio matching the hotel stay header: Up, Down and
                          an icon-only Delete carrying its own accessible label. */}
                      <div className="flex items-center gap-0.5 shrink-0 ml-auto">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="px-0.5 hover:bg-transparent"
                          disabled={isFirstVehicle}
                          aria-label={`Move vehicle ${vehiclePosition + 1} up`}
                          title={`Move vehicle ${vehiclePosition + 1} up`}
                          onClick={() => moveVehicle(-1)}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="px-0.5 hover:bg-transparent"
                          disabled={isLastVehicle}
                          aria-label={`Move vehicle ${vehiclePosition + 1} down`}
                          title={`Move vehicle ${vehiclePosition + 1} down`}
                          onClick={() => moveVehicle(1)}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="px-0.5"
                          aria-label={`Remove vehicle ${vehiclePosition + 1}`}
                          title={`Remove vehicle ${vehiclePosition + 1}`}
                          onClick={() => services.remove(index)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </header>
                    {isVehicleExpanded && (
                    <div className="space-y-4 p-4">
                      {isVehicleSectionWise && (
                        <div className="grid gap-4 md:grid-cols-3">
                          <label className="text-sm font-semibold text-slate-800">
                            Rate
                            <div className="mt-1 flex rounded-lg border border-slate-300 bg-card focus-within:ring-2 focus-within:ring-brand-500">
                              <span className="flex items-center border-r px-3 text-sm text-slate-500">{currency}</span>
                              <input
                                aria-label={`Vehicle ${index + 1} amount`}
                                type="number"
                                min="0"
                                step="0.01"
                                value={amount}
                                onChange={(event) =>
                                  applyService(index, { sellingPrice: Math.max(0, Number(event.target.value) || 0) } as unknown as ServiceRowPatch)
                                }
                                className="w-full rounded-r-lg bg-transparent px-3 py-2 text-sm outline-none"
                              />
                            </div>
                          </label>
                          <label className="text-sm font-semibold text-slate-800">
                            Pricing Basis
                            <select
                              aria-label={`Vehicle ${index + 1} pricing basis`}
                              value={pricingBasis}
                              onChange={(event) => applyService(index, { pricingBasis: event.target.value as never })}
                              className={`${field} mt-1`}
                            >
                              {VEHICLE_PRICING_BASES.map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-sm font-semibold text-slate-800">
                            {pricingBasis === 'PER_HOUR'
                              ? 'Hours'
                              : pricingBasis === 'PER_TRANSFER'
                                ? 'Transfers'
                                : pricingBasis === 'PER_VEHICLE'
                                  ? 'Vehicles'
                                  : 'Days'}
                            <input
                              aria-label={`Vehicle ${index + 1} quantity`}
                              type="number"
                              min="1"
                              step="1"
                              value={quantity}
                              disabled={pricingBasis === 'FIXED'}
                              onChange={(event) =>
                                applyService(index, { quantity: Math.max(1, Math.floor(Number(event.target.value) || 1)) })
                              }
                              className={`${field} mt-1 disabled:bg-slate-100`}
                            />
                          </label>
                        </div>
                      )}
                      {isVehicleSectionWise && (
                        <div className={`${calculatedCard} text-sm`}>
                          <p className={calculatedLabel}>Calculation</p>
                          <p className="mt-1 text-slate-700">
                            {formatMoney(amount)} × {pricingBasis === 'FIXED' ? 1 : quantity} ={' '}
                            <span className={calculatedValue}>{formatMoney(amount * (pricingBasis === 'FIXED' ? 1 : quantity))}</span>
                          </p>
                        </div>
                      )}
                      <div>
                        <p className={`${subsectionHeading} mb-3 border-b border-border/50 pb-1`}>Vehicle Details</p>
                        <div className="grid gap-4 md:grid-cols-3">
                          <label className="text-sm font-semibold text-slate-800">
                            Vehicle Type <span className="text-red-500">*</span>
                            <select
                              aria-label={`Vehicle ${index + 1} type`}
                              value={vehicleType}
                              onChange={(event) => {
                                const newType = event.target.value;
                                applyService(index, {
                                  city: newType || null,
                                  vehicleId: null,
                                  name: '',
                                  images: [],
                                  imageSnapshotPresent: false,
                                  pdfImageUrl: null,
                                });
                                vehicleDescriptionOverriddenRef.current.delete(index);
                              }}
                              className={`${field} mt-1`}
                            >
                              <option value="">Select Vehicle Type</option>
                              {vehicleTypes.map((type) => (
                                <option key={type} value={type}>
                                  {type}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-sm font-semibold text-slate-800">
                            Vehicle Model <span className="text-red-500">*</span>
                            <select
                              aria-label={`Vehicle ${index + 1} model`}
                              value={vehicleId}
                              disabled={!vehicleType || vehicleMasters.isPending}
                              onChange={(event) => {
                                const master = masters.find((e) => e.id === event.target.value);
                                const snapshot = masterGallerySnapshot(master?.images, master?.name ?? 'Vehicle');
                                vehicleDescriptionOverriddenRef.current.delete(index);
                                const masterPrice = (master as unknown as { price?: number | null })?.price;
                                const isEmpty = amount == null || Number(amount) === 0;
                                const shouldPrefill = masterPrice != null && Number(masterPrice) > 0 && isEmpty;
                                applyService(index, {
                                  vehicleId: master?.id ?? null,
                                  name: master?.name ?? '',
                                  description: master?.description ?? null,
                                  images: snapshot,
                                  imageSnapshotPresent: masterGalleryPresence(master),
                                  pdfImageUrl: snapshot[0] ? quotationSnapshotImageIdentity(snapshot[0]) : null,
                                  ...(shouldPrefill ? { sellingPrice: Number(masterPrice) } : {}),
                                } as unknown as ServiceRowPatch);
                                if (master)
                                  void importMasterGalleryPreviews(master.id, snapshot, vehicleImageUrl).then((images) => {
                                    if (form.getValues(`services.${index}.vehicleId`) !== master.id) return;
                                    applyService(index, {
                                      images: mergeMasterGalleryPreviews(
                                        form.getValues(`services.${index}.images`) as QuotationImage[],
                                        images,
                                      ),
                                    });
                                  });
                              }}
                              className={`${field} mt-1 disabled:bg-slate-100`}
                            >
                              <option value="">Select Vehicle Model</option>
                              {currentModelOption && (
                                <option value={currentModelOption.id}>{currentModelOption.name}</option>
                              )}
                              {models.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-sm font-semibold text-slate-800">
                            Usage
                            <input
                              aria-label={`Vehicle ${index + 1} usage`}
                              maxLength={2000}
                              placeholder="e.g., Airport transfers & sightseeing"
                              value={usage}
                              onChange={(event) => applyService(index, { notes: event.target.value || null })}
                              className={`${field} mt-1`}
                            />
                          </label>
                          <label className="text-sm font-semibold text-slate-800">
                            Duration
                            <input
                              aria-label={`Vehicle ${index + 1} duration`}
                              maxLength={2000}
                              placeholder="e.g., 3 days"
                              value={duration}
                              onChange={(event) => applyService(index, { duration: event.target.value || null })}
                              className={`${field} mt-1`}
                            />
                          </label>
                        </div>
                      </div>
                      <div>
                        <h3 className={`${subsectionHeadingMuted} mb-1`}>Description</h3>
                        <RichTextEditor
                          ariaLabel={`Vehicle ${index + 1} description`}
                          value={description}
                          onChange={(html) => {
                            vehicleDescriptionOverriddenRef.current.add(index);
                            applyService(index, { description: html || null });
                          }}
                        />
                      </div>
                      <QuotationImageManager
                        label="Vehicle Images"
                        ariaPrefix={`vehicle-${index}`}
                        images={(vehicle?.images ?? []) as QuotationImage[]}
                        pdfImageUrl={vehicle?.pdfImageUrl}
                        onMove={(imageIndex, direction) => moveServiceImage(index, imageIndex, direction)}
                        onRemove={(imageIndex) => removeServiceImage(index, imageIndex)}
                        onSelectPdf={(identity) => setServicePdfImage(index, identity)}
                      />
                    </div>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  const hotelRows = hotels.fields.map((row, index) => ({ row, index }));
  const defaultHotelRows = hotelRows.filter(
    ({ index }) => watchedHotels?.[index]?.selected !== false,
  );
  const alternativeHotelRows = hotelRows.filter(
    ({ index }) => watchedHotels?.[index]?.selected === false,
  );

  const hotelCard = (index: number, rowId: string, allowInsertBefore = false) => {
    const hotel = watchedHotels?.[index];
    // Nights are derived from the hotel's own check-in/check-out calendar dates
    // and written back to the snapshot whenever either date changes. Stay
    // dates are optional: when either date is missing the snapshot keeps NULL
    // (unknown) instead of a stale or invented duration, and the UI shows a
    // placeholder until both dates are entered.
    const setStayDate = (field: 'checkInDate' | 'checkOutDate', value: Date | null) => {
      form.setValue(`hotels.${index}.${field}`, value, { shouldDirty: true });
      const checkIn = field === 'checkInDate' ? value : (hotel?.checkInDate ?? null);
      const checkOut = field === 'checkOutDate' ? value : (hotel?.checkOutDate ?? null);
      form.setValue(`hotels.${index}.nights`, hotelStayNights(checkIn, checkOut), {
        shouldDirty: true,
      });
    };
    const stayNightsValue = hotelStayNights(hotel?.checkInDate, hotel?.checkOutDate);
    const storedNightsValue =
      typeof hotel?.nights === 'number' && hotel.nights > 0 ? hotel.nights : null;
    const displayNights: number | string = stayNightsValue ?? storedNightsValue ?? '—';
    return (
      <article
        key={rowId}
        className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
          {/* Title claims the flexible space (shrinking first on narrow
              widths) so the action group below never gets pushed into a
              left-aligned wrapped row: with ml-auto it stays right. */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              aria-expanded={(expandedHotels[rowId] ?? false) ? 'true' : 'false'}
              aria-label={`${expandedHotels[rowId] ? 'Collapse' : 'Expand'} hotel stay ${index + 1}`}
              title={`${expandedHotels[rowId] ? 'Collapse' : 'Expand'} hotel stay ${index + 1}`}
              onClick={() => {
                const next = !(expandedHotels[rowId] ?? false);
                setExpandedHotels((current) => ({ ...current, [rowId]: next }));
                // The live preview follows the most recently expanded stay;
                // collapsing it releases the follow (section fallback).
                setLastExpandedHotelRowId((prev) => (next ? rowId : prev === rowId ? null : prev));
              }}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
            >
              <ChevronDown
                aria-hidden="true"
                className={`h-5 w-5 transition-transform ${expandedHotels[rowId] ? 'rotate-180' : ''}`}
              />
            </button>
            <div className="min-w-0">
              {hotel?.hotelName?.trim() ? (
                <h4 className="truncate font-semibold text-[16px] text-slate-800">{hotel.hotelName}</h4>
              ) : (
                <>
                  <h4 className="truncate font-semibold text-[16px] text-slate-800">Hotel Stay</h4>
                  <p className="text-xs text-slate-500">
                    Choose the hotel, stay dates and room details.
                  </p>
                </>
              )}
            </div>
          </div>
          {/* Compact action group that never shrinks away and always hugs
              the right edge — including on a wrapped second row (ml-auto)
              and across wrapped lines within itself (justify-end) —
              so the first card (with Add Hotel Before) aligns exactly
              like every other card. Tight gap-1.5 keeps every control
              together with no excessive spacing. No fixed widths involved. */}
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 ml-auto shrink-0">
            {allowInsertBefore && (
              <Button
                size="sm"
                variant="secondary"
                className="px-2 text-[12px]"
                aria-label={`Add hotel before stay ${index + 1}`}
                onClick={() => insertHotelBefore(index)}
              >
                Add Hotel Before
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              className="px-2 text-[12px]"
              aria-label={`Add hotel after stay ${index + 1}`}
              onClick={() => insertHotelAfter(index)}
            >
              Add Hotel After
            </Button>
            {/* Icon trio in its own tight subgroup: 2px gaps plus minimal
                side padding group Up/Down/Delete ~70% closer than the
                surrounding action spacing, without touching the Add buttons
                or the title-to-group distance. Icons stay 16px; only the
                spacing around them shrinks. */}
            <div className="flex items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              className="px-0.5 hover:bg-transparent"
              disabled={index === 0}
              aria-label={`Move hotel stay ${index + 1} up`}
              title={`Move hotel stay ${index + 1} up`}
              onClick={() => hotels.move(index, index - 1)}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="px-0.5 hover:bg-transparent"
              disabled={index === hotels.fields.length - 1}
              aria-label={`Move hotel stay ${index + 1} down`}
              title={`Move hotel stay ${index + 1} down`}
              onClick={() => hotels.move(index, index + 1)}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="px-0.5"
              aria-label={`Remove hotel stay ${index + 1}`}
              title={`Remove hotel stay ${index + 1}`}
              onClick={() => hotels.remove(index)}
            >
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
            </div>
          </div>
        </header>

        {(expandedHotels[rowId] ?? false) && (
          <>
            <div className="grid gap-5 p-4">
              <div className="space-y-5">
                <div>
                  <div className="grid gap-3">
                    <HotelMasterFields
                    canCost={canCost}
                    preferredCity={hotel?.city ?? undefined}
                    showLabels
                    hotelOnly
                    value={{
                      hotelId: hotel?.hotelId,
                      hotelRoomTypeId: hotel?.hotelRoomTypeId,
                      hotelMealPlanId: hotel?.hotelMealPlanId,
                    }}
                    roomTypeText={hotel?.roomType}
                    mealPlanText={hotel?.mealPlan}
                    hotelNameText={hotel?.hotelName}
                    onChange={(patch) => applyHotel(index, patch)}
                    onMasterSelect={(_hotelId, masterImages, name) => {
                      const snapshot = masterGallerySnapshot(masterImages, name);
                      const patch: HotelRowPatch = {
                        images: snapshot,
                        imageSnapshotPresent: Array.isArray(masterImages) ? true : undefined,
                        pdfImageUrl: snapshot[0]
                          ? quotationSnapshotImageIdentity(snapshot[0])
                          : null,
                      };
                      const master = (hotelMasters.data?.data ?? []).find(
                        (hotel) => hotel.id === _hotelId,
                      ) as unknown as {
                        price?: number | null;
                        seasons?: Array<{
                          startDate: string;
                          endDate: string;
                          price: number | null;
                        }>;
                      };
                      const masterPrice = hotelRateForDate(master, hotel?.checkInDate);
                      if (masterPrice != null && Number(masterPrice) > 0) {
                        const current = form.getValues(`hotels.${index}.sellingPrice` as never) as unknown;
                        const isEmpty =
                          current == null ||
                          current === '' ||
                          (typeof current === 'number' && current === 0) ||
                          Number(current) === 0;
                        if (isEmpty) patch.sellingPrice = Number(masterPrice);
                        // Prefill the section-wise Hotel Amount from the master
                        // price too, so the section breakdown, weblink and PDFs
                        // show it. Only when the section amount is still empty —
                        // the employee can always edit it afterwards, and it is
                        // never re-linked to the master.
                        const sectionAmount = form.getValues(
                          'hotelDetails.amount' as never,
                        ) as unknown;
                        const sectionEmpty =
                          sectionAmount == null ||
                          sectionAmount === '' ||
                          Number(sectionAmount) === 0;
                        if (sectionEmpty)
                          form.setValue('hotelDetails.amount', Number(masterPrice) as never, {
                            shouldDirty: true,
                          });
                      }
                      applyHotel(index, patch);
                      // Resolve every gallery image URL immediately so the live
                      // weblink preview shows the full multi-image gallery
                      // without saving. Merges into the current order so a
                      // delayed response never restores removed images.
                      // (Same pattern as cruise/vehicle/add-on selects; the
                      // background hydration effect remains as a safety net.)
                      if (snapshot.length > 0 && _hotelId) {
                        const selectedId = _hotelId;
                        void importMasterGalleryPreviews(selectedId, snapshot, hotelImageUrl).then(
                          (images) => {
                            if (form.getValues(`hotels.${index}.hotelId`) !== selectedId)
                              return;
                            form.setValue(
                              `hotels.${index}.images`,
                              mergeMasterGalleryPreviews(
                                form.getValues(`hotels.${index}.images`),
                                images,
                              ) as never,
                              { shouldDirty: false },
                            );
                          },
                        );
                      }
                    }}
                  />
                  </div>
                </div>

                {/*
                  Stay dates layout (heading removed): Check-in date + time
                  share the first row and Check-out date + time share the
                  second row so the date inputs stay readable. Nights and
                  Total Rooms sit underneath in a third row pair. On narrow
                  screens everything stacks in the same order.
                */}
                <div className="grid gap-3 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                  <label className="text-sm font-semibold text-slate-800">
                    Check-in date
                    <HotelDatePicker
                      value={hotel?.checkInDate ?? null}
                      onSelect={(date) => setStayDate('checkInDate', date)}
                      labels={{
                        input: 'Hotel check-in',
                        toggle: 'Open check-in calendar',
                        dialog: 'Choose check-in date',
                        clear: 'Clear check-in date',
                      }}
                      inputClassName={field}
                    />
                  </label>
                  <div>
                    <label className="text-sm font-semibold text-slate-800">
                      Check-in time
                      <input
                        {...form.register(`hotels.${index}.checkInTime`)}
                        aria-label="Hotel check-in time"
                        type="time"
                        value={hotel?.checkInTime ?? ''}
                        onChange={(event) => {
                          const time = event.target.value || null;
                          form.setValue(`hotels.${index}.checkInTime`, time, {
                            shouldDirty: true,
                          });
                          form.setValue(`hotels.${index}.showCheckInTime`, Boolean(time), {
                            shouldDirty: true,
                          });
                        }}
                        className={`${field} mt-1`}
                      />
                    </label>
                    {hotel?.checkInTime ? (
                      <button
                        type="button"
                        aria-label="Clear check-in time"
                        title="Clear check-in time"
                        onClick={() => {
                          form.setValue(`hotels.${index}.checkInTime`, null, {
                            shouldDirty: true,
                          });
                          form.setValue(`hotels.${index}.showCheckInTime`, false, {
                            shouldDirty: true,
                          });
                        }}
                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-800"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
                      </button>
                    ) : null}
                  </div>
                  <label className="text-sm font-semibold text-slate-800">
                    Check-out date
                    <HotelCheckoutDatePicker
                      checkInDate={hotel?.checkInDate ?? null}
                      checkOutDate={hotel?.checkOutDate ?? null}
                      onSelect={(date) => setStayDate('checkOutDate', date)}
                      inputClassName={field}
                    />
                  </label>
                  <div>
                    <label className="text-sm font-semibold text-slate-800">
                      Check-out time
                      <input
                        {...form.register(`hotels.${index}.checkOutTime`)}
                        aria-label="Hotel check-out time"
                        type="time"
                        value={hotel?.checkOutTime ?? ''}
                        onChange={(event) => {
                          const time = event.target.value || null;
                          form.setValue(`hotels.${index}.checkOutTime`, time, {
                            shouldDirty: true,
                          });
                          form.setValue(`hotels.${index}.showCheckOutTime`, Boolean(time), {
                            shouldDirty: true,
                          });
                        }}
                        className={`${field} mt-1`}
                      />
                    </label>
                    {hotel?.checkOutTime ? (
                      <button
                        type="button"
                        aria-label="Clear check-out time"
                        title="Clear check-out time"
                        onClick={() => {
                          form.setValue(`hotels.${index}.checkOutTime`, null, {
                            shouldDirty: true,
                          });
                          form.setValue(`hotels.${index}.showCheckOutTime`, false, {
                            shouldDirty: true,
                          });
                        }}
                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-800"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
                      </button>
                    ) : null}
                  </div>
                  <label className="text-sm font-semibold text-slate-800">
                    <span className={calculatedLabel}>Nights</span>
                    <input
                      aria-label="Hotel nights"
                      readOnly
                      value={String(displayNights)}
                      className={`${fieldMuted} mt-1`}
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-800">
                    <span className={calculatedLabel}>Total Rooms</span>
                    <input
                      aria-label="Hotel total rooms"
                      type="number"
                      min={1}
                      max={100}
                      value={resolveHotelRooms(rowId, hotel).value ?? ''}
                      onChange={(event) => {
                        const raw = event.target.value;
                        const parsed = Math.floor(Number(raw));
                        const override =
                          raw.trim() === '' || !Number.isFinite(parsed) ? null : parsed;
                        if (rowId !== undefined) {
                          if (override === null) hotelRoomsTypingRef.current.add(rowId);
                          else hotelRoomsTypingRef.current.delete(rowId);
                        }
                        form.setValue(`hotels.${index}.roomsOverride`, override, {
                          shouldDirty: true,
                        });
                        form.setValue(`hotels.${index}.rooms`, override, {
                          shouldDirty: true,
                        });
                      }}
                      onBlur={() => {
                        // Abandoned clear (nothing stored, nothing typed):
                        // drop the editing session so automatic mode resumes.
                        if (
                          rowId !== undefined &&
                          roomsOverrideOf(hotel) === null &&
                          typeof hotel?.rooms !== 'number'
                        ) {
                          hotelRoomsTypingRef.current.delete(rowId);
                        }
                      }}
                      className={`${field} mt-1`}
                    />
                    {resolveHotelRooms(rowId, hotel).manual ? (
                      <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>manual override</span>
                        <button
                          type="button"
                          aria-label="Reset total rooms to calculated total"
                          className="font-medium text-brand-600 underline decoration-brand-300 underline-offset-2 hover:text-brand-700"
                          onClick={() => {
                            if (rowId !== undefined) hotelRoomsTypingRef.current.delete(rowId);
                            form.setValue(`hotels.${index}.roomsOverride`, null, {
                              shouldDirty: true,
                            });
                            form.setValue(
                              `hotels.${index}.rooms`,
                              hotelRoomLinesTotalRooms(hotel),
                              { shouldDirty: true },
                            );
                          }}
                        >
                          Reset to calculated total
                          {hotelRoomLinesTotalRooms(hotel) != null
                            ? ` (${hotelRoomLinesTotalRooms(hotel)})`
                            : ''}
                        </button>
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">sum of room allocations</span>
                    )}
                  </label>
                </div>

                <div>
                  <HotelRoomLinesEditor
                    form={form}
                    hotelIndex={index}
                    hotelId={hotel?.hotelId}
                    canCost={canCost}
                    recalculateTotals={() => recalculateHotelTotals(index)}
                  />
                </div>

                <div>
                  <HotelMealPlanLinesEditor
                    form={form}
                    hotelIndex={index}
                    hotelId={hotel?.hotelId}
                    canCost={canCost}
                    recalculateTotals={() => recalculateHotelTotals(index)}
                  />
                </div>

                {hotel &&
                  (hotel.roomLines ?? []).some(
                    (line) => line?.baseRoomPrice != null || line?.extraBedPrice != null || line?.childWithoutBedPrice != null,
                  ) && (
                  <div className={`${calculatedCard} text-sm`}>
                    <h5 className={`${calculatedLabel} text-slate-800`}>Accommodation Breakdown</h5>
                    <ul className="mt-2 space-y-1 text-muted-foreground">
                      {(hotel.roomLines ?? []).map((line, lineIndex) => {
                        if (line?.baseRoomPrice == null && line?.extraBedPrice == null && line?.childWithoutBedPrice == null)
                          return null;
                        const lineNights = hotel.nights ?? displayNights;
                        return (
                          <li key={lineIndex}>
                            Room {lineIndex + 1}
                            {line?.roomType ? ` (${line.roomType})` : ''}:{' '}
                            {line?.baseRoomPrice != null
                              ? `Base Room: ${line.baseRoomPrice} × ${lineNights} nights${line?.rooms ? ` × ${line.rooms} rooms` : ''}`
                              : '—'}
                            {line?.extraBedPrice != null && line?.extraBedQuantity != null
                              ? ` · Extra Bed: ${line.extraBedPrice} × ${line.extraBedQuantity} × ${lineNights} nights`
                              : ''}
                            {line?.childWithoutBedPrice != null && line?.childWithoutBedQuantity != null
                              ? ` · Child Without Bed: ${line.childWithoutBedPrice} × ${line.childWithoutBedQuantity} × ${lineNights} nights`
                              : ''}
                          </li>
                        );
                      })}
                      {hotel.pricingSource && (
                        <li className="text-xs text-slate-500">Pricing: {hotel.pricingSource}</li>
                      )}
                    </ul>
                  </div>
                )}

              </div>
            </div>

            <QuotationImageManager
              label="Hotel Images"
              ariaPrefix={`hotel-${index}`}
              images={(hotel?.images ?? []) as QuotationImage[]}
              pdfImageUrl={hotel?.pdfImageUrl}
              onMove={(imageIndex, direction) => moveHotelImage(index, imageIndex, direction)}
              onRemove={(imageIndex) => removeHotelImage(index, imageIndex)}
              onSelectPdf={(identity) => setHotelPdfImage(index, identity)}
            />
          </>
        )}
      </article>
    );
  };

  /**
   * Reference Cruise tab: Include checkbox, section Title + Amount, then one
   * labelled card per cruise entry (Name, Duration, Room Type, Description).
   * Multiple cruises remain supported; each row is its own card.
   */
  const cruiseTab = () => {
    const cruiseRows = services.fields
      .map((row, index) => ({ row, index }))
      .filter(({ index }) => watchedServices?.[index]?.serviceType === 'CRUISE');
    const masters = cruiseMasters.data?.data ?? [];
    const primaryIndex = cruiseRows[0]?.index;
    const primary = primaryIndex !== undefined ? watchedServices?.[primaryIndex] : undefined;
    const isCruiseSectionWise = (form.watch('pricingMode') as string) === 'SECTION_WISE';
    return (
      <div className="space-y-5">
        <IncludeBar tabKey="cruise" label="Cruise" />
        {isIncluded('cruise') && (
          <>
            {primaryIndex !== undefined && (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-800">
                  Section Title
                  <input
                    aria-label="Cruise section title"
                    maxLength={80}
                    value={primary?.taxCategory ?? ''}
                    onChange={(event) =>
                      applyService(primaryIndex, { taxCategory: event.target.value || null })
                    }
                    className={`${field} mt-1`}
                  />
                </label>
              </div>
            )}
            {isCruiseSectionWise && primary && (() => {
              const total = cruiseRows.reduce((sum, { index: idx }) => {
                const svc = watchedServices?.[idx] as unknown as { cruiseNights?: number | null } | undefined;
                // Null nights flow into the shared helper, which totals
                // rate × rooms without a nights multiplier (never NaN).
                const nights = (svc as unknown as { cruiseNights?: number | null })?.cruiseNights ?? null;
                return sum + calculateCruiseRoomLinesTotal(watchedServices?.[idx] ?? {}, nights);
              }, 0);
              return <div className={`${calculatedCard} flex items-center justify-between`}><span className={calculatedLabel}>Cruise Total</span><span className={calculatedValue}>{formatMoney(total)} {cruiseRows.length>1 ? `· ${cruiseRows.length} cruises` : ''}</span></div>;
            })()}

            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => services.append(newCruiseServiceRow(services.fields.length + 1))}
              >
                <Plus className="h-4 w-4" /> Add Cruise
              </Button>
            </div>

            {cruiseRows.length === 0 && (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">
                No cruise added yet. Add the first cruise below.
              </p>
            )}

            <div className="space-y-4">
              {cruiseRows.map(({ row, index }, cruisePosition) => {
                const cruise = watchedServices?.[index] as unknown as QuotationVersionInput['services'][number] | undefined;
                // Every cruise card starts collapsed; state is keyed by row id.
                const isCruiseExpanded = expandedCruises[row.id] ?? false;
                const isFirstCruise = cruisePosition === 0;
                const isLastCruise = cruisePosition === cruiseRows.length - 1;
                // Move up/down by one cruise position, preserving each row's data.
                const moveCruise = (direction: -1 | 1) => {
                  const target = cruiseRows[cruisePosition + direction];
                  if (target) services.move(index, target.index);
                };
                return (
                  <article
                    key={row.id}
                    className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
                  >
                    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <button
                          type="button"
                          aria-expanded={isCruiseExpanded ? 'true' : 'false'}
                          aria-label={`${isCruiseExpanded ? 'Collapse' : 'Expand'} cruise stay ${cruisePosition + 1}`}
                          title={`${isCruiseExpanded ? 'Collapse' : 'Expand'} cruise stay ${cruisePosition + 1}`}
                          onClick={() =>
                            setExpandedCruises((current) => ({
                              ...current,
                              [row.id]: !isCruiseExpanded,
                            }))
                          }
                          className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                        >
                          <ChevronDown
                            aria-hidden="true"
                            className={`h-5 w-5 transition-transform ${isCruiseExpanded ? 'rotate-180' : ''}`}
                          />
                        </button>
                        <div className="min-w-0">
                          <h4 className="truncate font-semibold text-[16px] text-slate-800">
                            {cruise?.name?.trim() || 'Cruise Stay'}
                          </h4>
                        </div>
                      </div>
                      {/* Icon trio matching the hotel stay header: Up, Down and
                          an icon-only Delete carrying its own accessible label. */}
                      <div className="flex items-center gap-0.5 shrink-0 ml-auto">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="px-0.5 hover:bg-transparent"
                          disabled={isFirstCruise}
                          aria-label={`Move cruise stay ${cruisePosition + 1} up`}
                          title={`Move cruise stay ${cruisePosition + 1} up`}
                          onClick={() => moveCruise(-1)}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="px-0.5 hover:bg-transparent"
                          disabled={isLastCruise}
                          aria-label={`Move cruise stay ${cruisePosition + 1} down`}
                          title={`Move cruise stay ${cruisePosition + 1} down`}
                          onClick={() => moveCruise(1)}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="px-0.5"
                          aria-label={`Remove cruise stay ${cruisePosition + 1}`}
                          title={`Remove cruise stay ${cruisePosition + 1}`}
                          onClick={() => services.remove(index)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </header>
                    {isCruiseExpanded && (
                      <>
                        <div className="space-y-4 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="text-sm font-semibold text-slate-800">
                          Cruise Name <span className="text-red-500">*</span>
                          <div className="mt-1">
                            <MasterSelect
                              ariaLabel="Cruise master"
                              placeholder="Link a cruise"
                              options={masters.map((m) => ({ id: m.id, label: m.name }))}
                              value={cruise?.cruiseId}
                              loading={cruiseMasters.isPending}
                              fallbackLabel={masters.find((m) => m.id === cruise?.cruiseId)?.name}
                              onSelect={(option) => {
                                const selectedMaster = masters.find(
                                  (master) => master.id === option?.id,
                                );
                                const snapshot = masterGallerySnapshot(
                                  selectedMaster?.images,
                                  selectedMaster?.name ?? 'Cruise',
                                );
                                // Changing cruise revalidates rooms: clear invalid room lines
                                cruisePriceOverridesRef.current.delete(index);
                                // Nights are optional: preserve whatever is set
                                // (including empty), never backfill a default.
                                const currentNights = (cruise as unknown as { cruiseNights?: number | null })?.cruiseNights ?? null;
                                applyService(index, {
                                  cruiseId: option?.id ?? null,
                                  // Keep cruiseNights, reset room lines if cruise changed.
                                  // Rooms are never auto-created here: switching
                                  // the cruise clears stale lines back to zero
                                  // rows; the user adds rooms explicitly.
                                  ...(option?.id
                                    ? {
                                        cruiseRoomTypeId: null,
                                        city: null,
                                        sellingPrice: 0,
                                        quantity: 1,
                                        cruiseNights: currentNights,
                                        cruiseRoomLines: [],
                                      }
                                    : {
                                        cruiseRoomTypeId: null,
                                        city: null,
                                        sellingPrice: 0,
                                        quantity: 1,
                                        cruiseNights: null,
                                        cruiseRoomLines: [],
                                      }),
                                  description: selectedMaster?.description ?? null,
                                  images: snapshot,
                                  imageSnapshotPresent: masterGalleryPresence(selectedMaster),
                                  pdfImageUrl: snapshot[0]
                                    ? quotationSnapshotImageIdentity(snapshot[0])
                                    : null,
                                  ...(option ? { name: option.label } : { name: '' }),
                                } as unknown as ServiceRowPatch);
                                if (selectedMaster)
                                  void importMasterGalleryPreviews(
                                    selectedMaster.id,
                                    snapshot,
                                    cruiseImageUrl,
                                  ).then((images) => {
                                    if (
                                      form.getValues(`services.${index}.cruiseId`) !==
                                      selectedMaster.id
                                    )
                                      return;
                                    applyService(index, {
                                      images: mergeMasterGalleryPreviews(
                                        form.getValues(`services.${index}.images`),
                                        images,
                                      ),
                                    });
                                  });
                              }}
                            />
                          </div>
                        </label>
                        <label className="text-sm font-semibold text-slate-800">
                          Number of Nights
                          <input
                            aria-label="Cruise nights"
                            type="number"
                            min={1}
                            max={365}
                            step={1}
                            value={(cruise as unknown as { cruiseNights?: number | null })?.cruiseNights ?? ''}
                            onChange={(event) => {
                              const raw = event.target.value;
                              // Clearing the field stores null (stays empty through
                              // save/reload); a typed value is clamped to 1–365.
                              const nights =
                                raw === ''
                                  ? null
                                  : Math.max(1, Math.min(365, Math.floor(Number(raw) || 1)));
                              applyService(index, { cruiseNights: nights } as unknown as ServiceRowPatch);
                            }}
                            className={`${field} mt-1`}
                          />
                        </label>
                      </div>
                      <CruiseRoomLinesEditor
                        form={form}
                        serviceIndex={index}
                        cruiseId={cruise?.cruiseId}
                        canCost={canCost}
                        // Display-only preview multiplier; unknown nights fall
                        // back to 1 (rate × rooms), matching the shared pricing
                        // fallback. The stored value itself stays null.
                        nights={Number((cruise as unknown as { cruiseNights?: number | null })?.cruiseNights ?? 1)}
                        recalculateTotals={() => {}}
                      />
                      <label className="block text-sm font-semibold text-slate-800">
                        Description
                        <div className="mt-1">
                          <RichTextEditor
                            ariaLabel="Cruise description"
                            value={cruise?.description ?? ''}
                            onChange={(html) => applyService(index, { description: html || null })}
                          />
                        </div>
                      </label>
                    </div>
                    <QuotationImageManager
                      label="Cruise Images"
                      ariaPrefix={`cruise-${index}`}
                      images={(cruise?.images ?? []) as QuotationImage[]}
                      pdfImageUrl={cruise?.pdfImageUrl}
                      onMove={(imageIndex, direction) =>
                        moveServiceImage(index, imageIndex, direction)
                      }
                      onRemove={(imageIndex) => removeServiceImage(index, imageIndex)}
                      onSelectPdf={(identity) => setServicePdfImage(index, identity)}
                    />
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  /**
   * The Flight tab (reference layout): a section title + amount, a journey type,
   * and Outbound / Return journeys, each a route selector plus one or more
   * segments (connections). Stored as structured JSON on `flightDetails`.
   */
  const flightSection = () => {
    const fp = (path: string) => path as FieldPath<QuotationVersionInput>;
    const currency = form.watch('currency');
    const include = form.watch('flightDetails.include') ?? true;
    const entryMode = form.watch('flightDetails.entryMode') ?? 'MANUAL';
    const flightPricingBasis =
      (form.watch('flightDetails.pricingBasis') as 'FIXED_TOTAL' | 'PER_TRAVELER' | undefined) ??
      'FIXED_TOTAL';
    const flightSectionTotal = calculateFlightTotal(form.watch('flightDetails'), {
      adults: pax.adults,
      childrenWithBed: pax.cwb,
      childrenWithoutBed: pax.cwob,
      infants: pax.infants,
    });
    const isFlightSectionWise = (form.watch('pricingMode') as string) === 'SECTION_WISE';
    const flightImages = form.watch('flightDetails.images') ?? [];
    const airlineList = airlines.data?.data ?? [];

    /**
     * Import saved flight bookmarks into the quotation form (DB only). The
     * first bookmark fills the card it was loaded from; any additional IDs
     * pasted into the same input append further independent flight records.
     * Previously loaded flights are never overwritten. Each segment's airline
     * is matched against the Airline Master and created automatically when
     * missing, so the Airline dropdown is never left blank.
     */
    const importFlightBookmarks = async (flightIndex: number, bookmarks: LiveSearchBookmark[]) => {
      const [first, ...rest] = bookmarks;
      if (!first) return;
      const toRecord = (bookmark: LiveSearchBookmark): FlightRecordInput => {
        const details = flightBookmarkToDetails(bookmark);
        return {
          bookmarkCode: bookmark.bookmarkCode,
          journeyType: details.journeyType,
          outbound: details.outbound,
          returnJourney: details.returnJourney,
        };
      };
      const records = [...((form.getValues('flightDetails.flights') ?? []) as FlightRecordInput[])];
      records[flightIndex] = toRecord(first);
      for (const bookmark of rest) records.push(toRecord(bookmark));
      flightRecords.replace(records as never[]);
      if (first.currency) form.setValue('currency', first.currency, { shouldDirty: true });

      const refs = bookmarks.flatMap((bookmark, position) => {
        const targetIndex = position === 0 ? flightIndex : records.length - rest.length + position - 1;
        return flightBookmarkSegmentAirlines(bookmark).map((ref) => ({ ...ref, flightIndex: targetIndex }));
      });
      if (refs.length === 0) return;
      try {
        const resolved = await resolveFlightSegmentAirlines(refs, {
          airlines: airlineList,
          createAirline: (input) => createAirline.mutateAsync(input),
          canManageMedia: canManageAirlineMedia,
          // Ensure dropdown options include any just-created airline immediately,
          // without waiting for the server list to refetch.
          onAirlineCreated: (airline) => {
            queryClient.setQueriesData<Page<Airline>>(
              { queryKey: ['masters', 'airlines'] },
              (current) => {
                if (!current || !Array.isArray(current.data)) return current;
                if (current.data.some((row) => row.id === airline.id)) return current;
                return { ...current, data: [...current.data, airline] };
              },
            );
          },
        });
        for (const ref of refs) {
          const key = normalizeAirlineName(ref.name ?? '');
          const airline = resolved.get(key);
          if (!airline?.airlineId) continue;
          const path = `flightDetails.flights.${ref.flightIndex}.${ref.leg}.segments.${ref.segmentIndex}`;
          form.setValue(fp(`${path}.airlineId`), airline.airlineId as never, { shouldDirty: true });
          form.setValue(fp(`${path}.airlineName`), (airline.airlineName ?? ref.name) as never, {
            shouldDirty: true,
          });
        }
      } catch {
        // Airline auto-resolution is best-effort; the bookmark itself already
        // loaded the flight details (including the airline name as text).
      }
    };

    return (
      <div className="space-y-5">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <input type="checkbox" {...form.register('flightDetails.include')} />
          Include Flight in Quotation
        </label>
        {include && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold text-slate-800">
                Section Title
                <input
                  aria-label="Flight section title"
                  placeholder="Flight Details"
                  className={`${field} mt-1`}
                  {...form.register('flightDetails.sectionTitle')}
                />
              </label>
              {isFlightSectionWise && (
              <div>
                <span className="text-sm font-semibold text-slate-800">Pricing Basis</span>
                <div
                  role="radiogroup"
                  aria-label="Flight pricing basis"
                  className="mt-1 grid max-w-md grid-cols-2 rounded-lg border border-slate-300 bg-slate-50 p-1"
                >
                  {(
                    [
                      ['FIXED_TOTAL', 'Fixed Total'],
                      ['PER_TRAVELER', 'Per Traveler'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={flightPricingBasis === value}
                      className={cn(
                        'rounded-md px-4 py-2 text-sm font-semibold transition',
                        flightPricingBasis === value
                          ? 'bg-white text-brand-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-800',
                      )}
                      onClick={() =>
                        form.setValue('flightDetails.pricingBasis', value, { shouldDirty: true })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Only the selected pricing basis contributes to the quotation total.
                </p>
              </div>
              )}
            </div>
            {isFlightSectionWise && (flightPricingBasis === 'PER_TRAVELER' ? (
              <div className="rounded-xl border p-4">
                <p className="text-sm font-semibold text-slate-800">Per-Traveler Flight Rates</p>
                <div className="mt-3 grid gap-4 md:grid-cols-4">
                  {(
                    [
                      ['Adult Rate', 'flightDetails.perTraveler.adult'],
                      ['CWB Rate', 'flightDetails.perTraveler.childWithBed'],
                      ['CWOB Rate', 'flightDetails.perTraveler.childWithoutBed'],
                      ['Infant Rate', 'flightDetails.perTraveler.infant'],
                    ] as const
                  ).map(([label, name]) => (
                    <label key={name} className="text-sm font-semibold text-slate-800">
                      {label}
                      <div className="mt-1 flex items-stretch overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand-500">
                        <span className="flex items-center bg-slate-100 px-2 text-slate-500">
                          {currency}
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          aria-label={label}
                          className="min-w-0 flex-1 bg-card px-3 py-2 text-sm outline-none"
                          {...form.register(name as never, MONEY_FIELD)}
                        />
                      </div>
                    </label>
                  ))}
                </div>
                <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm text-slate-600">
                  {(
                    [
                      ['Adult', pax.adults, Number(form.watch('flightDetails.perTraveler.adult') ?? 0)],
                      ['CWB', pax.cwb, Number(form.watch('flightDetails.perTraveler.childWithBed') ?? 0)],
                      ['CWOB', pax.cwob, Number(form.watch('flightDetails.perTraveler.childWithoutBed') ?? 0)],
                      ['Infant', pax.infants, Number(form.watch('flightDetails.perTraveler.infant') ?? 0)],
                    ] as const
                  )
                    .filter(([, count, rate]) => count > 0 && rate > 0)
                    .map(([label, count, rate]) => (
                      <div key={label} className="flex justify-between">
                        <span>
                          {label}: {count} × {formatMoney(rate)}
                        </span>
                        <span className="font-medium">{formatMoney(rate * count)}</span>
                      </div>
                    ))}
                  <div className="flex justify-between border-t border-slate-100 pt-1 font-semibold text-slate-800">
                    <span>Flight Total</span>
                    <span>{formatMoney(flightSectionTotal)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <label className="block max-w-sm text-sm font-semibold text-slate-800">
                Flight Selling Price
                <div className="mt-1 flex items-stretch overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand-500">
                  <span className="flex items-center bg-slate-100 px-2 text-slate-500">
                    {currency}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    aria-label="Flight amount"
                    className="min-w-0 flex-1 bg-card px-3 py-2 text-sm outline-none"
                    {...form.register('flightDetails.amount', MONEY_FIELD)}
                  />
                </div>
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Total selling price for the whole flight section.
                </span>
              </label>
            ))}
            {isFlightSectionWise && <div className={`${calculatedCard} flex items-center justify-between`}><span className={calculatedLabel}>Flight Section Total</span><span className={calculatedValue}>{formatMoney(flightSectionTotal)}</span></div>}

            <div>
              <div
                role="radiogroup"
                aria-label="Flight information mode"
                className="grid w-full max-w-md grid-cols-2 gap-1 rounded-[20px] border border-slate-200 bg-white p-1"
              >
                {(
                  [
                    ['MANUAL', 'Fill details'],
                    ['IMAGE', 'Upload image'],
                  ] as const
                ).map(([value, label]) => {
                  const selected = entryMode === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={cn(
                        'flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-[14px] px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60',
                        selected
                          ? 'bg-brand-600 text-white'
                          : 'bg-white text-slate-700 hover:bg-slate-50',
                      )}
                      onClick={() =>
                        form.setValue('flightDetails.entryMode', value, { shouldDirty: true })
                      }
                    >
                      {value === 'IMAGE' ? (
                        <Upload
                          className={cn('h-4 w-4', selected ? 'text-white' : 'text-slate-400')}
                        />
                      ) : null}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {entryMode === 'IMAGE' && (
              <div className="space-y-4 rounded-xl border border-dashed border-brand-300 bg-brand-50/40 p-5">
                <div className="grid gap-4 md:grid-cols-2">
                  {flightImages.map((image, index) => (
                    <div
                      key={image.documentId}
                      className="w-full rounded-lg border bg-white p-3 shadow-sm"
                    >
                      {flightImagePreviewUrls[image.documentId] && (
                        <img
                          src={flightImagePreviewUrls[image.documentId]}
                          alt={`Uploaded flight itinerary ${index + 1}`}
                          className="block h-auto w-full rounded-md"
                        />
                      )}
                      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                        <label className="text-sm font-semibold text-slate-700">
                          Description <span className="font-normal text-slate-400">(optional)</span>
                          <input
                            aria-label={`Flight image ${index + 1} description`}
                            placeholder="e.g. Outbound flight ticket"
                            className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"
                            {...form.register(`flightDetails.images.${index}.description`)}
                          />
                        </label>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            form.setValue(
                              'flightDetails.images',
                              flightImages.filter((_, imageIndex) => imageIndex !== index),
                              { shouldDirty: true, shouldValidate: true },
                            );
                            setFlightImagePreviewUrls((current) => {
                              const next = { ...current };
                              delete next[image.documentId];
                              return next;
                            });
                            setFlightImageError('');
                          }}
                        >
                          <X className="h-4 w-4" /> Remove
                        </Button>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {image.fileName || 'Flight image'}
                      </p>
                    </div>
                  ))}
                </div>
                {flightImages.length < 10 && (
                  <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg bg-white px-6 py-8 text-center shadow-sm">
                    <ImageIcon className="h-9 w-9 text-brand-600" />
                    <span className="font-semibold text-slate-800">
                      {flightImages.length
                        ? 'Add another flight image'
                        : 'Upload flight screenshot'}
                    </span>
                    <span className="text-xs text-slate-500">
                      Choose, drop, or paste · PNG, JPG or WebP
                    </span>
                    <input
                      type="file"
                      aria-label="Flight image"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      disabled={flightImageUploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (!file) return;
                        setFlightImageError('');
                        setFlightImageUploading(true);
                        void uploadQuotationAttachment(quotationId, file, versionId)
                          .then(({ documentId, url }) => {
                            form.setValue(
                              'flightDetails.images',
                              [
                                ...flightImages,
                                {
                                  documentId,
                                  fileName: file.name,
                                  description: null,
                                  heading: null,
                                },
                              ],
                              { shouldDirty: true, shouldValidate: true },
                            );
                            form.setValue('flightDetails.imageDocumentId', null, {
                              shouldDirty: true,
                            });
                            form.setValue('flightDetails.imageFileName', null, {
                              shouldDirty: true,
                            });
                            setFlightImagePreviewUrls((current) => ({
                              ...current,
                              [documentId]: url,
                            }));
                          })
                          .catch((error: unknown) =>
                            setFlightImageError(
                              error instanceof Error
                                ? error.message
                                : 'The flight image upload failed.',
                            ),
                          )
                          .finally(() => setFlightImageUploading(false));
                      }}
                    />
                    <span className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
                      {flightImageUploading ? 'Uploading…' : 'Choose image'}
                    </span>
                  </label>
                )}
                {flightImageError && (
                  <p role="alert" className="mt-3 text-sm font-medium text-red-600">
                    {flightImageError}
                  </p>
                )}
              </div>
            )}

            {entryMode === 'MANUAL' && (
              <>
                {flightRecords.fields.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 text-center">
                    <p className="text-sm text-muted-foreground">
                      No flights yet. Add the first one below, or load it from a bookmark ID.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-3"
                      onClick={() => flightRecords.append(emptyFlightRecord())}
                    >
                      <Plus className="h-4 w-4" /> Add Flight
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {flightRecords.fields.map((fieldRow, index) => (
                      <FlightRecordCard
                        key={fieldRow.id}
                        flightIndex={index}
                        form={form}
                        airlineList={airlineList}
                        onLoadBookmarks={importFlightBookmarks}
                        onRemoveFlight={(removeIndex) => {
                          // Keep the followed flight pointing at the same
                          // record (or release it when removed).
                          setActiveFlightIndex((prev) =>
                            prev == null || prev === removeIndex
                              ? null
                              : prev > removeIndex
                                ? prev - 1
                                : prev,
                          );
                          flightRecords.remove(removeIndex);
                        }}
                        onExpandChange={(expandedIndex, expanded) =>
                          setActiveFlightIndex((prev) =>
                            expanded ? expandedIndex : prev === expandedIndex ? null : prev,
                          )
                        }
                      />
                    ))}
                    <div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => flightRecords.append(emptyFlightRecord())}
                      >
                        <Plus className="h-4 w-4" /> Add Flight
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    );
  };

  /**
   * The Add-on Services tab is a master-driven include-table (reference layout):
   * every active add-on master is a row you toggle into the quotation. Including
   * one appends an OTHER_ADD_ON service carrying its name, description and price,
   * which the caller can then edit per-quotation.
   */
  const addonTable = () => {
    const masters = addOnMasters.data?.data ?? [];
    const includedIndex = (id: string) =>
      (watchedServices ?? []).findIndex((row) => row?.addOnServiceId === id);
    const totalPax = pax.adults + pax.cwb + pax.cwob + pax.infants;
    const total = masters.reduce((sum, master) => {
      const index = includedIndex(master.id);
      const row = index >= 0 ? watchedServices?.[index] : undefined;
      return row
        ? sum + Number(row.sellingPrice ?? 0) * (Number(row.quantity ?? 1) || 1)
        : sum;
    }, 0);
    const currency = form.watch('currency');
    const ADDON_BASES: Array<[string, string]> = [
      ['FIXED', 'Fixed'],
      ['PER_TRAVELER', 'Per Traveler'],
      ['PER_DAY', 'Per Day'],
      ['PER_TRANSFER', 'Per Transfer'],
      ['PER_UNIT', 'Per Unit'],
    ];
     const toggle = (master: (typeof masters)[number], checked: boolean) => {
      if (checked) {
        const newIndex = services.fields.length;
        const snapshot = masterGallerySnapshot(master.images, master.name);
        services.append(
          mapMasterToAddonRow(
            master as unknown as PrefillAddOnMaster,
            services.fields.length + 1,
          ) as never,
        );
        if (master?.images?.length)
          void importMasterGalleryPreviews(master.id, snapshot, addOnServiceImageUrl).then(
            (images) => {
              if (form.getValues(`services.${newIndex}.addOnServiceId`) !== master.id) return;
              form.setValue(
                `services.${newIndex}.images`,
                mergeMasterGalleryPreviews(
                  form.getValues(`services.${newIndex}.images`),
                  images,
                ) as never,
                { shouldDirty: true },
              );
            },
          );
      } else {
        const index = includedIndex(master.id);
        if (index >= 0) {
          // Explicit user removal: never re-add this default automatically
          // for the loaded version (until the version itself changes).
          dismissedAddonsRef.current.ids.add(master.id);
          services.remove(index);
        }
      }
    };
    const isAddonSectionWise = (form.watch('pricingMode') as string) === 'SECTION_WISE';
    // Quotation-owned pricing options for one row: a saved snapshot wins,
    // otherwise fall back to the master's options (a legacy single price
    // normalizes to one option). Editing these never touches the master.
    const pricingOptionsFor = (index: number, master: (typeof masters)[number]) => {
      // A saved snapshot (even an explicitly emptied one) is authoritative;
      // only a legacy row with NO snapshot falls back to the master's options.
      // Falling back on an empty array would re-synthesize a deleted option
      // from the legacy single price/basis.
      const saved = watchedServices?.[index]?.pricingSnapshot;
      const hasSnapshot = Array.isArray(saved);
      return normalizeAddonPricingSnapshot({
        id: master.id,
        pricing: hasSnapshot ? saved : master.pricing,
        price: hasSnapshot ? null : master.price,
        currency: master.currency,
        pricingBasis: hasSnapshot ? null : master.pricingBasis,
      });
    };
    // Persist a quotation-specific edit (label/amount) to one pricing option by
    // writing the whole price list back, materializing a snapshot when needed.
    const updatePricingOption = (
      index: number,
      options: AddOnServicePricingEntry[],
      optionIndex: number,
      patch: Partial<AddOnServicePricingEntry>,
    ) => {
      const next = options.map((entry, i) => (i === optionIndex ? { ...entry, ...patch } : entry));
      form.setValue(
        `services.${index}.pricingSnapshot` as 'services.0.pricingSnapshot',
        next as never,
        { shouldDirty: true },
      );
    };
    // Delete one pricing option for THIS quotation only. The master record is
    // never touched; writing the shortened list (possibly empty) marks the
    // snapshot as quotation-owned so removed defaults never come back on reload.
    const removePricingOption = (
      index: number,
      options: AddOnServicePricingEntry[],
      optionIndex: number,
    ) => {
      const next = options.filter((_, i) => i !== optionIndex);
      form.setValue(
        `services.${index}.pricingSnapshot` as 'services.0.pricingSnapshot',
        next as never,
        { shouldDirty: true },
      );
    };
    // Append a brand-new quotation-owned pricing option (blank label/price) to
    // THIS quotation only. Writing the snapshot materializes it as authoritative
    // so the master record and every other quotation stay untouched.
    const addPricingOption = (index: number, options: AddOnServicePricingEntry[]) => {
      if (options.length >= MAX_ADD_ON_PRICING_ENTRIES) return;
      const next = [
        ...options,
        { id: crypto.randomUUID(), label: '', price: null, currency },
      ];
      form.setValue(
        `services.${index}.pricingSnapshot` as 'services.0.pricingSnapshot',
        next as never,
        { shouldDirty: true },
      );
    };
    return (
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.watch('addOnDetails.include') !== false}
            onChange={(event) =>
              form.setValue('addOnDetails.include', event.target.checked, { shouldDirty: true })
            }
          />
          Include Add-on Services in Quotation
        </label>
        {form.watch('addOnDetails.include') !== false && (
          <>
            {masters.length === 0 ? (
              <p className="rounded-lg border px-4 py-8 text-center text-slate-500">
                {addOnMasters.isPending
                  ? 'Loading add-on services…'
                  : 'No add-on services in the master list yet.'}
              </p>
            ) : (
              <div className="min-w-0 space-y-4">
                {masters.map((master) => {
                  const index = includedIndex(master.id);
                  const included = index >= 0;
                  const options = included ? pricingOptionsFor(index, master) : [];
                  return (
                    <article
                      key={master.id}
                      className="min-w-0 rounded-xl border border-border bg-card p-4"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-3">
                        <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            aria-label={`Include ${master.name}`}
                            checked={included}
                            onChange={(event) => toggle(master, event.target.checked)}
                          />
                          Include
                        </label>
                        <div className="min-w-0 flex-1">
                          {included ? (
                            <input
                              type="text"
                              maxLength={200}
                              aria-label={`${master.name} service name`}
                              placeholder="Service name / display label"
                              value={((watchedServices?.[index]?.name as string) ?? '') || ''}
                              onChange={(event) =>
                                form.setValue(
                                  `services.${index}.name` as 'services.0.name',
                                  event.target.value as never,
                                  { shouldDirty: true },
                                )
                              }
                              className={`${field} min-w-0`}
                            />
                          ) : (
                            <p className="min-w-0 [overflow-wrap:anywhere] font-medium text-slate-800">
                              {master.name}
                            </p>
                          )}
                        </div>
                      </div>
                      {included ? (
                        <div className="mt-4 min-w-0 space-y-4">
                          <div className="min-w-0">
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Description
                            </p>
                            <RichTextEditor
                              ariaLabel={`${master.name} description`}
                              value={(watchedServices?.[index]?.description as string) ?? ''}
                              onChange={(html) =>
                                form.setValue(
                                  `services.${index}.description` as 'services.0.description',
                                  html as never,
                                  { shouldDirty: true },
                                )
                              }
                              placeholder="Describe this add-on for the customer…"
                            />
                          </div>
                          {options.length > 0 && (
                            <div className="min-w-0">
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Pricing options
                              </p>
                              <div className="space-y-2">
                                {options.map((option, optionIndex) => (
                                  <div
                                    key={option.id}
                                    className="flex min-w-0 flex-wrap items-center gap-2"
                                  >
                                    <input
                                      type="text"
                                      maxLength={80}
                                      aria-label={`${master.name} pricing option ${optionIndex + 1} label`}
                                      placeholder="Label"
                                      value={option.label ?? ''}
                                      onChange={(event) =>
                                        updatePricingOption(index, options, optionIndex, {
                                          label: event.target.value,
                                        })
                                      }
                                      className={`${field} min-w-0 flex-1`}
                                    />
                                    <div className="flex shrink-0 items-stretch overflow-hidden rounded-lg border border-slate-300">
                                      <span className="flex items-center bg-slate-100 px-2 text-xs text-slate-500">
                                        {option.currency || currency}
                                      </span>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        aria-label={`${master.name} pricing option ${optionIndex + 1} amount`}
                                        value={option.price ?? ''}
                                        onChange={(event) =>
                                          updatePricingOption(index, options, optionIndex, {
                                            price:
                                              event.target.value === ''
                                                ? null
                                                : Math.max(0, Number(event.target.value)),
                                          })
                                        }
                                        className="w-28 min-w-0 bg-card px-3 py-2 text-sm outline-none"
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      aria-label={`Remove ${master.name} pricing option ${optionIndex + 1}`}
                                      title="Delete this pricing option"
                                      onClick={() => removePricingOption(index, options, optionIndex)}
                                      className="shrink-0 rounded-lg p-2 text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="min-w-0">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              aria-label={`Add pricing option for ${master.name}`}
                              disabled={options.length >= MAX_ADD_ON_PRICING_ENTRIES}
                              onClick={() => addPricingOption(index, options)}
                            >
                              <Plus className="h-4 w-4" /> Add Pricing Option
                            </Button>
                          </div>
                          {isAddonSectionWise && (
                            <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                              <label className="min-w-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                <span className="mb-1 block">Pricing Basis</span>
                                <select
                                  aria-label={`${master.name} pricing basis`}
                                  value={(watchedServices?.[index]?.pricingBasis as string) ?? 'FIXED'}
                                  onChange={(event) => {
                                    const basis = event.target.value;
                                    form.setValue(
                                      `services.${index}.pricingBasis` as 'services.0.pricingBasis',
                                      basis as never,
                                      { shouldDirty: true },
                                    );
                                    if (basis === 'PER_TRAVELER') {
                                      form.setValue(
                                        `services.${index}.quantity` as 'services.0.quantity',
                                        Math.max(1, totalPax),
                                        { shouldDirty: true },
                                      );
                                    }
                                  }}
                                  className={`${field} min-w-0`}
                                >
                                  {ADDON_BASES.map(([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="min-w-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                <span className="mb-1 block">Qty</span>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  aria-label={`${master.name} quantity`}
                                  value={Number(watchedServices?.[index]?.quantity ?? 1) || 1}
                                  readOnly={
                                    (watchedServices?.[index]?.pricingBasis as string) ===
                                    'PER_TRAVELER'
                                  }
                                  onChange={(event) =>
                                    form.setValue(
                                      `services.${index}.quantity` as 'services.0.quantity',
                                      Math.max(1, Math.floor(Number(event.target.value) || 1)),
                                      { shouldDirty: true },
                                    )
                                  }
                                  className={`${field} min-w-0 ${
                                    (watchedServices?.[index]?.pricingBasis as string) ===
                                    'PER_TRAVELER'
                                      ? 'bg-slate-100'
                                      : ''
                                  }`}
                                />
                              </label>
                              <label className="min-w-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                <span className="mb-1 block">Unit Price</span>
                                <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-300">
                                  <span className="flex items-center bg-slate-100 px-2 text-xs text-slate-500">
                                    {currency}
                                  </span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    aria-label={`${master.name} price`}
                                    value={
                                      included
                                        ? (watchedServices?.[index]?.sellingPrice ?? 0)
                                        : (master.price ?? 0)
                                    }
                                    onChange={(event) =>
                                      form.setValue(
                                        `services.${index}.sellingPrice`,
                                        event.target.value === '' ? 0 : Number(event.target.value),
                                        { shouldDirty: true },
                                      )
                                    }
                                    className="min-w-0 flex-1 bg-card px-3 py-2 text-sm outline-none"
                                  />
                                </div>
                              </label>
                            </div>
                          )}
                          <QuotationImageManager
                            label={`${master.name} Images`}
                            ariaPrefix={`addon-${index}`}
                            images={
                              (watchedServices?.[index]?.images ?? []) as QuotationImage[]
                            }
                            pdfImageUrl={watchedServices?.[index]?.pdfImageUrl}
                            onMove={(imageIndex, direction) =>
                              moveServiceImage(index, imageIndex, direction)
                            }
                            onRemove={(imageIndex) => removeServiceImage(index, imageIndex)}
                            onSelectPdf={(identity) => setServicePdfImage(index, identity)}
                          />
                        </div>
                      ) : (
                        <p className="mt-3 min-w-0 text-sm text-slate-500 [overflow-wrap:anywhere]">
                          {master.description
                            ?.replace(/<[^>]*>/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim() || '—'}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            {isAddonSectionWise && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-slate-50 px-4 py-3 text-sm">
                <span className="font-semibold text-slate-700">Total Add-on Services:</span>
                <span className="font-semibold text-slate-900">
                  {currency} {total.toFixed(2)}
                </span>
              </div>
            )}
            {!isAddonSectionWise && masters.filter(m=> includedIndex(m.id)>=0).length>0 && (
              <p className="text-sm text-slate-600">Add-ons selected: {masters.filter(m=> includedIndex(m.id)>=0).length} · Pricing in Summary & Pricing</p>
            )}
          </>
        )}
      </div>
    );
  };

  /** Reference "Visa" tab — one dedicated section, not a list of service rows. */
  const visaSection = () => {
    const svc = Number(form.watch('visaServiceCharge') ?? 0);
    const gst = Number(form.watch('visaGstPercent') ?? 0);
    const vfs = Number(form.watch('visaVfsCharge') ?? 0);
    const gstAmount = (svc * gst) / 100;
    const consolidated = svc + gstAmount + vfs;
    const included = form.watch('includeVisa') ?? true;
    const isVisaSectionWise = (form.watch('pricingMode') as string) === 'SECTION_WISE';
    const moneyInput = (
      label: string,
      name: 'visaAmount' | 'visaServiceCharge' | 'visaVfsCharge',
    ) => (
      <label className="text-sm font-semibold text-slate-800">
        {label}
        <div className="mt-1 flex items-stretch overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand-500">
          <span className="flex items-center bg-slate-100 px-2 text-slate-500">{currency}</span>
          <input
            type="number"
            step="0.01"
            aria-label={label}
            {...form.register(name, MONEY_FIELD)}
            className="min-w-0 flex-1 bg-card px-3 py-2 text-sm outline-none"
          />
        </div>
      </label>
    );
    return (
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <input type="checkbox" {...form.register('includeVisa')} />
          Include Visa in Quotation
        </label>
        {included && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold text-slate-800">
                Section Title
                <input
                  aria-label="Visa section title"
                  placeholder="Visa Details"
                  {...form.register('visaSectionTitle')}
                  className={`${field} mt-1`}
                />
              </label>
              {isVisaSectionWise && moneyInput('Visa Selling Price', 'visaAmount')}
              <label className="text-sm font-semibold text-slate-800">
                Destination
                <input
                  aria-label="Visa destination"
                  {...form.register('visaDestination')}
                  className={`${field} mt-1`}
                />
              </label>
              <label className="text-sm font-semibold text-slate-800">
                Visa Type
                <input
                  aria-label="Visa type"
                  placeholder="Select Visa Type"
                  {...form.register('visaType')}
                  className={`${field} mt-1`}
                />
              </label>
            </div>
            {isVisaSectionWise && (
            <div className="grid gap-4 rounded-lg bg-slate-50 p-4 md:grid-cols-3">
              {moneyInput('Service Charge', 'visaServiceCharge')}
              <label className="text-sm font-semibold text-slate-800">
                GST %
                <input
                  type="number"
                  step="0.01"
                  aria-label="Visa GST percent"
                  {...form.register('visaGstPercent', MONEY_FIELD)}
                  className={`${field} mt-1`}
                />
              </label>
              <label className="text-sm font-semibold text-slate-800">
                GST Amount
                <input
                  readOnly
                  value={`${currency} ${gstAmount.toFixed(2)}`}
                  className={`${field} mt-1 bg-slate-100`}
                />
              </label>
              {moneyInput('VFS Charge', 'visaVfsCharge')}
              <label className="text-sm font-semibold text-slate-800 md:col-span-2">
                Consolidated Total
                <input
                  readOnly
                  value={`${currency} ${consolidated.toFixed(2)}`}
                  className={`${field} mt-1 bg-slate-100`}
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Service Charge + GST + VFS Charge
                </span>
              </label>
            </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    // When the live preview is pinned, the whole row is bounded to the
    // visible viewport so the complete phone is on screen from the initial
    // render with no desktop page scroll: 56px app topbar + 24px main top
    // padding + 24px main bottom padding = 6.5rem of surrounding chrome.
    // The editor form scrolls internally (see below); the preview panel
    // fills the row height. On mobile (<lg) a single state drives an
    // exclusive view: preview open shows only the preview (with its X close),
    // preview closed shows only the editor (with its Open action).
    <div className={livePreviewPinned ? 'flex flex-col gap-4 lg:h-[calc(100vh-6.5rem)] lg:flex-row lg:items-stretch lg:supports-[height:100dvh]:h-[calc(100dvh-6.5rem)]' : undefined}>
      <form
        onSubmit={submit}
        className={
          livePreviewPinned
            ? cn('min-w-0 space-y-5 lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-1 lg:overflow-y-auto', 'hidden lg:block')
            : 'space-y-5'
        }
      >
      <PersistInitialQuotationSnapshot
        enabled={
          version.versionNumber === 1 &&
          version.status === 'DRAFT' &&
          !version.flightDetails &&
          !version.hotelDetails &&
          !version.sightseeingDetails &&
          !version.addOnDetails
        }
        ready={Boolean(
          quotation.data &&
          hotelPrefillReady &&
          destinationMasters.data &&
          sightseeingMasters.data &&
          initializedFormVersionId === version.id,
        )}
        onPersist={() => {
          if (initialSnapshotRef.current.attempted) return;
          initialSnapshotRef.current.attempted = true;
          initialSnapshotRef.current.autoSaving = true;
          void submit();
        }}
      />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to={`/quotations/${quotationId}`} className="rounded-lg p-2 hover:bg-card">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-sm text-slate-500">
              {q.quotationNumber} · Version {version.versionNumber}
            </p>
            <h1 className="text-2xl font-semibold">Quotation builder</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!livePreviewPinned && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setLivePreviewPinned(true)}
              disabled={!quotation.data}
            >
              <Eye className="h-4 w-4" />
              Open Live Preview
            </Button>
          )}
          <Button type="submit" isLoading={save.isPending || updateQuotation.isPending}>
            <Save className="h-4 w-4" />
            Save quotation
          </Button>
        </div>
      </header>
      {save.isError && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{save.error.message}</p>
      )}
      {invalidFields.length > 0 && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <p className="font-semibold">Please fix the following before saving:</p>
          <ul className="mt-1 list-disc pl-5">
            {invalidFields.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Quotation title and weblink headings are displayed and edited on the
          Quotation Details page. They stay registered here (hidden) so every
          save preserves the stored values without resetting them. */}
      <input type="hidden" {...form.register('title')} />
      <input type="hidden" {...form.register('weblinkHeading')} />
      <input type="hidden" {...form.register('packageHeading')} />

      {/* Sub-tab navigation: restrained white container, vertical separators
          between tabs, blue-text + 3px underline active state on a transparent
          background, and edge arrows only while the strip overflows. */}
      <div className="relative rounded-xl border border-border bg-card">
        {tabScroll.left && (
          <button
            type="button"
            aria-label="Scroll tabs left"
            onClick={() => scrollTabs(-1)}
            className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-border bg-card p-1.5 text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div
          ref={tabBarRef}
          onScroll={updateTabScroll}
          className="flex items-center gap-1 overflow-x-auto scroll-smooth px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {visibleTabs.map((tab, index) => (
            <Fragment key={tab.key}>
              {index > 0 && (
                <span aria-hidden="true" className="h-6 w-px shrink-0 bg-slate-200" />
              )}
              <button
                type="button"
                aria-label={tab.label}
                data-active-tab={activeTab === tab.key ? 'true' : undefined}
                onClick={() => {
                  setActiveTab(tab.key);
                  setPreviewNavRequest((request) => request + 1);
                }}
                className={cn(
                  // Transparent tabs, blue text plus a 3px rounded underline
                  // for the active tab only. The transparent bottom border
                  // reserves the underline space so switching tabs never
                  // shifts layout; hover only tints the background.
                  'relative shrink-0 whitespace-nowrap rounded-md border-b-2 border-transparent bg-transparent px-4 py-2.5 text-sm font-medium transition-colors',
                  activeTab === tab.key
                    ? 'text-brand-600'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )}
              >
                {tab.label}
                {leadRequested.has(tab.key) && <span className="ml-0.5 text-red-500">*</span>}
                {activeTab === tab.key && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-brand-600"
                  />
                )}
              </button>
            </Fragment>
          ))}
        </div>
        {tabScroll.right && (
          <button
            type="button"
            aria-label="Scroll tabs right"
            onClick={() => scrollTabs(1)}
            className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-border bg-card p-1.5 text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-700"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tab panels — only the active tab is mounted (RHF keeps field values). */}
      <section className="rounded-xl border border-border bg-card p-4">
        {TABS.filter(
          (t) => t.types && t.key === activeTab && !['addon', 'vehicle', 'cruise'].includes(t.key),
        ).map((tab) => (
          <div key={tab.key}>{serviceTab(tab)}</div>
        ))}

        {/* Flight — structured journeys/segments (reference layout). */}
        {activeTab === 'flight' && flightSection()}

        {/* Keep this field array mounted so V1 initialization never depends on
            the user visiting the Sightseeing/itinerary tab. */}
        <div className={activeTab === 'sightseeing' ? 'block' : 'hidden'}>
          <SightseeingSection
            form={form}
            quotationId={quotationId}
            quotationVersionId={versionId}
            destination={sightseeingDestinationName}
            onDocumentPreviewUrl={handleSightseeingPreviewUrl}
            onSelectedDayChange={setActiveSightseeingDay}
            pax={{
              adults: pax.adults,
              childrenWithBed: pax.cwb,
              childrenWithoutBed: pax.cwob,
              infants: pax.infants,
            }}
          />
        </div>

        {/* Add-on Services — master-driven include-table. */}
        {activeTab === 'addon' && addonTable()}

        {/* Visa — dedicated section. */}
        {SHOW_VISA_QUOTATION_TAB && activeTab === 'visa' && visaSection()}

        {/* Vehicle — reference single-vehicle layout. */}
        {activeTab === 'vehicle' && vehicleTab()}

        {/* Cruise — reference layout with section title, amount, name, duration, room type, description. */}
        {activeTab === 'cruise' && cruiseTab()}

        {/* Hotel */}
        {activeTab === 'hotel' && (
          <div className="space-y-5">
            <IncludeBar tabKey="hotel" label="Hotel" />
            {isIncluded('hotel') && (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-800">
                    Section Title
                    <input
                      aria-label="Hotel section title"
                      {...form.register('hotelDetails.sectionTitle')}
                      className={`${field} mt-1`}
                    />
                  </label>
                  {(form.watch('pricingMode') as string) === 'SECTION_WISE' && (
                  <label className="text-sm font-semibold text-slate-800">
                    Amount
                    <div className="mt-1 flex rounded-lg border border-slate-300 bg-card focus-within:ring-2 focus-within:ring-brand-500">
                      <span className="flex items-center border-r px-3 text-sm text-slate-500">
                        {currency}
                      </span>
                      <input
                        aria-label="Hotel amount"
                        type="number"
                        min="0"
                        step="0.01"
                        {...form.register('hotelDetails.amount', { setValueAs: nullable })}
                        className="w-full rounded-r-lg bg-transparent px-3 py-2 text-sm outline-none"
                      />
                    </div>
                    <span className="mt-1 block text-xs font-normal text-slate-500">Hotel section total is auto-calculated from room allocations when rates are entered.</span>
                  </label>
                  )}
                </div>
                {(form.watch('pricingMode') as string) === 'SECTION_WISE' && (() => {
                  const rows = form.watch('hotels') ?? [];
                  const hotelTotal = rows.filter(r=> r.selected!==false).reduce((sum,row)=> sum + calculateHotelRowTotal(row).total, 0);
                  return hotelTotal>0 ? <div className={`${calculatedCard} flex items-center justify-between`}><span className={calculatedLabel}>Hotel Section Total</span><span className={calculatedValue}>{currency} {hotelTotal.toFixed(2)}</span></div> : null;
                })()}
                <HotelBookmarkListField onLoaded={importHotelBookmark} />

                {hotels.fields.length === 0 && (
                  <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">
                    No hotel stays were found on this lead. Add the first stay below.
                  </p>
                )}

                <section className="space-y-3">
                  {defaultHotelRows.length === 0 && (
                    <div className="flex justify-center">
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label="Add Hotel"
                        onClick={() => appendHotel(true)}
                      >
                        <Plus className="h-4 w-4" /> Add First Hotel Stay
                      </Button>
                    </div>
                  )}
                  {defaultHotelRows.map(({ row, index }, position) =>
                    hotelCard(index, row.id, position === 0),
                  )}
                </section>

                {SHOW_HOTEL_OPTIONS && (
                  <section className="space-y-3 border-t pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-slate-900">Hotel Options</h3>
                        <p className="text-xs text-slate-500">
                          Provide alternative hotel combinations for the customer to choose.
                        </p>
                      </div>
                      <Button size="sm" onClick={() => appendHotel(false)}>
                        <Plus className="h-4 w-4" /> Add Hotel Option
                      </Button>
                    </div>
                    {alternativeHotelRows.length === 0 && (
                      <p className="rounded-lg border border-dashed p-4 text-center text-sm text-slate-500">
                        No alternative hotel option added.
                      </p>
                    )}
                    {alternativeHotelRows.map(({ row, index }) => hotelCard(index, row.id))}
                  </section>
                )}
              </>
            )}
          </div>
        )}

        {/* Legacy day-wise itinerary — superseded by SightseeingSection; never rendered. */}
        {activeTab === '__legacy_itinerary__' && (
          <div className="mt-6 border-t pt-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Day-wise Itinerary</h3>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  itinerary.append({
                    dayNumber: itinerary.fields.length + 1,
                    date: null,
                    title: '',
                    destination: '',
                    description: '',
                    meals: null,
                    overnightLocation: null,
                    activities: null,
                    transfers: null,
                    notes: null,
                    sequence: itinerary.fields.length + 1,
                  })
                }
              >
                <Plus className="h-4 w-4" /> Add Day
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {itinerary.fields.map((row, index) => (
                <article key={row.id} className="rounded-lg border p-4">
                  <div className="flex justify-between">
                    <strong>Day {index + 1}</strong>
                    <Button size="sm" variant="ghost" onClick={() => itinerary.remove(index)}>
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <input
                      aria-label="Itinerary title"
                      placeholder="Title"
                      {...form.register(`itinerary.${index}.title`)}
                      className={field}
                    />
                    <input
                      aria-label="Itinerary destination"
                      placeholder="Destination"
                      {...form.register(`itinerary.${index}.destination`)}
                      className={field}
                    />
                    <input
                      aria-label="Itinerary meals"
                      placeholder="Meals"
                      {...form.register(`itinerary.${index}.meals`)}
                      className={field}
                    />
                    <textarea
                      aria-label="Itinerary description"
                      rows={3}
                      placeholder="Description"
                      {...form.register(`itinerary.${index}.description`)}
                      className={`${field} md:col-span-3`}
                    />
                    <input
                      aria-label="Activities"
                      placeholder="Activities"
                      {...form.register(`itinerary.${index}.activities`)}
                      className={field}
                    />
                    <input
                      aria-label="Transfers"
                      placeholder="Transfers"
                      {...form.register(`itinerary.${index}.transfers`)}
                      className={field}
                    />
                    <input
                      aria-label="Overnight"
                      placeholder="Overnight location"
                      {...form.register(`itinerary.${index}.overnightLocation`)}
                      className={field}
                    />
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {/* Inclusions & Exclusions — five rich-text blocks (reference layout). */}
        {activeTab === 'inclusions' && (
          <div className="space-y-5">
            <p className="text-sm text-slate-600">
              Customize the inclusions and exclusions for this quotation. These will override the
              default destination policies.
            </p>
            <div className="grid gap-5 lg:grid-cols-2">
              {(
                [
                  [
                    '✅ Inclusions',
                    'inclusionsHtml',
                    'List all services and items included in the package.',
                  ],
                  [
                    '❌ Exclusions',
                    'exclusionsHtml',
                    'List all services and items not included in the package.',
                  ],
                  [
                    '💳 Payment Policies',
                    'paymentPolicies',
                    'Specify payment terms, advance requirements, etc.',
                  ],
                  [
                    '🚫 Cancellation Policies',
                    'cancellationPolicies',
                    'Specify cancellation charges and conditions.',
                  ],
                ] as const
              ).map(([title, name, hint]) => (
                <div key={name}>
                  <h3 className="mb-1 font-semibold text-slate-800">{title}</h3>
                  <RichTextEditor
                    ariaLabel={title.replace(/^\S+\s/, '')}
                    value={form.watch(name) ?? ''}
                    onChange={(html) => form.setValue(name, html, { shouldDirty: true })}
                  />
                  <p className="mt-1 text-xs text-slate-500">{hint}</p>
                </div>
              ))}
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-slate-800">🧒 Child Policy</h3>
              <RichTextEditor
                ariaLabel="Child Policy"
                value={form.watch('childPolicy') ?? ''}
                onChange={(html) => form.setValue('childPolicy', html, { shouldDirty: true })}
              />
              <p className="mt-1 text-xs text-slate-500">
                Child pricing, age slabs, and stay conditions.
              </p>
            </div>
            <div>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold text-slate-800">📄 Booking Terms &amp; Conditions</h3>
                {(() => {
                  const termsValue = form.watch('bookingTerms') ?? '';
                  const termsLength = termsValue.length;
                  const overLimit = termsLength > QUOTATION_BOOKING_TERMS_MAX_LENGTH;
                  const nearLimit =
                    !overLimit &&
                    termsLength >= Math.floor(QUOTATION_BOOKING_TERMS_MAX_LENGTH * 0.9);
                  return (
                    <span
                      aria-live="polite"
                      className={cn(
                        'text-xs tabular-nums',
                        overLimit
                          ? 'font-semibold text-red-600'
                          : nearLimit
                            ? 'font-semibold text-amber-600'
                            : 'text-slate-500',
                      )}
                    >
                      {termsLength.toLocaleString('en-IN')} /{' '}
                      {QUOTATION_BOOKING_TERMS_MAX_LENGTH.toLocaleString('en-IN')} characters
                      {overLimit ? ' — over the limit' : ''}
                    </span>
                  );
                })()}
              </div>
              <RichTextEditor
                ariaLabel="Booking Terms & Conditions"
                value={form.watch('bookingTerms') ?? ''}
                onChange={(html) => form.setValue('bookingTerms', html, { shouldDirty: true })}
              />
              <p className="mt-1 text-xs text-slate-500">
                General terms, conditions, and important notes.
              </p>
              {form.formState.errors.bookingTerms?.message ? (
                <p className="mt-1 text-xs font-medium text-red-600">
                  {form.formState.errors.bookingTerms.message as string}
                </p>
              ) : null}
            </div>
          </div>
        )}

        {/* FAQs — quotation-level weblink content. */}
        {activeTab === 'faqs' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-xs text-slate-500">
                Add useful questions and answers for this quotation. They appear as an accordion on
                the public weblink. Leave empty if not needed.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!masterFaqsQuery.data?.data?.length}
                  onClick={importMasterFaqs}
                >
                  <Plus className="h-4 w-4" /> Import FAQs for destination
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => faqs.append({ question: '', answer: '' })}
                >
                  <Plus className="h-4 w-4" /> Add FAQ
                </Button>
              </div>
            </div>
            {importedFaqDestination && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                Imported FAQs for {importedFaqDestination}. You can edit or remove them before saving.
              </p>
            )}
            {faqs.fields.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-slate-500">
                No FAQs added yet. Click &quot;Add FAQ&quot; or import FAQs for this destination from
                the FAQ master.
              </p>
            )}
            <div className="space-y-4">
              {faqs.fields.map((row, index) => (
                <div key={row.id} className="rounded-lg border bg-slate-50 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      FAQ {index + 1}
                    </span>
                    <span className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={index === 0}
                        aria-label={`Move FAQ ${index + 1} up`}
                        onClick={() => faqs.move(index, index - 1)}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={index === faqs.fields.length - 1}
                        aria-label={`Move FAQ ${index + 1} down`}
                        onClick={() => faqs.move(index, index + 1)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete FAQ ${index + 1}`}
                        onClick={() => faqs.remove(index)}
                        className="text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" /> Remove FAQ
                      </Button>
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-slate-700">Question</span>
                    <div className="mt-1">
                      <RichTextEditor
                        ariaLabel={`FAQ ${index + 1} question`}
                        placeholder="e.g. Is breakfast included?"
                        value={form.watch(`faqs.${index}.question`) ?? ''}
                        onChange={(html) => {
                          form.setValue(`faqs.${index}.question`, html, { shouldDirty: true });
                        }}
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <span className="block text-xs font-semibold text-slate-700">Answer</span>
                    <div className="mt-1">
                      <RichTextEditor
                        ariaLabel={`FAQ ${index + 1} answer`}
                        placeholder="e.g. Yes, daily breakfast is included at the hotel."
                        value={form.watch(`faqs.${index}.answer`) ?? ''}
                        onChange={(html) => {
                          form.setValue(`faqs.${index}.answer`, html, { shouldDirty: true });
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary & Pricing — per-passenger package pricing (reference layout). */}
        {activeTab === 'summary' && (
          <div className="space-y-5">
            <section className="overflow-hidden rounded-xl border">
              <div className="bg-gradient-to-r from-brand-700 to-blue-600 px-5 py-3 font-semibold text-white">
                Pricing
              </div>
              <div className="space-y-5 p-5">
                {isSectionWiseMode && (
                  <>
                    <label className="block max-w-sm text-sm font-semibold text-slate-800">
                      Pricing Heading
                      <input
                        aria-label="Pricing heading"
                        placeholder="Price Breakdown"
                        {...form.register('pricingHeading')}
                        className={`${field} mt-1`}
                      />
                    </label>
                    <label className="block max-w-sm text-sm font-semibold text-slate-800">
                      Pricing Subheading
                      <input
                        aria-label="Pricing subheading"
                        placeholder="Optional"
                        {...form.register('pricingSubheading')}
                        className={`${field} mt-1`}
                      />
                    </label>
                    <div className="max-w-md">
                      <p className="text-sm font-semibold text-slate-800">Pricing Display Order</p>
                      <p className="text-xs text-slate-500">
                        The order used on the customer Weblink and PDF.
                      </p>
                      <ol className="mt-2 space-y-1">
                        {(form.watch('pricingDisplayOrder') ?? DEFAULT_PRICING_ORDER).map(
                          (id: string, index: number, arr: string[]) => {
                          const label = PRICING_SECTION_LABELS[id] ?? id;
                          return (
                            <li
                              key={id}
                              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
                            >
                              <span className="font-medium text-slate-700">{label}</span>
                              <span className="flex items-center gap-1">
                                <button
                                  type="button"
                                  aria-label={`Move ${label} up`}
                                  disabled={index === 0}
                                  onClick={() => {
                                    const next = (
                                      form.watch('pricingDisplayOrder') ?? DEFAULT_PRICING_ORDER
                                    ).slice() as string[];
                                    const j = index - 1;
                                    if (j < 0 || j >= next.length) return;
                                    const removed = next.splice(index, 1)[0]!;
                                    next.splice(j, 0, removed);
                                    form.setValue('pricingDisplayOrder', next, { shouldDirty: true });
                                  }}
                                  className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Move ${label} down`}
                                  disabled={index === arr.length - 1}
                                  onClick={() => {
                                    const next = (
                                      form.watch('pricingDisplayOrder') ?? DEFAULT_PRICING_ORDER
                                    ).slice() as string[];
                                    const j = index + 1;
                                    if (j < 0 || j >= next.length) return;
                                    const removed = next.splice(index, 1)[0]!;
                                    next.splice(j, 0, removed);
                                    form.setValue('pricingDisplayOrder', next, { shouldDirty: true });
                                  }}
                                  className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40"
                                >
                                  ↓
                                </button>
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                      <button
                        type="button"
                        onClick={() =>
                          form.setValue('pricingDisplayOrder', DEFAULT_PRICING_ORDER, { shouldDirty: true })
                        }
                        className="mt-2 text-xs font-medium text-brand-700 hover:underline"
                      >
                        Reset order
                      </button>
                    </div>
                    <p className="max-w-sm text-xs text-slate-500">
                      The heading and pricing method will be used on the customer Weblink and PDF.
                    </p>
                  </>
                )}
                <label className="block text-sm font-semibold text-slate-800">
                  Currency <span className="text-red-500">*</span>
                  <select
                    aria-label="Currency"
                    {...form.register('currency')}
                    className="mt-1 block w-auto min-w-[5.5rem] rounded-lg border border-border bg-card px-3 py-2 text-sm h-[38px] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:border-ring transition-colors"
                  >
                    {(SETTINGS_CURRENCIES.includes(currency as (typeof SETTINGS_CURRENCIES)[number])
                      ? SETTINGS_CURRENCIES
                      : [currency, ...SETTINGS_CURRENCIES]
                    ).map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>

                {!isSectionWisePricing && (
                  <>
                    {/* One aligned row per traveler category: price on the left,
                        matching count on the right. */}
                    <div className="space-y-4">
                      {(
                        [
                          ['Per Adult Price', 'perAdultPrice', true, 'Adults', 'adults'],
                          ['Per CWB Price', 'perChildWithBedPrice', false, 'CWB', 'cwb'],
                          ['Per CWOB Price', 'perChildWithoutBedPrice', false, 'CWOB', 'cwob'],
                          ['Per Infant Price', 'perInfantPrice', false, 'Infants', 'infants'],
                        ] as const
                      ).map(([priceLabel, priceName, required, countLabel, countKey]) => (
                        <div
                          key={priceName}
                          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-4"
                        >
                          <label className="min-w-0 text-sm font-semibold text-slate-800">
                            {priceLabel} {required && <span className="text-red-500">*</span>}
                            <div className="mt-1 flex items-stretch overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand-500">
                              <span className="flex items-center bg-slate-100 px-2 text-slate-500">
                                {currency}
                              </span>
                              <input
                                type="number"
                                step="0.01"
                                aria-label={priceLabel}
                                {...form.register(priceName, MONEY_FIELD)}
                                className="min-w-0 flex-1 bg-card px-3 py-2 text-sm outline-none"
                              />
                            </div>
                          </label>
                          <label className="min-w-0 text-sm font-semibold text-slate-800">
                            {countLabel}
                            <input
                              type="number"
                              min={TRAVELER_COUNT_MIN[countKey]}
                              max={TRAVELER_COUNT_MAX[countKey]}
                              step="1"
                              aria-label={countLabel}
                              value={travelerCountEdits[countKey] ?? String(basePax[countKey])}
                              onChange={(event) => onTravelerCountChange(countKey, event.target.value)}
                              onBlur={() => onTravelerCountBlur(countKey)}
                              className={`${field} mt-1`}
                            />
                          </label>
                          <div className="flex items-center gap-1 pt-6">
                            <button
                              type="button"
                              aria-label={`Move ${countLabel} up`}
                              disabled={orderablePricingRowIds.indexOf(countKey) <= 0}
                              onClick={() => movePricingRow(countKey, -1)}
                              className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label={`Move ${countLabel} down`}
                              disabled={
                                orderablePricingRowIds.indexOf(countKey) < 0 ||
                                orderablePricingRowIds.indexOf(countKey) >=
                                  orderablePricingRowIds.length - 1
                              }
                              onClick={() => movePricingRow(countKey, 1)}
                              className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40"
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Totals + Tax Note, kept out of the price/count pairs. */}
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="text-sm font-semibold text-slate-800">
                        Total Package Price
                        <input
                          readOnly
                          aria-label="Total Package Price"
                          value={formatMoney(packageTotal)}
                          className={`${field} mt-1 bg-slate-100`}
                        />
                      </label>
                      <label className="text-sm font-semibold text-slate-800">
                        Tax Note on Total Price
                        <select
                          aria-label="Tax note"
                          value={taxNoteSelectValue}
                          onChange={(event) => {
                            const choice = event.target.value;
                            form.setValue(
                              'taxNote',
                              choice === QUOTATION_TAX_NOTE_HIDDEN ? null : choice,
                              { shouldDirty: true },
                            );
                          }}
                          className={`${field} mt-1`}
                        >
                          {QUOTATION_TAX_NOTE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </>
                )}

                {isSectionWisePricing && (
                  <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-6">
                    {(
                      [
                        ['Adults', 'adults'],
                        ['CWB', 'cwb'],
                        ['CWOB', 'cwob'],
                        ['Infants', 'infants'],
                      ] as const
                    ).map(([label, key]) => (
                      <label key={key} className="text-sm font-semibold text-slate-800">
                        {label}
                        <input
                          type="number"
                          min={TRAVELER_COUNT_MIN[key]}
                          max={TRAVELER_COUNT_MAX[key]}
                          step="1"
                          aria-label={label}
                          value={travelerCountEdits[key] ?? String(basePax[key])}
                          onChange={(event) => onTravelerCountChange(key, event.target.value)}
                          onBlur={() => onTravelerCountBlur(key)}
                          className={`${field} mt-1`}
                        />
                      </label>
                    ))}
                    <label className="text-sm font-semibold text-slate-800">
                      Section Total
                      <input readOnly aria-label="Section Total" value={formatMoney(livePricing.sectionTotal)} className={`${field} mt-1 bg-slate-100`} />
                    </label>
                    <label className="text-sm font-semibold text-slate-800">
                      Tax Note on Total Price
                      <select
                        aria-label="Tax note"
                        value={taxNoteSelectValue}
                        onChange={(event) => {
                          const choice = event.target.value;
                          form.setValue(
                            'taxNote',
                            choice === QUOTATION_TAX_NOTE_HIDDEN ? null : choice,
                            { shouldDirty: true },
                          );
                        }}
                        className={`${field} mt-1`}
                      >
                        {QUOTATION_TAX_NOTE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {canCost && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-800">
                      Net Amount
                      <div className="mt-1 flex items-stretch overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand-500">
                        <span className="flex items-center bg-slate-100 px-2 text-slate-500">
                          {currency}
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          aria-label="Net Amount"
                          {...form.register('netAmount', MONEY_FIELD)}
                          className="min-w-0 flex-1 bg-card px-3 py-2 text-sm outline-none"
                        />
                      </div>
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        Enter net amount to calculate margin.
                      </span>
                    </label>
                    <label className="text-sm font-semibold text-slate-800">
                      Margin
                      <input
                        readOnly
                        aria-label="Margin"
                        value={formatMoney(packageMargin)}
                        className={`${field} mt-1 bg-slate-100`}
                      />
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        Total Package Price − Net Amount. Internal cost {formatMoney(estimate.cost)}
                        .
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </section>

            {!isSectionWisePricing && (
              <div className="rounded-xl bg-teal-600 p-5 text-white">
                <p className="font-semibold">Package Pricing Breakdown</p>
                {packageTotal === 0 ? (
                  <p className="mt-1 text-sm text-white/80">Enter prices to see the breakdown.</p>
                ) : (
                  <div className="mt-3 space-y-1 text-sm">
                    {(() => {
                      const stripRows = orderPricingRows(
                        [
                          { id: 'adults', kind: 'traveler' as const, label: 'Adults', count: pax.adults, price: perPax.adult },
                          { id: 'cwb', kind: 'traveler' as const, label: 'CWB', count: pax.cwb, price: perPax.cwb },
                          { id: 'cwob', kind: 'traveler' as const, label: 'CWOB', count: pax.cwob, price: perPax.cwob },
                          { id: 'infants', kind: 'traveler' as const, label: 'Infants', count: pax.infants, price: perPax.infant },
                          ...packageCustomItems.map((item, index) => ({
                            id: item.id ?? `custom-${index}`,
                            kind: 'custom' as const,
                            label: item.label ?? '',
                            count: 0,
                            price: Number(item.amount ?? 0),
                          })),
                        ].filter((row) =>
                          row.kind === 'traveler'
                            ? row.count > 0 && row.price > 0
                            : row.label.trim().length > 0 && row.price > 0,
                        ),
                        form.watch('pricingRowOrder'),
                      );
                      return stripRows.map((row) => (
                        <div
                          key={row.id}
                          className="flex justify-between border-b border-white/20 py-1"
                        >
                          <span>
                            {row.kind === 'traveler' ? (
                              `${row.label}: ${row.count} × ${formatMoney(row.price)}`
                            ) : (
                              <>
                                {row.label} <span className="text-white/70">(Fixed)</span>
                              </>
                            )}
                          </span>
                          <span>
                            {formatMoney(row.kind === 'traveler' ? row.price * row.count : row.price)}
                          </span>
                        </div>
                      ));
                    })()}
                    <div className="flex justify-between py-1 font-bold">
                      <span>Package Subtotal:</span>
                      <span>{formatMoney(packageTotal)}</span>
                    </div>
                    {livePricing.discountAmount !== 0 && (
                      <div className="flex justify-between border-t border-white/20 py-1">
                        <span>Discount:</span>
                        <span>-{formatMoney(livePricing.discountAmount)}</span>
                      </div>
                    )}
                    {livePricing.taxAmount !== 0 && (
                      <div className="flex justify-between border-b border-white/20 py-1">
                        <span>Tax ({livePricing.taxRate}%):</span>
                        <span>{formatMoney(livePricing.taxAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-2 font-bold">
                      <span>Grand Total:</span>
                      <span>{formatMoney(livePricing.grandTotal)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isSectionWisePricing && (
              <section className="rounded-xl border p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-800">Additional Price Items</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Flat package amounts added on top of the traveler subtotal — e.g. Flights, Visa Fees, Travel Insurance. Not multiplied by the traveler count.</p>
                  </div>
                  <Button
                    size="sm"
                    type="button"
                    onClick={() => {
                      const current = form.getValues('packageCustomItems') ?? [];
                      form.setValue(
                        'packageCustomItems',
                        [...current, { id: newPricingRowId(), label: '', amount: 0 }],
                        { shouldDirty: true },
                      );
                    }}
                  >
                    <Plus className="h-4 w-4" /> Add Item
                  </Button>
                </div>
                {(() => {
                  const items = form.watch('packageCustomItems') ?? [];
                  if (items.length === 0) {
                    return (
                      <div className="mt-4 rounded-lg border border-dashed p-6 text-center">
                        <p className="text-sm font-medium text-slate-700">No additional price items yet</p>
                        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
                          Items are fixed package amounts — not multiplied by traveler count. Add
                          flights, visa fees, travel insurance, etc.
                        </p>
                      </div>
                    );
                  }
                  const updateItem = (
                    index: number,
                    patch: { label?: string; amount?: number },
                  ) => {
                    const next = [...(form.getValues('packageCustomItems') ?? [])];
                    next[index] = { ...next[index], ...patch } as {
                      label: string;
                      amount: number;
                    };
                    form.setValue('packageCustomItems', next, { shouldDirty: true });
                  };
                  return (
                    <div className="mt-4 space-y-3">
                      {items.map((item, index) => (
                        <div
                          key={item.id ?? index}
                          className="flex flex-wrap items-end gap-3"
                        >
                          <label className="min-w-[200px] flex-1 text-sm font-semibold text-slate-800">
                            Label
                            <input
                              type="text"
                              aria-label={`Additional item ${index + 1} label`}
                              maxLength={100}
                              placeholder="e.g. Flight tickets"
                              value={item.label ?? ''}
                              onChange={(event) => updateItem(index, { label: event.target.value })}
                              className={`${field} mt-1`}
                            />
                          </label>
                          <label className="text-sm font-semibold text-slate-800">
                            Amount
                            <div className="mt-1 flex items-stretch overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand-500">
                              <span className="flex items-center bg-slate-100 px-2 text-slate-500">
                                {currency}
                              </span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                aria-label={`Additional item ${index + 1} amount`}
                                value={item.amount ? item.amount : ''}
                                onChange={(event) => {
                                  const raw = event.target.value;
                                  updateItem(index, {
                                    amount: raw === '' ? 0 : Math.max(0, Number(raw) || 0),
                                  });
                                }}
                                className="w-32 min-w-0 bg-card px-3 py-2 text-sm outline-none"
                              />
                            </div>
                          </label>
                          <div className="flex items-center gap-1">
                            {(() => {
                              const rowId = item.id ?? `custom-${index}`;
                              const position = orderablePricingRowIds.indexOf(rowId);
                              const moveLabel = item.label?.trim() || `item ${index + 1}`;
                              // Same shared compact button as the row's Delete
                              // button (h-8) so both arrows match its height and
                              // line up with the Label/Amount input row.
                              return (
                                <>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    aria-label={`Move ${moveLabel} up`}
                                    title={`Move ${moveLabel} up`}
                                    disabled={position <= 0}
                                    onClick={() => movePricingRow(rowId, -1)}
                                  >
                                    <ArrowUp className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    aria-label={`Move ${moveLabel} down`}
                                    title={`Move ${moveLabel} down`}
                                    disabled={
                                      position < 0 ||
                                      position >= orderablePricingRowIds.length - 1
                                    }
                                    onClick={() => movePricingRow(rowId, 1)}
                                  >
                                    <ArrowDown className="h-4 w-4" />
                                  </Button>
                                </>
                              );
                            })()}
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            aria-label={`Delete item ${index + 1}`}
                            onClick={() => {
                              const next = [...(form.getValues('packageCustomItems') ?? [])];
                              next.splice(index, 1);
                              form.setValue('packageCustomItems', next, { shouldDirty: true });
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <p className="text-xs text-slate-500">
                        Fixed package amounts — each appears as its own line in the public Package
                        Price Breakdown. Not multiplied by traveler count.
                      </p>
                    </div>
                  );
                })()}
              </section>
            )}

            {isSectionWisePricing &&
              (() => {
                const pricing = livePricing;
                return (
                  <div className="rounded-xl border bg-white p-5">
                    <h3 className="font-semibold text-slate-800">Section-wise Price Breakdown</h3>
                    <div className="mt-3 space-y-2 text-sm">
                      {pricing.sections
                        .filter((s) => s.amount > 0)
                        .map((s) => (
                          <div key={s.id} className="flex justify-between">
                            <span className="text-slate-600">{s.label}</span>
                            <span className="font-medium">{formatMoney(s.amount)}</span>
                          </div>
                        ))}
                      {(pricing.discountAmount !== 0 || pricing.taxAmount !== 0) && (
                        <div className="flex justify-between border-t pt-2 font-bold">
                          <span>Subtotal</span>
                          <span>{formatMoney(pricing.sectionTotal)}</span>
                        </div>
                      )}
                      {pricing.discountAmount !== 0 && (
                        <div className="flex justify-between">
                          <span className="text-slate-600">Discount</span>
                          <span>-{formatMoney(pricing.discountAmount)}</span>
                        </div>
                      )}
                      {pricing.taxAmount !== 0 && (
                        <div className="flex justify-between">
                          <span className="text-slate-600">Tax ({pricing.taxRate}%)</span>
                          <span>{formatMoney(pricing.taxAmount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t pt-2 font-bold">
                        <span>Grand Total</span>
                        <span>{formatMoney(pricing.grandTotal)}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

            {isSectionWisePricing && (
              <section className="rounded-xl border p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-800">Extra Charges</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Fixed package amounts — each appears as its own line in the Price Breakdown, like Flights or Hotels. Only for By Section.</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingExtraIndex(null);
                      setExtraDraft({ label: '', amount: '', description: '', category: '' });
                      setExtraDraftError('');
                      setExtraChargeDrawerOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" /> Add Extra Charge
                  </Button>
                </div>
                {(() => {
                  const charges = (form.watch('customCharges') ?? []) as Array<{ label?: string; amount?: number; description?: string | null; category?: string | null }>;
                  if (charges.length === 0) {
                    return (
                      <div className="mt-4 rounded-lg border border-dashed p-6 text-center">
                        <p className="text-sm font-medium text-slate-700">No extra charges yet</p>
                        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">Charges are fixed package amounts — not multiplied by traveler count. Add a guide fee, travel insurance, tips, etc.</p>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-3"
                          onClick={() => {
                            setEditingExtraIndex(null);
                            setExtraDraft({ label: '', amount: '', description: '', category: '' });
                            setExtraDraftError('');
                            setExtraChargeDrawerOpen(true);
                          }}
                        >
                          <Plus className="h-4 w-4" /> Add Extra Charge
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <div className="mt-4 space-y-2">
                      {charges.map((c, idx) => (
                        <div key={idx} className="group flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-slate-50">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-800">{c.label}</p>
                            {c.description ? <p className="truncate text-xs text-slate-500">{c.description}</p> : null}
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                              {c.category ? <span className="rounded bg-slate-100 px-1.5 py-0.5">{c.category}</span> : null}
                              <span>Entire Package · Fixed</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="mr-2 text-sm font-semibold text-slate-900">{formatMoney(Number(c.amount) || 0)}</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Edit extra charge ${c.label}`}
                              onClick={() => {
                                setEditingExtraIndex(idx);
                                setExtraDraft({ label: c.label ?? '', amount: String(c.amount ?? ''), description: c.description ?? '', category: c.category ?? '' });
                                setExtraDraftError('');
                                setExtraChargeDrawerOpen(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Delete extra charge ${c.label}`}
                              onClick={() => {
                                if (!window.confirm(`Delete "${c.label}"?`)) return;
                                const next = charges.filter((_, i) => i !== idx);
                                form.setValue('customCharges', next as never, { shouldDirty: true });
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-600" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      <p className="text-sm font-medium text-slate-700">Extra Charges Total: {formatMoney(charges.reduce((s, c) => s + (Number(c.amount) || 0), 0))}</p>
                    </div>
                  );
                })()}
                {extraChargeDrawerOpen && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setExtraChargeDrawerOpen(false)}>
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-label={editingExtraIndex === null ? 'Add Extra Charge' : 'Edit Extra Charge'}
                      className="w-full max-w-lg rounded-xl bg-card p-5 shadow-xl"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-base font-semibold text-slate-900">{editingExtraIndex === null ? 'Add Extra Charge' : 'Edit Extra Charge'}</h4>
                          <p className="mt-0.5 text-xs text-slate-500">Fixed package amount — applied once to the section-wise total, not per traveler.</p>
                        </div>
                        <button type="button" aria-label="Close" onClick={() => setExtraChargeDrawerOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                          <X className="h-5 w-5" aria-hidden="true" />
                        </button>
                      </div>
                      <div className="mt-4 space-y-4">
                        {extraDraftError && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{extraDraftError}</p>}
                        <label className="block text-sm font-medium text-slate-700">
                          Charge Name <span className="text-red-500">*</span>
                          <input
                            autoFocus
                            className={`${field} mt-1`}
                            placeholder="e.g. Guide, Travel Insurance, Tips"
                            value={extraDraft.label}
                            onChange={(event) => setExtraDraft((s) => ({ ...s, label: event.target.value }))}
                            aria-label="Charge Name"
                          />
                          <span className="mt-1 block text-xs font-normal text-slate-500">Shown as its own line in the breakdown, like Flights or Hotels.</span>
                        </label>
                        <label className="block text-sm font-medium text-slate-700">
                          Description <span className="font-normal text-slate-400">(optional)</span>
                          <textarea
                            className={`${field} mt-1`}
                            rows={2}
                            placeholder="Optional details shown on expand"
                            value={extraDraft.description}
                            onChange={(event) => setExtraDraft((s) => ({ ...s, description: event.target.value }))}
                            aria-label="Charge description"
                          />
                        </label>
                        <label className="block text-sm font-medium text-slate-700">
                          Amount <span className="text-red-500">*</span>
                          <div className="mt-1 flex items-stretch overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
                            <span className="flex items-center bg-slate-100 px-3 text-sm text-slate-500">{currency}</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="e.g. 9999"
                              className="min-w-0 flex-1 bg-card px-3 py-2 text-sm outline-none"
                              value={extraDraft.amount}
                              onChange={(event) => setExtraDraft((s) => ({ ...s, amount: event.target.value }))}
                              aria-label="Charge amount"
                            />
                          </div>
                        </label>
                        <label className="block text-sm font-medium text-slate-700">
                          Category <span className="font-normal text-slate-400">(optional)</span>
                          <input
                            className={`${field} mt-1`}
                            placeholder="e.g. Service, Fee"
                            value={extraDraft.category}
                            onChange={(event) => setExtraDraft((s) => ({ ...s, category: event.target.value }))}
                            aria-label="Charge category"
                          />
                        </label>
                        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          Apply To: <span className="font-medium text-slate-800">Entire Package</span> · Fixed amount, not multiplied by traveler count
                        </div>
                      </div>
                      <div className="mt-6 flex justify-end gap-2">
                        <Button variant="secondary" type="button" onClick={() => setExtraChargeDrawerOpen(false)}>
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          onClick={() => {
                            const label = extraDraft.label.trim();
                            if (!label) {
                              setExtraDraftError('Charge Name is required.');
                              return;
                            }
                            if (label.length > 100) {
                              setExtraDraftError('Charge Name must be 100 characters or fewer.');
                              return;
                            }
                            const amountNum = Number(extraDraft.amount);
                            if (!extraDraft.amount.trim() || Number.isNaN(amountNum) || amountNum <= 0) {
                              setExtraDraftError('Enter a valid Amount greater than 0.');
                              return;
                            }
                            if (amountNum > 999999999999) {
                              setExtraDraftError('Amount is too large.');
                              return;
                            }
                            const nextCharge = {
                              label,
                              amount: Math.round(amountNum * 100) / 100,
                              description: extraDraft.description.trim() || null,
                              category: extraDraft.category.trim() || null,
                            };
                            const current = (form.getValues('customCharges') as unknown as Array<{ label: string; amount: number; description?: string | null; category?: string | null }>) ?? [];
                            let next: typeof current;
                            if (editingExtraIndex === null) {
                              next = [...current, nextCharge];
                            } else {
                              next = current.map((c, i) => (i === editingExtraIndex ? nextCharge : c));
                            }
                            form.setValue('customCharges', next as never, { shouldDirty: true });
                            setExtraChargeDrawerOpen(false);
                            setEditingExtraIndex(null);
                            setExtraDraft({ label: '', amount: '', description: '', category: '' });
                            setExtraDraftError('');
                          }}
                        >
                          {editingExtraIndex === null ? 'Add Charge' : 'Save Changes'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Adjustment pipeline — applied ONCE to the active pricing
                method's subtotal. Never to both. */}
            <section className="rounded-xl border p-5">
              <h3 className="text-base font-semibold text-slate-800">Discount &amp; Tax</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Applied after the {isSectionWisePricing ? 'section-wise' : 'traveler-wise'}{' '}
                subtotal: Subtotal → Discount → Tax → Grand Total.
              </p>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-800">
                  Discount Amount
                  <div className="mt-1 flex items-stretch overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand-500">
                    <span className="flex items-center bg-slate-100 px-2 text-slate-500">
                      {currency}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      aria-label="Discount amount"
                      className="min-w-0 flex-1 bg-card px-3 py-2 text-sm outline-none"
                      {...form.register('discountAmount', MONEY_FIELD)}
                    />
                  </div>
                </label>
                <label className="text-sm font-semibold text-slate-800">
                  Tax Rate (%)
                  <div className="mt-1 flex items-stretch overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand-500">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      aria-label="Tax rate percent"
                      className="min-w-0 flex-1 bg-card px-3 py-2 text-sm outline-none"
                      {...form.register('taxRate', MONEY_FIELD)}
                    />
                    <span className="flex items-center bg-slate-100 px-2 text-slate-500">%</span>
                  </div>
                </label>
              </div>
              <div className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">
                    Subtotal ({isSectionWisePricing ? 'Section-wise' : 'Traveler-wise'})
                  </span>
                  <span className="font-medium">{formatMoney(livePricing.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Discount</span>
                  <span className="font-medium">-{formatMoney(livePricing.discountAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Taxable Amount</span>
                  <span className="font-medium">{formatMoney(livePricing.taxableAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Tax ({livePricing.taxRate}%)</span>
                  <span className="font-medium">{formatMoney(livePricing.taxAmount)}</span>
                </div>
                <div className="flex justify-between border-t pt-2 text-base font-bold text-slate-900">
                  <span>Grand Total</span>
                  <span>{formatMoney(livePricing.grandTotal)}</span>
                </div>
              </div>
            </section>

            <section className="rounded-xl border p-5">
              <h3 className="text-lg font-semibold text-slate-800">Initial Payment Details</h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-800">
                  Initial Amount for Booking
                  <div className="mt-1 flex items-stretch overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand-500">
                    <span className="flex items-center bg-slate-100 px-2 text-slate-500">
                      {currency}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      aria-label="Initial amount for booking"
                      placeholder="Amount required to confirm booking"
                      {...form.register('initialPaymentAmount', MONEY_FIELD)}
                      className="min-w-0 flex-1 bg-card px-3 py-2 text-sm outline-none"
                    />
                  </div>
                </label>
                <label className="text-sm font-semibold text-slate-800">
                  Payment Link
                  <input
                    aria-label="Payment link"
                    placeholder="https://example.com/pay"
                    {...form.register('paymentLink', {
                      setValueAs: (value: unknown) =>
                        typeof value === 'string' ? value.trim() || null : (value ?? null),
                    })}
                    className={`${field} mt-1`}
                  />
                  {form.formState.errors.paymentLink && (
                    <span className="mt-1 block text-xs font-normal text-red-600">
                      {form.formState.errors.paymentLink.message as string}
                    </span>
                  )}
                </label>
              </div>
            </section>
          </div>
        )}

        {/* Pricing Breakdown — every priced quotation section from the shared
            resolver (single source of truth, incl. Visa). The section total is
            the grand total for SECTION_WISE; TOTAL pricing keeps the package
            total as the single authoritative number. Hidden for By Traveler. */}
        {activeTab === 'pricingBreakdown' &&
          isSectionWiseMode &&
          (() => {
            const pricing = livePricing;
            const isSectionWise = pricing.pricingMode === 'SECTION_WISE';
            const order = form.watch('pricingDisplayOrder') ?? DEFAULT_PRICING_ORDER;
            const sections = [...pricing.sections].sort((a, b) => {
                const ia = order.indexOf(a.id);
                const ib = order.indexOf(b.id);
                return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
              });
            // The grand total follows the same rule as the summary card: the
            // authoritative pipeline total (subtotal − discount + tax) of the
            // ACTIVE pricing method only.
            const grandTotal = pricing.grandTotal;
            // Expandable hotel calculation: every contributing stay with its
            // room/meal lines so the agent can verify the arithmetic.
            const hotelBreakdownRows = (() => {
              const rows = form.watch('hotels') ?? [];
              if (!rows.length || form.watch('hotelDetails.include') === false) return [];
              return rows
                .filter((row) => row.selected !== false)
                .map((row) => ({ row, totals: calculateHotelRowTotal(row) }))
                .filter((entry) => entry.totals.total !== 0);
            })();
            // Flight per-traveler breakdown — reuse authoritative getFlightPerTravelerBreakdown
            // (same data used by Weblink/PDF). Only when flight is PER_TRAVELER with rates.
            const flightBreakdownRows = (() => {
              const details = form.watch('flightDetails') as unknown;
              if (!details || typeof details !== 'object') return null;
              return getFlightPerTravelerBreakdown(details, {
                adults: pax.adults,
                childrenWithBed: pax.cwb,
                childrenWithoutBed: pax.cwob,
                infants: pax.infants,
              });
            })();
            const money = (value: number) => formatMoney(Math.round(value * 100) / 100);
            return (
              <div className="space-y-5">
                <section className="overflow-hidden rounded-xl border">
                  <div className="bg-gradient-to-r from-brand-700 to-blue-600 px-5 py-3 font-semibold text-white">
                    Pricing Breakdown
                    <span className="ml-2 text-sm font-normal text-white/80">
                      {isSectionWise ? 'By Section' : 'By Traveler'}
                    </span>
                  </div>
                  <div className="p-5">
                    <p className="text-lg font-semibold text-slate-900">
                      {form.watch('pricingHeading') || 'Price Breakdown'}
                    </p>
                    {form.watch('pricingSubheading') ? (
                      <p className="mt-0.5 text-sm text-slate-500">{form.watch('pricingSubheading')}</p>
                    ) : null}
                    {isSectionWise ? (
                      <div className="overflow-hidden rounded-xl border bg-card">
                        <div className="divide-y">
                          {sections.map((section) => (
                            <div key={section.id} className="px-4 py-2.5 text-sm">
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-slate-700">{section.label}</span>
                                <span className="font-semibold text-slate-900">{formatMoney(section.amount)}</span>
                              </div>
                              {section.id.startsWith('extra-') && (section as { description?: string | null }).description ? (
                                <details className="mt-1">
                                  <summary className="cursor-pointer text-xs text-brand-700 hover:underline">Details</summary>
                                  <p className="mt-1 rounded bg-slate-50 p-2 text-xs text-slate-600">{(section as { description?: string | null }).description}</p>
                                </details>
                              ) : null}
                              {section.id.startsWith('extra-') && (section as { category?: string | null }).category ? (
                                <span className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{(section as { category?: string | null }).category}</span>
                              ) : null}
                              {section.id === 'hotel' && hotelBreakdownRows.length > 0 && (
                                <details className="mt-1">
                                  <summary className="cursor-pointer text-xs text-brand-700 hover:underline">
                                    Show hotel calculation
                                  </summary>
                                  <div className="mt-2 space-y-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                                    {hotelBreakdownRows.map(({ row, totals }, index) => (
                                      <div key={index}>
                                        <p className="font-semibold text-slate-700">
                                          {row.hotelName || `Stay ${index + 1}`}
                                          {row.nights ? ` · ${row.nights} night(s)` : ''}
                                          {row.optionGroupId ? ' · Alternative option' : ''}
                                        </p>
                                        {resolveHotelRoomLines(row).map((line, lineIndex) => (
                                          <p key={lineIndex}>
                                            {line.roomType || `Room ${lineIndex + 1}`}:{' '}
                                            {line.rooms ?? 1} × {money(Number(line.baseRoomPrice ?? line.sellingPrice ?? 0))} ×{' '}
                                            {row.nights ?? 1} ={' '}
                                            {money(
                                              (Number(line.baseRoomPrice ?? line.sellingPrice ?? 0)) *
                                                (line.rooms ?? 1) *
                                                (row.nights ?? 1),
                                            )}
                                            {(line.extraBedQuantity ?? 0) > 0 &&
                                              ` + Extra bed ${line.extraBedQuantity} × ${money(Number(line.extraBedPrice ?? 0))} × ${row.nights ?? 1}`}
                                            {(line.childWithoutBedQuantity ?? 0) > 0 &&
                                              ` + CWOB ${line.childWithoutBedQuantity} × ${money(Number(line.childWithoutBedPrice ?? 0))} × ${row.nights ?? 1}`}
                                          </p>
                                        ))}
                                        {resolveHotelMealPlanLines(row).map((line, lineIndex) => (
                                          <p key={`meal-${lineIndex}`}>
                                            Meal plan {line.mealPlan || ''}:{' '}
                                            {money(Number(line.sellingPrice ?? 0))}
                                          </p>
                                        ))}
                                        <p className="font-semibold text-slate-700">
                                          Stay total: {money(totals.total)}
                                          {totals.mealTotal > 0
                                            ? ` (Rooms ${money(totals.roomTotal)} + Meals ${money(totals.mealTotal)})`
                                            : ''}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              )}
                              {section.id === 'flight' &&
                                flightBreakdownRows &&
                                flightBreakdownRows.filter(
                                  (r: { count: number; rate: number }) => r.count > 0 && r.rate > 0,
                                ).length > 0 && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-xs text-brand-700 hover:underline">
                                      Show flight calculation
                                    </summary>
                                    <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-3 text-xs">
                                      {flightBreakdownRows
                                        .filter(
                                          (r: { count: number; rate: number }) => r.count > 0 && r.rate > 0,
                                        )
                                        .map(
                                          (row: { label: string; count: number; rate: number; total: number }) => (
                                          <div
                                            key={row.label}
                                            className="flex items-center justify-between"
                                          >
                                            <span className="text-slate-600">
                                              {row.label}: {row.count} × {formatMoney(row.rate)}
                                            </span>
                                            <span className="font-medium text-slate-900">
                                              {formatMoney(row.total)}
                                            </span>
                                          </div>
                                        ))}
                                      <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
                                        <span>Flight Total</span>
                                        <span>{formatMoney(section.amount)}</span>
                                      </div>
                                    </div>
                                  </details>
                                )}
                            </div>
                          ))}
                           {(pricing.discountAmount !== 0 || pricing.taxAmount !== 0) && (
                            <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                              <span className="font-medium text-slate-700">Subtotal</span>
                              <span className="text-slate-900">{formatMoney(pricing.sectionTotal)}</span>
                            </div>
                          )}
                          {pricing.discountAmount !== 0 && (
                            <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                              <span className="font-medium text-slate-700">Discount</span>
                              <span className="text-slate-900">
                                -{formatMoney(pricing.discountAmount)}
                              </span>
                            </div>
                          )}
                          {pricing.taxAmount !== 0 && (
                            <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                              <span className="font-medium text-slate-700">
                                Tax ({pricing.taxRate}%)
                              </span>
                              <span className="text-slate-900">{formatMoney(pricing.taxAmount)}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between border-t-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900">
                            <span>Grand Total</span>
                            <span>{formatMoney(grandTotal)}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 rounded-xl border bg-card p-4 text-sm">
                        <p className="font-semibold text-slate-900">Per-Person Pricing</p>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600">Number of Travelers</span>
                          <span className="font-semibold text-slate-900">
                            {pax.adults + pax.cwb + pax.cwob + pax.infants}
                          </span>
                        </div>
                        {(
                          [
                            ['Adult', pax.adults, perPax.adult],
                            ['Child with Bed', pax.cwb, perPax.cwb],
                            ['Child without Bed', pax.cwob, perPax.cwob],
                            ['Infant', pax.infants, perPax.infant],
                          ] as const
                        )
                          .filter(([, count, price]) => count > 0 && Number(price) > 0)
                          .map(([label, count, price]) => (
                            <div key={label} className="flex items-center justify-between">
                              <span className="text-slate-600">
                                {label} ({count})
                              </span>
                              <span className="font-medium text-slate-900">
                                {formatMoney(Number(price))}
                              </span>
                            </div>
                          ))}
                        <div className="flex items-center justify-between border-t-2 border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
                          <span>Package Subtotal</span>
                          <span>{formatMoney(pricing.travelerPricing.subtotal)}</span>
                        </div>
                        {pricing.discountAmount !== 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-600">Discount</span>
                            <span>-{formatMoney(pricing.discountAmount)}</span>
                          </div>
                        )}
                        {pricing.taxAmount !== 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-600">Tax ({pricing.taxRate}%)</span>
                            <span>{formatMoney(pricing.taxAmount)}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between border-t-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900">
                          <span>Grand Total</span>
                          <span>{formatMoney(grandTotal)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            );
          })()}

        {/* Settings and Destination Expert */}
        {(activeTab === 'setting' || activeTab === 'destinationExpert') && (
          <div className="space-y-4">
            {activeTab === 'setting' && (
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Quotation Settings</h2>
              </div>
            )}

            <div className="grid items-start gap-4">
              {activeTab === 'setting' && <div className="space-y-4">
                {/* A + B. Weblink navigation and name — one cohesive card. */}
                <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="p-4 sm:p-5">
                    <h3 className="text-sm font-semibold text-slate-900">Weblink Navigation</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Control how customers move around the public quotation.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm transition-colors hover:bg-slate-50">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600"
                          checked={form.watch('showQuickNav') ?? true}
                          disabled={weblinkSettings.isPending}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            form.setValue('showQuickNav', checked, { shouldDirty: true });
                            if (version) {
                              weblinkSettings.mutate({
                                versionId: version.id,
                                showQuickNav: checked,
                              });
                            }
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-slate-800">
                            Show Quick Navigation
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            Let customers jump between weblink sections.
                          </span>
                        </span>
                      </label>
                      <label
                        className={`flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm transition-colors ${
                          (form.watch('showQuickNav') ?? true)
                            ? 'cursor-pointer hover:bg-slate-50'
                            : 'cursor-not-allowed opacity-60'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600"
                          checked={form.watch('quickNavSticky') ?? true}
                          disabled={
                            !(form.watch('showQuickNav') ?? true) || weblinkSettings.isPending
                          }
                          onChange={(event) => {
                            const checked = event.target.checked;
                            form.setValue('quickNavSticky', checked, { shouldDirty: true });
                            if (version) {
                              weblinkSettings.mutate({
                                versionId: version.id,
                                quickNavSticky: checked,
                              });
                            }
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-slate-800">
                            Keep navigation sticky
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            Keep shortcuts visible while scrolling.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 p-4 sm:p-5">
                    <h3 className="text-sm font-semibold text-slate-900">Weblink Name</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Create a short, memorable name for the customer link.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        id="weblink-name"
                        aria-label="Weblink Name"
                        className={`${field} min-w-0 flex-1`}
                        type="text"
                        placeholder="e.g. Mohan"
                        value={weblinkNameValue}
                        disabled={weblinkName.isPending}
                        onChange={(event) => {
                          setWeblinkNameValue(event.target.value);
                          setWeblinkNameError('');
                        }}
                        onBlur={() => void saveWeblinkName()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        className="sm:shrink-0"
                        disabled={weblinkName.isPending}
                        onClick={() => void saveWeblinkName()}
                      >
                        Save name
                      </Button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">Friendly link:</span>
                      {weblinkNamePreview ? (
                        <span className="break-all font-medium text-brand-600 underline decoration-brand-300 underline-offset-2">
                          {weblinkNamePreview}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </div>
                    {weblinkNameError && (
                      <p role="alert" className="mt-2 text-xs text-red-700">
                        {weblinkNameError}
                      </p>
                    )}
                  </div>
                </section>

                {/* C + D. Hero/display overrides and profile card — one card. */}
                <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 p-4 sm:p-5">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Hero &amp; Display Settings
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Customize the customer-facing weblink hero and profile card for this
                      version. Blank fields use the automatic values.
                    </p>
                  </div>
                  <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
                    {(
                      [
                        {
                          path: 'weblinkHeading',
                          label: 'Main Heading',
                          helper: 'Large hero title at the top of the weblink.',
                          auto: weblinkAutoDisplay.mainHeading,
                          maxLength: 200,
                        },
                        {
                          path: 'weblinkDurationText',
                          label: 'Duration Text',
                          helper: 'Trip length under the hero title and in the profile card.',
                          auto: weblinkAutoDisplay.durationText ?? 'As advised',
                          maxLength: 200,
                        },
                        {
                          path: 'packageHeading',
                          label: 'Subtitle',
                          helper: 'Supporting line under the duration.',
                          auto: weblinkAutoDisplay.subtitle,
                          maxLength: 200,
                        },
                        {
                          path: 'weblinkProfileDestination',
                          label: 'Profile Destination',
                          helper: 'Destinations row in the profile information card.',
                          auto: weblinkAutoDisplay.profileDestination,
                          maxLength: 500,
                        },
                      ] as const
                    ).map((item) => {
                      const current = (form.watch(item.path) ?? '') as string;
                      const inputId = `weblink-display-${item.path}`;
                      return (
                        <div
                          key={item.path}
                          className={
                            item.path === 'weblinkProfileDestination' ? 'sm:col-span-2' : ''
                          }
                        >
                          <div className="flex items-center justify-between gap-2">
                            <label
                              htmlFor={inputId}
                              className="text-sm font-medium text-slate-800"
                            >
                              {item.label}
                            </label>
                            <button
                              type="button"
                              disabled={!current.trim()}
                              aria-label={`Reset ${item.label} to default`}
                              onClick={() =>
                                form.setValue(item.path, null, { shouldDirty: true })
                              }
                              className="text-xs font-medium text-brand-600 transition-colors hover:text-brand-700 disabled:cursor-not-allowed disabled:text-slate-300"
                            >
                              Reset to Default
                            </button>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">{item.helper}</p>
                          <input
                            id={inputId}
                            type="text"
                            maxLength={item.maxLength}
                            placeholder={item.auto}
                            value={current}
                            onChange={(event) => {
                              const raw = event.target.value;
                              form.setValue(item.path, raw === '' ? null : raw, {
                                shouldDirty: true,
                              });
                            }}
                            className={`${field} mt-1.5 w-full`}
                          />
                        </div>
                      );
                    })}

                    {/* Profile Information — per-item label/value/show overrides
                        plus the Prepared By composite. Display only; never
                        writes back to lead/business data. */}
                    <div className="rounded-lg border border-slate-200 sm:col-span-2">
                      <div className="border-b border-slate-100 px-3 py-3">
                        <p className="text-sm font-semibold text-slate-800">Profile Information</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Rows in the profile card. Blank label or value fields use the automatic
                          values.
                        </p>
                      </div>
                      <div className="hidden gap-3 border-b border-slate-100 bg-slate-50/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:grid md:grid-cols-[56px_140px_minmax(0,1fr)_minmax(0,1fr)]">
                        <span className="text-center">Show</span>
                        <span>Field</span>
                        <span>Label</span>
                        <span>Value</span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {WEBLINK_PROFILE_FIELD_IDS.map((id) => {
                          const config = watchedWeblinkProfile?.[id] ?? {};
                          const labelId = `weblink-profile-label-${id}`;
                          const valueId = `weblink-profile-value-${id}`;
                          return (
                            <div
                              key={id}
                              className="grid grid-cols-1 gap-2 px-3 py-3 md:grid-cols-[56px_140px_minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-3"
                            >
                              <label className="flex cursor-pointer items-center gap-1.5 md:justify-center">
                                <input
                                  type="checkbox"
                                  checked={config.hidden !== true}
                                  aria-label={`Show ${WEBLINK_PROFILE_FIELD_LABELS[id]}`}
                                  onChange={(event) =>
                                    setWeblinkProfileField(id, { hidden: !event.target.checked })
                                  }
                                  className="h-3.5 w-3.5 rounded border-slate-300"
                                />
                                <span className="text-xs font-medium text-slate-600 md:hidden">
                                  Show
                                </span>
                              </label>
                              <span className="text-xs font-semibold text-slate-700">
                                {WEBLINK_PROFILE_FIELD_LABELS[id]}
                              </span>
                              <div>
                                <label htmlFor={labelId} className="sr-only">
                                  Label
                                </label>
                                <input
                                  id={labelId}
                                  type="text"
                                  maxLength={60}
                                  aria-label={`${WEBLINK_PROFILE_FIELD_LABELS[id]} label`}
                                  placeholder={WEBLINK_PROFILE_FIELD_LABELS[id]}
                                  value={config.label ?? ''}
                                  onChange={(event) =>
                                    setWeblinkProfileField(id, {
                                      label:
                                        event.target.value === '' ? null : event.target.value,
                                    })
                                  }
                                  className={`${field} w-full`}
                                />
                              </div>
                              <div>
                                <label htmlFor={valueId} className="sr-only">
                                  Value
                                </label>
                                <input
                                  id={valueId}
                                  type="text"
                                  maxLength={300}
                                  aria-label={`${WEBLINK_PROFILE_FIELD_LABELS[id]} value`}
                                  placeholder={
                                    weblinkAutoProfile.items.find((row) => row.id === id)?.value ??
                                    ''
                                  }
                                  value={config.value ?? ''}
                                  onChange={(event) =>
                                    setWeblinkProfileField(id, {
                                      value:
                                        event.target.value === '' ? null : event.target.value,
                                    })
                                  }
                                  className={`${field} w-full`}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            Prepared By
                          </span>
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
                            <input
                              type="checkbox"
                              checked={watchedWeblinkProfile?.preparedBy?.hidden !== true}
                              aria-label="Show Prepared By"
                              onChange={(event) =>
                                setWeblinkProfilePreparedBy({ hidden: !event.target.checked })
                              }
                              className="h-3.5 w-3.5 rounded border-slate-300"
                            />
                            Show
                          </label>
                        </div>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor="weblink-profile-pb-label"
                              className="text-[11px] font-medium text-slate-500"
                            >
                              Label
                            </label>
                            <input
                              id="weblink-profile-pb-label"
                              type="text"
                              maxLength={60}
                              aria-label="Prepared By label"
                              placeholder={weblinkAutoProfile.preparedBy.label}
                              value={watchedWeblinkProfile?.preparedBy?.label ?? ''}
                              onChange={(event) =>
                                setWeblinkProfilePreparedBy({
                                  label: event.target.value === '' ? null : event.target.value,
                                })
                              }
                              className={`${field} mt-1 w-full`}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor="weblink-profile-pb-name"
                              className="text-[11px] font-medium text-slate-500"
                            >
                              Name
                            </label>
                            <input
                              id="weblink-profile-pb-name"
                              type="text"
                              maxLength={120}
                              aria-label="Prepared By name"
                              placeholder={weblinkAutoProfile.preparedBy.name}
                              value={watchedWeblinkProfile?.preparedBy?.name ?? ''}
                              onChange={(event) =>
                                setWeblinkProfilePreparedBy({
                                  name: event.target.value === '' ? null : event.target.value,
                                })
                              }
                              className={`${field} mt-1 w-full`}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor="weblink-profile-pb-phone"
                              className="text-[11px] font-medium text-slate-500"
                            >
                              Phone
                            </label>
                            <input
                              id="weblink-profile-pb-phone"
                              type="text"
                              maxLength={60}
                              aria-label="Prepared By phone"
                              placeholder={weblinkAutoProfile.preparedBy.phone}
                              value={watchedWeblinkProfile?.preparedBy?.phone ?? ''}
                              onChange={(event) =>
                                setWeblinkProfilePreparedBy({
                                  phone: event.target.value === '' ? null : event.target.value,
                                })
                              }
                              className={`${field} mt-1 w-full`}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor="weblink-profile-pb-email"
                              className="text-[11px] font-medium text-slate-500"
                            >
                              Email
                            </label>
                            <input
                              id="weblink-profile-pb-email"
                              type="text"
                              maxLength={160}
                              aria-label="Prepared By email"
                              placeholder={weblinkAutoProfile.preparedBy.email}
                              value={watchedWeblinkProfile?.preparedBy?.email ?? ''}
                              onChange={(event) =>
                                setWeblinkProfilePreparedBy({
                                  email: event.target.value === '' ? null : event.target.value,
                                })
                              }
                              className={`${field} mt-1 w-full`}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Section Order — collapsible accordion (collapsed by default). */}
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => setSectionOrderOpen((open) => !open)}
                    aria-expanded={sectionOrderOpen}
                    aria-controls="weblink-section-order-panel"
                    className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-slate-50 sm:px-5"
                  >
                    <span>
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        Weblink Section Order
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                          {
                            visibleWeblinkSectionOrder(
                              resolveWeblinkSectionOrder(
                                form.watch('weblinkSectionOrder')?.length
                                  ? form.watch('weblinkSectionOrder')
                                  : DEFAULT_WEBLINK_SECTION_ORDER,
                              ),
                            ).length
                          }{' '}
                          sections
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        Arrange sections in the order customers should see them.
                      </span>
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${sectionOrderOpen ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                  {sectionOrderOpen && (
                    <div id="weblink-section-order-panel" className="border-t border-slate-200">
                      <div className="divide-y divide-slate-100 px-4 sm:px-5">
                        {(() => {
                          const saved = form.watch('weblinkSectionOrder');
                          const order = resolveWeblinkSectionOrder(
                            saved?.length ? saved : DEFAULT_WEBLINK_SECTION_ORDER,
                          );
                          const visibleOrder = visibleWeblinkSectionOrder(order);
                          const move = (index: number, dir: -1 | 1) => {
                            const target = index + dir;
                            if (target < 0 || target >= visibleOrder.length) return;
                            const from = visibleOrder[index]!;
                            const to = visibleOrder[target]!;
                            const next = [...order];
                            const fromIndex = next.indexOf(from);
                            const toIndex = next.indexOf(to);
                            if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
                            [next[fromIndex], next[toIndex]] = [next[toIndex]!, next[fromIndex]!];
                            form.setValue('weblinkSectionOrder', next, { shouldDirty: true });
                          };
                          return visibleOrder.map((sectionId, index) => (
                            <div
                              key={sectionId}
                              className="flex items-center justify-between gap-3 py-2"
                            >
                              <span className="flex min-w-0 items-center gap-3 text-sm font-medium text-slate-700">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-500">
                                  {index + 1}
                                </span>
                                <span className="truncate">
                                  {WEBLINK_SECTION_LABELS[sectionId] ?? sectionId}
                                </span>
                              </span>
                              <span className="flex shrink-0 items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  disabled={index === 0}
                                  aria-label={`Move ${sectionId} up`}
                                  onClick={() => move(index, -1)}
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  disabled={index === visibleOrder.length - 1}
                                  aria-label={`Move ${sectionId} down`}
                                  onClick={() => move(index, 1)}
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </Button>
                              </span>
                            </div>
                          ));
                        })()}
                      </div>
                      <div className="flex justify-end border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 sm:px-5">
                        <button
                          type="button"
                          className="text-xs font-medium text-slate-600 hover:text-slate-900"
                          onClick={() =>
                            form.setValue(
                              'weblinkSectionOrder',
                              [...DEFAULT_WEBLINK_SECTION_ORDER],
                              { shouldDirty: true },
                            )
                          }
                        >
                          Reset to default order
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>}

              {/* Destination Expert */}
              {activeTab === 'destinationExpert' && <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between xl:flex-col">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Destination Expert</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Add a trusted contact to the customer-facing weblink.
                    </p>
                  </div>
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm font-medium text-slate-700 xl:w-full">
                    <span>Show Destination Expert</span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600"
                      checked={Boolean(watchedExpertConfig?.enabled)}
                      onChange={(e) => {
                        const cur = form.getValues('destinationExpertConfig') as unknown as Record<string, unknown> | null;
                        const enabled = e.target.checked;
                        const currentUserId = user?.id ?? null;
                        const next: Record<string, unknown> = {
                          enabled,
                          expertUserId: currentUserId,
                          heading: (cur as Record<string, unknown> | null)?.heading ?? null,
                          customIntroduction: (cur as Record<string, unknown> | null)?.customIntroduction ?? null,
                          whatsappNumber: (cur as Record<string, unknown> | null)?.whatsappNumber ?? null,
                          callNumber: (cur as Record<string, unknown> | null)?.callNumber ?? null,
                          email: (cur as Record<string, unknown> | null)?.email ?? null,
                          showWhatsapp: (cur as Record<string, unknown> | null)?.showWhatsapp ?? true,
                          showCall: (cur as Record<string, unknown> | null)?.showCall ?? true,
                          showEmail: (cur as Record<string, unknown> | null)?.showEmail ?? true,
                          showExperience: (cur as Record<string, unknown> | null)?.showExperience ?? true,
                          showTripsPlanned: (cur as Record<string, unknown> | null)?.showTripsPlanned ?? true,
                          showLanguages: (cur as Record<string, unknown> | null)?.showLanguages ?? true,
                        };
                        if (enabled) {
                          const expertId = (next.expertUserId as string | null) ?? null;
                          const fallback = getExpertFallback(expertId);
                          if (!next.whatsappNumber && fallback.whatsappNumber) next.whatsappNumber = fallback.whatsappNumber;
                          if (!next.callNumber && fallback.callNumber) next.callNumber = fallback.callNumber;
                          if (!next.email && fallback.email) next.email = fallback.email;
                        }
                        form.setValue('destinationExpertConfig', next as never, { shouldDirty: true });
                      }}
                    />
                  </label>
                </div>
                {watchedExpertConfig?.enabled && (
                  <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                    <label className="block text-sm font-semibold text-slate-800">
                      Expert
                      <input
                        className={`${field} mt-1 bg-slate-100`}
                        value={user?.fullName ?? ''}
                        disabled
                        readOnly
                      />
                    </label>
                    <div className="flex items-end gap-2">
                      <label className="block flex-1 text-sm font-semibold text-slate-800">
                        Import destination preset
                        <select
                          className={`${field} mt-1 bg-white`}
                          value={selectedPresetId}
                          onChange={(e) => setSelectedPresetId(e.target.value)}
                        >
                          <option value="">Select destination preset</option>
                          {filteredDestinationExpertPresets.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.destination}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!selectedPresetId || expertImportLoading}
                        onClick={async () => {
                          if (!selectedPresetId) return;
                          setExpertImportError(null);
                          setExpertImportSuccess(null);
                          setExpertImportLoading(true);
                          try {
                            // Fetch the actual saved preset from backend — ensures latest data and validates existence
                            const preset = await apiClient.get<import('@/features/destination-expert/destination-expert.api').DestinationExpertPreset>(`/destination-expert-presets/${selectedPresetId}`);
                            if (!preset) throw new Error('Preset not found.');
                            const cur = form.getValues('destinationExpertConfig') as unknown as Record<string, unknown> | null;
                            // Snapshot: copy master data into quotation-owned config; future master changes won't mutate this quotation
                            const snapshot: Record<string, unknown> = {
                              ...(cur ?? {}),
                              enabled: true,
                              expertUserId: user?.id ?? (preset as unknown as Record<string, unknown>).userId ?? null,
                              heading: (preset.heading ?? '').trim() || null,
                              customIntroduction: (preset.customIntroduction ?? '').trim() || null,
                              whatsappNumber: (preset.whatsappNumber ?? '').trim() || null,
                              callNumber: (preset.callNumber ?? '').trim() || null,
                              email: (preset.email ?? '').trim().toLowerCase() || null,
                              showWhatsapp: (preset.showWhatsapp ?? true) as boolean,
                              showCall: (preset.showCall ?? true) as boolean,
                              showEmail: (preset.showEmail ?? true) as boolean,
                              showExperience: (preset.showExperience ?? true) as boolean,
                              showTripsPlanned: (preset.showTripsPlanned ?? true) as boolean,
                              showLanguages: (preset.showLanguages ?? true) as boolean,
                              jobTitle: ((preset as unknown as Record<string, unknown>).jobTitle as string | null | undefined)?.trim() || null,
                              bio: ((preset as unknown as Record<string, unknown>).bio as string | null | undefined)?.trim() || null,
                              specialization: ((preset as unknown as Record<string, unknown>).specialization as string | null | undefined)?.trim() || null,
                              yearsOfExperience: (preset as unknown as Record<string, unknown>).yearsOfExperience as number | null | undefined ?? null,
                              tripsPlanned: (preset as unknown as Record<string, unknown>).tripsPlanned as number | null | undefined ?? null,
                              languages: ((preset as unknown as Record<string, unknown>).languages as string | null | undefined)?.trim() || null,
                              gender: ((preset as unknown as Record<string, unknown>).gender as string | null | undefined) as 'MALE' | 'FEMALE' | null ?? null,
                              destination: (preset.destination ?? '').trim() || null,
                            };
                            // Avatar: preset may carry profileImageUrl or legacy objectKey — prefer URL if present
                            const profileImageUrl = (preset as unknown as Record<string, unknown>).profileImageUrl as string | null | undefined;
                            const profileImageObjectKey = (preset as unknown as Record<string, unknown>).profileImageObjectKey as string | null | undefined;
                            if (profileImageUrl && typeof profileImageUrl === 'string' && profileImageUrl.trim()) {
                              snapshot.profileImageUrl = profileImageUrl.trim();
                            } else if (profileImageObjectKey && typeof profileImageObjectKey === 'string' && profileImageObjectKey.trim()) {
                              // No URL available from preset — leave as null and let gender default handle avatar; quotation owns its own snapshot
                              snapshot.profileImageUrl = null;
                            } else {
                              snapshot.profileImageUrl = null;
                            }
                            form.setValue('destinationExpertConfig', snapshot as never, { shouldDirty: true });
                            setExpertImportSuccess(`Imported ${preset.destination} preset successfully.`);
                            // Clear success after 3s
                            window.setTimeout(() => setExpertImportSuccess(null), 3000);
                          } catch (err) {
                            const message = err instanceof Error ? err.message : 'Failed to import preset.';
                            // Do not clear existing quotation expert data on failed import
                            setExpertImportError(message);
                          } finally {
                            setExpertImportLoading(false);
                          }
                        }}
                      >
                        {expertImportLoading ? 'Importing…' : 'Import'}
                      </Button>
                    </div>
                    {expertImportError && (
                      <p role="alert" className="mt-2 text-xs font-medium text-red-600">
                        {expertImportError}
                      </p>
                    )}
                    {expertImportSuccess && (
                      <p role="status" className="mt-2 text-xs font-medium text-emerald-600">
                        {expertImportSuccess}
                      </p>
                    )}
                    <p className="text-xs text-slate-400">Presets are managed in Settings → Destination Expert (per user, per destination).</p>
                    <label className="block text-sm font-semibold text-slate-800">
                      Heading
                      <input
                        className={`${field} mt-1 bg-white`}
                        placeholder="e.g. Your Destination Expert"
                        value={watchedExpertConfig?.heading ?? ''}
                        onChange={(e) => {
                          const cur = form.getValues('destinationExpertConfig');
                          form.setValue(
                            'destinationExpertConfig',
                            { ...(cur ?? {}), heading: e.target.value || null } as never,
                            { shouldDirty: true },
                          );
                        }}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-800">
                      Custom introduction
                      <textarea
                        rows={2}
                        className={`${field} mt-1 bg-white`}
                        placeholder="Custom intro shown under expert details"
                        value={watchedExpertConfig?.customIntroduction ?? ''}
                        onChange={(e) => {
                          const cur = form.getValues('destinationExpertConfig');
                          form.setValue(
                            'destinationExpertConfig',
                            { ...(cur ?? {}), customIntroduction: e.target.value || null } as never,
                            { shouldDirty: true },
                          );
                        }}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-800">
                      WhatsApp Number
                      <input
                        className={`${field} mt-1 bg-white`}
                        placeholder="+91XXXXXXXXXX"
                        value={((watchedExpertConfig as unknown as { whatsappNumber?: string | null })?.whatsappNumber ?? '') as string}
                        onChange={(e) => {
                          const cur = form.getValues('destinationExpertConfig');
                          form.setValue(
                            'destinationExpertConfig',
                            { ...(cur ?? {}), whatsappNumber: e.target.value.trim() || null } as never,
                            { shouldDirty: true },
                          );
                        }}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-800">
                      Call Number
                      <input
                        className={`${field} mt-1 bg-white`}
                        placeholder="+91XXXXXXXXXX"
                        value={((watchedExpertConfig as unknown as { callNumber?: string | null })?.callNumber ?? '') as string}
                        onChange={(e) => {
                          const cur = form.getValues('destinationExpertConfig');
                          form.setValue(
                            'destinationExpertConfig',
                            { ...(cur ?? {}), callNumber: e.target.value.trim() || null } as never,
                            { shouldDirty: true },
                          );
                        }}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-800">
                      Email Address
                      <input
                        className={`${field} mt-1 bg-white`}
                        placeholder="expert@email.com"
                        value={((watchedExpertConfig as unknown as { email?: string | null })?.email ?? '') as string}
                        onChange={(e) => {
                          const cur = form.getValues('destinationExpertConfig');
                          form.setValue(
                            'destinationExpertConfig',
                            { ...(cur ?? {}), email: e.target.value.trim() || null } as never,
                            { shouldDirty: true },
                          );
                        }}
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                      {(
                        [
                          ['showWhatsapp', 'Show WhatsApp'],
                          ['showCall', 'Show Call'],
                          ['showEmail', 'Show Email'],
                          ['showExperience', 'Show Experience'],
                          ['showTripsPlanned', 'Show Trips Planned'],
                          ['showLanguages', 'Show Languages'],
                        ] as const
                      ).map(([key, label]) => (
                        <label
                          key={key}
                          className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-2 text-sm text-slate-700"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-brand-600"
                            checked={Boolean(
                              (watchedExpertConfig as unknown as Record<string, unknown>)?.[key] ??
                              true,
                            )}
                            onChange={(e) => {
                              const cur = form.getValues('destinationExpertConfig');
                              form.setValue(
                                'destinationExpertConfig',
                                { ...(cur ?? {}), [key]: e.target.checked } as never,
                                { shouldDirty: true },
                              );
                            }}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>}
            </div>
          </div>
        )}
      </section>

      {/* Quotation Summary (preserved across every builder tab). */}
      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="bg-emerald-600 px-5 py-3 font-semibold text-white">Quotation Summary</div>
        <div className="grid gap-0 p-0 md:grid-cols-2">
          <table className="text-sm">
            <tbody>
              {[
                ['Client Name', q.customerName],
                ['Contact', [q.customerPhone, q.customerEmail].filter(Boolean).join(' / ')],
                ['Travelers', travellers || '—'],
                [
                  'Dates',
                  q.travelStartDate
                    ? `${new Date(q.travelStartDate).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}${nights != null ? ` (${nights} Nights / ${nights + 1} Days)` : ''}`
                    : '—',
                ],
                ['Destination', q.destinationSummary || '—'],
              ].map(([label, value]) => (
                <tr key={label} className="border-b last:border-0">
                  <th className="w-40 border-r bg-slate-50 px-4 py-3 text-left font-semibold text-slate-700">
                    {label}
                  </th>
                  <td className="px-4 py-3 text-slate-700">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-col justify-center gap-3 p-5">
            <div className="rounded-lg bg-emerald-600 p-4 text-white">
              <p className="text-sm opacity-90">Final Quotation Total</p>
              <p className="text-2xl font-bold">
                {currency} {summaryTotal.toFixed(2)}
              </p>
              <p className="text-xs opacity-80">
                {isSectionWisePricing ? '(Section-wise Total)' : '(Package Price)'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {activeTab === 'setting' ? (
        <div
          aria-label="Settings actions"
          className="flex flex-col-reverse gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
        >
          <p className="text-xs text-slate-500">
            Saving applies these settings to the current quotation version.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Link to={`/quotations/${quotationId}`} className="w-full sm:inline-flex sm:w-auto">
              <Button variant="secondary" type="button" className="w-full sm:w-auto">
                Cancel
              </Button>
            </Link>
            <Button type="submit" isLoading={save.isPending || updateQuotation.isPending} className="w-full sm:w-auto">
              <Save className="h-4 w-4" />
              Save quotation
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button type="submit" isLoading={save.isPending || updateQuotation.isPending}>
            <Save className="h-4 w-4" />
            Save quotation
          </Button>
          <Link to={`/quotations/${quotationId}`}>
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </Link>
        </div>
      )}
      </form>
      {livePreviewPinned && quotation.data && version && (
        <aside
          data-testid="live-preview-panel"
          aria-label="Live weblink preview"
          className={cn(
            'flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card',
            // Mounted only when pinned, so always visible: exclusive preview
            // on mobile (<lg), side-by-side on desktop. Unmounting on close
            // returns the editor to full width with form values intact.
            // Fixed to the rendered phone width (PHONE_BODY_WIDTH 417px) plus
            // the 16px grey padding on each side (px-4) inside the phone
            // frame plus the 1px panel border per side (451 = 417 + 32 + 2),
            // so the grey gap is 16px per side instead of the large
            // margins a 43% share produced. The phone itself is never
            // stretched: usePhoneFitScale() only scales it down to fit.
            'lg:h-full lg:min-h-0 lg:w-[451px] lg:shrink-0',
          )}
        >
          <PinnedLiveQuotationPreview
            quotation={{
              ...quotation.data,
              adults: pax.adults,
              childrenWithBed: pax.cwb,
              childrenWithoutBed: pax.cwob,
              infants: pax.infants,
            }}
            savedVersion={version}
            settings={settingsQuery.data ?? null}
            control={form.control}
            flightPreviewUrls={flightImagePreviewUrls}
            onClose={() => setLivePreviewPinned(false)}
            masters={previewMasters}
            sightseeingPreviewUrls={sightseeingPreviewUrls}
            expertUsers={expertUsersQuery.data?.data ?? []}
            activeSection={previewSectionForBuilderTab(activeTab)}
            activeItems={previewTargetItems}
            navigationKey={previewNavRequest}
          />
        </aside>
      )}
    </div>
  );
}
