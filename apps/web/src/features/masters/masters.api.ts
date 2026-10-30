import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type {
  AirlineInput,
  AirlineLogoUploadInput,
  AirlineUpdateInput,
  CruiseImageUploadInput,
  CruiseInput,
  CruiseUpdateInput,
  VehicleImageUploadInput,
  VehicleInput,
  VehicleUpdateInput,
  SightseeingImageUploadInput,
  SightseeingInput,
  SightseeingUpdateInput,
  SightseeingMealDefaults,
  AddOnServiceImageUploadInput,
  AddOnServiceInput,
  AddOnServiceUpdateInput,
  VisaTypeInput,
  VisaTypeUpdateInput,
  TestimonialInput,
  TestimonialUpdateInput,
  TestimonialImageUploadInput,
  FaqInput,
  FaqUpdateInput,
  CityInput,
  CityUpdateInput,
  CountryReference,
  DestinationImageUploadInput,
  DestinationInput,
  DestinationUpdateInput,
  HotelImageUploadInput,
  HotelInput,
  HotelMealPlanInput,
  HotelMealPlanMonthPriceInput,
  HotelMealPlanMonthPriceUpdateInput,
  HotelMealPlanSeasonInput,
  HotelMealPlanSeasonUpdateInput,
  HotelMealPlanUpdateInput,
  HotelMonthPriceInput,
  HotelMonthPriceUpdateInput,
  HotelRoomTypeInput,
  HotelRoomTypeMonthPriceInput,
  HotelRoomTypeMonthPriceUpdateInput,
  HotelRoomTypeSeasonInput,
  HotelRoomTypeSeasonUpdateInput,
  HotelRoomTypeUpdateInput,
  HotelSeasonInput,
  HotelSeasonUpdateInput,
  HotelUpdateInput,
} from '@interscale/shared';
import { apiClient } from '@/api/client';

/**
 * Server-computed ownership metadata attached to every master response.
 * The backend decides these booleans; the frontend only renders them.
 */
export type MasterSource = 'GLOBAL' | 'TENANT' | 'SYSTEM';

export interface MasterVisibilityMeta {
  isGlobal: boolean;
  isOwnedByCurrentTenant: boolean;
  canEdit: boolean;
  canHide: boolean;
  canRestore: boolean;
  source: MasterSource;
}
export interface MasterImageMeta {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  isPrimary: boolean;
}

export function masterImageFingerprint(master: {
  images?: MasterImageMeta[];
  imageConfirmedAt?: string | null;
}) {
  return master.images?.[0]?.id ?? master.imageConfirmedAt ?? '';
}

export interface City extends MasterVisibilityMeta {
  id: string;
  countryCode: string;
  countryName: string;
  name: string;
  airportCode: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string };
  _count: { destinationLinks: number };
}

export interface DestinationCityLink {
  id: string;
  cityId: string;
  sequence: number;
  city: City;
}

export interface Destination extends MasterVisibilityMeta {
  id: string;
  countryCode: string;
  countryName: string;
  name: string;
  privateName: string | null;
  /** Optional vendor contact used by itinerary emails; null when unconfigured. */
  email: string | null;
  destinationType: string;
  status: string;
  inclusions: string | null;
  exclusions: string | null;
  paymentPolicies: string | null;
  cancellationPolicies: string | null;
  bookingTerms: string | null;
  childPolicy: string | null;
  imageStorageProvider: string | null;
  imageFileName: string | null;
  imageMimeType: string | null;
  imageFileSize: number | null;
  imageConfirmedAt: string | null;
  hasImage: boolean;
  images: MasterImageMeta[];
  cities: DestinationCityLink[];
  _count: { cities: number };
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string };
}

export interface Page<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface HotelStatistics {
  totalHotels: number;
  destinations: number;
  totalCities: number;
  averageRating: number | null;
  roomTypes: number;
  mealPlans: number;
}

export interface HotelPage extends Page<HotelSummary> {
  statistics: HotelStatistics;
}

export interface MasterLookups {
  countries: CountryReference[];
  cities: Array<{ id: string; name: string; airportCode: string | null; countryCode: string }>;
}

const MASTER_DEFAULT_PAGE_SIZE = '10';

/** Destination Master lists 30 rows per page by default (others stay at 10). */
const DESTINATION_DEFAULT_PAGE_SIZE = '30';

/**
 * Per-request page size used when a UI needs the *complete* filtered result
 * set (e.g. the grouped Sightseeing Master list). This is the server's
 * maximum page size — it bounds a single response, never the total number of
 * records retrieved. Callers must page through to `total`, not stop here.
 */
const MASTER_FULL_PAGE_SIZE = 100;

/** How many list pages may be in flight at once during a full fetch. */
const MASTER_FULL_FETCH_CONCURRENCY = 5;

function masterListQuery(
  params = new URLSearchParams(),
  defaultPageSize: string = MASTER_DEFAULT_PAGE_SIZE,
) {
  const next = new URLSearchParams(params);
  if (!next.has('pageSize')) next.set('pageSize', defaultPageSize);
  return next.toString();
}

/** Filter-only query string: paging params stripped so the key is page-stable. */
function masterFilterKey(params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.delete('page');
  next.delete('pageSize');
  return next.toString();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

/**
 * Fetch every page of a paginated master list endpoint for one fixed filter
 * set. There is deliberately NO total-record cap: pages are followed until
 * the server-reported `total` unique records have been retrieved (plus a
 * data-driven tail when the set grows mid-fetch), using the same
 * search/filter/tenant-scoped params on every request.
 *
 * - Page order is preserved (server sort is authoritative; no client re-sort).
 * - Rows are deduplicated by stable `id` so overlapping pages/retries never
 *   duplicate a record, while distinct records with identical names are kept.
 * - Any page failure rejects the whole fetch so callers never mistake a
 *   partial result for the complete dataset.
 *
 * Exported for deterministic unit tests (mocked transport, no live API).
 */
export async function fetchAllMasterPages<T extends { id: string }>(
  path: string,
  filters: URLSearchParams,
  signal?: AbortSignal,
): Promise<Page<T>> {
  const base = new URLSearchParams(filters);
  base.delete('page');
  base.delete('pageSize');

  const pageUrl = (page: number) => {
    const query = new URLSearchParams(base);
    query.set('page', String(page));
    query.set('pageSize', String(MASTER_FULL_PAGE_SIZE));
    const suffix = query.toString();
    return suffix ? `${path}?${suffix}` : path;
  };

  const first = await apiClient.get<Page<T>>(pageUrl(1), signal);
  const seen = new Map<string, T>();
  for (const row of first.data ?? []) {
    if (!seen.has(row.id)) seen.set(row.id, row);
  }
  let total = first.pagination?.total ?? first.data?.length ?? 0;
  let totalPages = first.pagination?.totalPages ?? 1;

  // Pages are 1-based; page 1 is already loaded.
  let nextPage = 2;
  const fetchPage = async (page: number): Promise<Page<T>> => {
    throwIfAborted(signal);
    return apiClient.get<Page<T>>(pageUrl(page), signal);
  };
  const absorb = (page: Page<T>) => {
    for (const row of page.data ?? []) {
      if (!seen.has(row.id)) seen.set(row.id, row);
    }
    if (typeof page.pagination?.total === 'number') total = page.pagination.total;
    if (typeof page.pagination?.totalPages === 'number') totalPages = page.pagination.totalPages;
  };

  // Planned pages from the server-reported totalPages …
  while (nextPage <= totalPages) {
    throwIfAborted(signal);
    const batch: number[] = [];
    while (batch.length < MASTER_FULL_FETCH_CONCURRENCY && nextPage <= totalPages) {
      batch.push(nextPage);
      nextPage += 1;
    }
    const pages = await Promise.all(batch.map((page) => fetchPage(page)));
    for (const page of pages) absorb(page);
  }
  // … plus a data-driven tail if the set grew while paging. The loop only
  // stops on observed data (a short/empty page, or consecutive pages adding
  // no new unique ids) — there is no fixed page/record ceiling.
  let stagnant = 0;
  while (seen.size < total) {
    throwIfAborted(signal);
    const page = await fetchPage(nextPage);
    const before = seen.size;
    absorb(page);
    nextPage += 1;
    const received = page.data ?? [];
    if (received.length === 0 || received.length < MASTER_FULL_PAGE_SIZE) break;
    stagnant = seen.size === before ? stagnant + 1 : 0;
    if (stagnant >= 2) break;
  }

  return {
    data: [...seen.values()],
    pagination: { page: 1, pageSize: seen.size, total, totalPages },
  };
}

const keys = {
  cities: ['masters', 'cities'] as const,
  city: (id: string) => ['masters', 'cities', id] as const,
  destinations: ['masters', 'destinations'] as const,
  destination: (id: string) => ['masters', 'destinations', id] as const,
};
const invalidate = (
  client: ReturnType<typeof useQueryClient>,
  kind: 'cities' | 'destinations',
  id?: string,
) => {
  void client.invalidateQueries({ queryKey: keys[kind] });
  if (id)
    void client.invalidateQueries({
      queryKey: kind === 'cities' ? keys.city(id) : keys.destination(id),
    });
};

export function useCities(params = new URLSearchParams()) {
  const query = masterListQuery(params);
  return useQuery({
    queryKey: [...keys.cities, query],
    queryFn: ({ signal }) =>
      apiClient.get<Page<City>>(`/masters/cities${query ? `?${query}` : ''}`, signal),
  });
}
/**
 * Complete city option set for filter dropdowns: pages through the whole
 * filtered result instead of stopping at the first page. Same filters,
 * permissions and tenant scoping as {@link useCities} — only the page loop
 * differs, so an eligible city beyond the first response stays selectable.
 */
export function useAllCities(params = new URLSearchParams()) {
  const filterKey = masterFilterKey(params);
  return useQuery({
    queryKey: [...keys.cities, 'all', filterKey],
    queryFn: ({ signal }) =>
      fetchAllMasterPages<City>('/masters/cities', new URLSearchParams(filterKey), signal),
  });
}
export function useCity(id?: string) {
  return useQuery({
    queryKey: keys.city(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<City>(`/masters/cities/${id}`, signal),
    enabled: Boolean(id),
  });
}
export function useMasterLookups(country?: string, search?: string) {
  const params = new URLSearchParams();
  if (country) params.set('country', country);
  if (search) params.set('search', search);
  const query = params.toString();
  return useQuery({
    queryKey: ['masters', 'lookups', query],
    queryFn: ({ signal }) =>
      apiClient.get<MasterLookups>(`/masters/cities/lookups${query ? `?${query}` : ''}`, signal),
  });
}
export function useCreateCity() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CityInput) => apiClient.post<City>('/masters/cities', input),
    onSuccess: () => invalidate(client, 'cities'),
  });
}
export function useUpdateCity(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CityUpdateInput) => apiClient.patch<City>(`/masters/cities/${id}`, input),
    onSuccess: () => invalidate(client, 'cities', id),
  });
}
export function useDeleteCity() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<City>(`/masters/cities/${id}`),
    onSuccess: (_, id) => invalidate(client, 'cities', id),
  });
}

export function useDestinations(params = new URLSearchParams()) {
  const query = masterListQuery(params, DESTINATION_DEFAULT_PAGE_SIZE);
  return useQuery({
    queryKey: [...keys.destinations, query],
    queryFn: ({ signal }) =>
      apiClient.get<Page<Destination>>(`/masters/destinations${query ? `?${query}` : ''}`, signal),
  });
}
/**
 * Complete destination option set for filter dropdowns — see
 * {@link useAllCities}. Paging only; filters, visibility and status semantics
 * are unchanged.
 */
export function useAllDestinations(params = new URLSearchParams()) {
  const filterKey = masterFilterKey(params);
  return useQuery({
    queryKey: [...keys.destinations, 'all', filterKey],
    queryFn: ({ signal }) =>
      fetchAllMasterPages<Destination>(
        '/masters/destinations',
        new URLSearchParams(filterKey),
        signal,
      ),
  });
}
export function useDestination(id?: string) {
  return useQuery({
    queryKey: keys.destination(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<Destination>(`/masters/destinations/${id}`, signal),
    enabled: Boolean(id),
  });
}
export function useCreateDestination() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: DestinationInput) =>
      apiClient.post<Destination>('/masters/destinations', input),
    onSuccess: (saved) => {
      // Seed the detail cache with the persisted record so the details page
      // mounts on exactly what the server stored, then invalidate for a
      // server-fresh re-read.
      client.setQueryData(keys.destination(saved.id), saved);
      invalidate(client, 'destinations');
    },
  });
}
export function useUpdateDestination(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: DestinationUpdateInput) =>
      apiClient.patch<Destination>(`/masters/destinations/${id}`, input),
    onSuccess: (saved) => {
      // Seed the detail cache with the persisted record so the details page
      // mounts on exactly what the server stored — never on pre-save data —
      // then invalidate for a server-fresh re-read.
      client.setQueryData(keys.destination(id), saved);
      invalidate(client, 'destinations', id);
    },
  });
}
export function useDeleteDestination() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<Destination>(`/masters/destinations/${id}`),
    onSuccess: (_, id) => invalidate(client, 'destinations', id),
  });
}

export async function approveDestinationImage(id: string, input: DestinationImageUploadInput) {
  return apiClient.post<{ uploadUrl: string; expiresInSeconds: number }>(
    `/masters/destinations/${id}/image/upload`,
    input,
  );
}
export async function confirmDestinationImage(id: string) {
  return apiClient.post<Destination>(`/masters/destinations/${id}/image/confirm`);
}
export async function destinationImageUrl(id: string, imageId?: string) {
  return apiClient.get<{ url: string; expiresInSeconds: number }>(
    `/masters/destinations/${id}/image/download-url${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
  );
}
export async function deleteDestinationImage(id: string, imageId?: string) {
  return apiClient.delete<{ deleted: true }>(
    `/masters/destinations/${id}/image${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
  );
}
export const reorderDestinationImages = (id: string, imageIds: string[]) =>
  apiClient.patch<Destination>(`/masters/destinations/${id}/images/order`, { imageIds });

// ---------------------------------------------------------------------------
// Hotels
// ---------------------------------------------------------------------------

export interface HotelRoomType {
  id: string;
  hotelId: string;
  name: string;
  code: string | null;
  description: string | null;
  maxAdults: number | null;
  maxChildren: number | null;
  maxOccupancy: number | null;
  bedType: string | null;
  numberOfBeds: number | null;
  roomSize: string | null;
  viewType: string | null;
  baseCost?: number | null;
  sellingPrice?: number | null;
  extraBedPrice?: number | null;
  childWithoutBedPrice?: number | null;
  currency: string;
  taxPercentage?: number | null;
  internalNotes: string | null;
  status: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  seasons?: HotelRoomTypeSeason[];
  monthPrices?: HotelRoomTypeMonthPrice[];
}

export interface HotelMealPlan {
  id: string;
  hotelId: string;
  name: string;
  code: string | null;
  type: string;
  description: string | null;
  baseCost?: number | null;
  sellingPrice?: number | null;
  currency: string;
  internalNotes: string | null;
  status: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  seasons?: HotelMealPlanSeason[];
  monthPrices?: HotelMealPlanMonthPrice[];
}

export interface HotelSummary extends MasterVisibilityMeta {
  id: string;
  name: string;
  starCategory: number | null;
  starRating: number | null;
  price?: number | null;
  currency?: string | null;
  status: string;
  isDefaultForCity: boolean;
  isFeatured: boolean;
  hasImage: boolean;
  images: MasterImageMeta[];
  updatedAt: string;
  createdAt: string;
  destination: { id: string; name: string };
  city: { id: string; name: string };
  _count?: { roomTypes: number; mealPlans: number };
  seasons?: HotelSeason[];
}

export interface HotelSeason {
  id: string;
  hotelId: string;
  name: string;
  startDate: string;
  endDate: string;
  price: number | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface HotelRoomTypeSeason {
  id: string;
  hotelRoomTypeId: string;
  name: string;
  startDate: string;
  endDate: string;
  price: number | null;
  extraBedPrice?: number | null;
  childWithoutBedPrice?: number | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface HotelMealPlanSeason {
  id: string;
  hotelMealPlanId: string;
  name: string;
  startDate: string;
  endDate: string;
  price: number | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface HotelMonthPrice {
  id: string;
  month: number;
  price: number | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface HotelRoomTypeMonthPrice {
  id: string;
  hotelRoomTypeId: string;
  month: number;
  price: number | null;
  extraBedPrice?: number | null;
  childWithoutBedPrice?: number | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface HotelMealPlanMonthPrice {
  id: string;
  hotelMealPlanId: string;
  month: number;
  price: number | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface Hotel extends Omit<HotelSummary, 'destination' | 'city'> {
  destinationId: string;
  cityId: string;
  propertyType: string | null;
  address: string | null;
  landmark: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  reviewLink: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  description: string | null;
  amenities: string | null;
  internalNotes: string | null;
  externalCode: string | null;
  sortOrder: number;
  imageFileName: string | null;
  imageMimeType: string | null;
  imageFileSize: number | null;
  imageConfirmedAt: string | null;
  destination: { id: string; name: string; countryCode?: string; countryName?: string };
  city: { id: string; name: string; airportCode?: string | null };
  createdBy: { id: string; fullName: string };
  roomTypes: HotelRoomType[];
  mealPlans: HotelMealPlan[];
  seasons?: HotelSeason[];
  monthPrices?: HotelMonthPrice[];
}

const hotelKeys = {
  all: ['masters', 'hotels'] as const,
  one: (id: string) => ['masters', 'hotels', id] as const,
};

export function useHotels(params = new URLSearchParams()) {
  const query = masterListQuery(params);
  return useQuery({
    queryKey: [...hotelKeys.all, query],
    queryFn: ({ signal }) =>
      apiClient.get<HotelPage>(`/masters/hotels${query ? `?${query}` : ''}`, signal),
  });
}
/**
 * Complete active hotel option set for the manual master picker — see
 * {@link useAllCities}. The builder used to request a single 100-row page, so a
 * hotel beyond that page could not be selected and typing its exact name left
 * the row unlinked as free text. Paging the whole (tenant-visible, ACTIVE)
 * result set makes every eligible hotel selectable while keeping the same
 * filters and permissions as {@link useHotels}.
 */
export function useAllHotels(params = new URLSearchParams()) {
  const filterKey = masterFilterKey(params);
  return useQuery({
    queryKey: [...hotelKeys.all, 'all', filterKey],
    queryFn: ({ signal }) =>
      fetchAllMasterPages<HotelSummary>('/masters/hotels', new URLSearchParams(filterKey), signal),
  });
}

export interface HotelPrefillPool {
  data: HotelSummary[];
  /** True while any destination query is still on its first load. */
  isPending: boolean;
  isError: boolean;
}

/**
 * Complete, destination-scoped hotel pool for automatic default prefill.
 *
 * One query per relevant destination (`destinationId` filter), each paged to
 * completion. This replaces relying on the first 100 newest hotels: a default
 * hotel outside that window is still retrieved, and unrelated destinations are
 * never fetched. Visibility (tenant + system-global) and ACTIVE status are
 * enforced by the same list endpoint the Hotel Master screen uses.
 *
 * The combined result is structurally shared by React Query, so consumers can
 * depend on `data` without re-running effects on every render.
 */
export function useHotelsForDestinations(destinationIds: readonly string[]) {
  const ids = useMemo(
    () => [...new Set(destinationIds.map((id) => id.trim()).filter(Boolean))].sort(),
    [destinationIds],
  );
  return useQueries({
    queries: ids.map((destinationId) => ({
      queryKey: [...hotelKeys.all, 'byDestination', destinationId] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchAllMasterPages<HotelSummary>(
          '/masters/hotels',
          new URLSearchParams({ status: 'ACTIVE', destinationId }),
          signal,
        ),
      enabled: Boolean(destinationId),
    })),
    combine: (results): HotelPrefillPool => {
      const byId = new Map<string, HotelSummary>();
      for (const result of results) {
        for (const row of result.data?.data ?? []) {
          if (!byId.has(row.id)) byId.set(row.id, row);
        }
      }
      return {
        data: [...byId.values()],
        isPending: results.some((result) => result.isPending),
        isError: results.some((result) => result.isError),
      };
    },
  });
}

export function useHotel(id?: string) {
  return useQuery({
    queryKey: hotelKeys.one(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<Hotel>(`/masters/hotels/${id}`, signal),
    enabled: Boolean(id),
  });
}
const invalidateHotel = (client: ReturnType<typeof useQueryClient>, id?: string) => {
  void client.invalidateQueries({ queryKey: hotelKeys.all });
  if (id) void client.invalidateQueries({ queryKey: hotelKeys.one(id) });
};
export function useCreateHotel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: HotelInput) => apiClient.post<Hotel>('/masters/hotels', input),
    onSuccess: () => invalidateHotel(client),
  });
}
export function useUpdateHotel(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: HotelUpdateInput) => apiClient.patch<Hotel>(`/masters/hotels/${id}`, input),
    onSuccess: () => invalidateHotel(client, id),
  });
}
export function useDeleteHotel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<Hotel>(`/masters/hotels/${id}`),
    onSuccess: (_, id) => invalidateHotel(client, id),
  });
}
export function useCreateRoomType(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: HotelRoomTypeInput) =>
      apiClient.post<Hotel>(`/masters/hotels/${hotelId}/room-types`, input),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useUpdateRoomType(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: HotelRoomTypeUpdateInput }) =>
      apiClient.patch<Hotel>(`/masters/hotels/${hotelId}/room-types/${id}`, input),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useCreateMealPlan(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: HotelMealPlanInput) =>
      apiClient.post<Hotel>(`/masters/hotels/${hotelId}/meal-plans`, input),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useCreateHotelSeason(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: HotelSeasonInput) =>
      apiClient.post<Hotel>(`/masters/hotels/${hotelId}/seasons`, input),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useUpdateHotelSeason(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: HotelSeasonUpdateInput }) =>
      apiClient.patch<Hotel>(`/masters/hotels/${hotelId}/seasons/${id}`, input),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useDeleteHotelSeason(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ deleted: true }>(`/masters/hotels/${hotelId}/seasons/${id}`),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useCreateRoomTypeSeason(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      roomTypeId,
      input,
    }: {
      roomTypeId: string;
      input: HotelRoomTypeSeasonInput;
    }) => apiClient.post<Hotel>(`/masters/hotels/${hotelId}/room-types/${roomTypeId}/seasons`, input),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useUpdateRoomTypeSeason(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      roomTypeId,
      id,
      input,
    }: {
      roomTypeId: string;
      id: string;
      input: HotelRoomTypeSeasonUpdateInput;
    }) =>
      apiClient.patch<Hotel>(
        `/masters/hotels/${hotelId}/room-types/${roomTypeId}/seasons/${id}`,
        input,
      ),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useDeleteRoomTypeSeason(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ roomTypeId, id }: { roomTypeId: string; id: string }) =>
      apiClient.delete<{ deleted: true }>(
        `/masters/hotels/${hotelId}/room-types/${roomTypeId}/seasons/${id}`,
      ),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useCreateMealPlanSeason(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      mealPlanId,
      input,
    }: {
      mealPlanId: string;
      input: HotelMealPlanSeasonInput;
    }) =>
      apiClient.post<Hotel>(`/masters/hotels/${hotelId}/meal-plans/${mealPlanId}/seasons`, input),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useUpdateMealPlanSeason(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      mealPlanId,
      id,
      input,
    }: {
      mealPlanId: string;
      id: string;
      input: HotelMealPlanSeasonUpdateInput;
    }) =>
      apiClient.patch<Hotel>(
        `/masters/hotels/${hotelId}/meal-plans/${mealPlanId}/seasons/${id}`,
        input,
      ),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useDeleteMealPlanSeason(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ mealPlanId, id }: { mealPlanId: string; id: string }) =>
      apiClient.delete<{ deleted: true }>(
        `/masters/hotels/${hotelId}/meal-plans/${mealPlanId}/seasons/${id}`,
      ),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useCreateHotelMonthPrice(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: HotelMonthPriceInput) =>
      apiClient.post<Hotel>(`/masters/hotels/${hotelId}/month-prices`, input),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useUpdateHotelMonthPrice(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: HotelMonthPriceUpdateInput }) =>
      apiClient.patch<Hotel>(`/masters/hotels/${hotelId}/month-prices/${id}`, input),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useDeleteHotelMonthPrice(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ deleted: true }>(`/masters/hotels/${hotelId}/month-prices/${id}`),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useCreateRoomTypeMonthPrice(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      roomTypeId,
      input,
    }: {
      roomTypeId: string;
      input: HotelRoomTypeMonthPriceInput;
    }) =>
      apiClient.post<Hotel>(
        `/masters/hotels/${hotelId}/room-types/${roomTypeId}/month-prices`,
        input,
      ),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useUpdateRoomTypeMonthPrice(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      roomTypeId,
      id,
      input,
    }: {
      roomTypeId: string;
      id: string;
      input: HotelRoomTypeMonthPriceUpdateInput;
    }) =>
      apiClient.patch<Hotel>(
        `/masters/hotels/${hotelId}/room-types/${roomTypeId}/month-prices/${id}`,
        input,
      ),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useDeleteRoomTypeMonthPrice(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ roomTypeId, id }: { roomTypeId: string; id: string }) =>
      apiClient.delete<{ deleted: true }>(
        `/masters/hotels/${hotelId}/room-types/${roomTypeId}/month-prices/${id}`,
      ),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useCreateMealPlanMonthPrice(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      mealPlanId,
      input,
    }: {
      mealPlanId: string;
      input: HotelMealPlanMonthPriceInput;
    }) =>
      apiClient.post<Hotel>(
        `/masters/hotels/${hotelId}/meal-plans/${mealPlanId}/month-prices`,
        input,
      ),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useUpdateMealPlanMonthPrice(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      mealPlanId,
      id,
      input,
    }: {
      mealPlanId: string;
      id: string;
      input: HotelMealPlanMonthPriceUpdateInput;
    }) =>
      apiClient.patch<Hotel>(
        `/masters/hotels/${hotelId}/meal-plans/${mealPlanId}/month-prices/${id}`,
        input,
      ),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useDeleteMealPlanMonthPrice(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ mealPlanId, id }: { mealPlanId: string; id: string }) =>
      apiClient.delete<{ deleted: true }>(
        `/masters/hotels/${hotelId}/meal-plans/${mealPlanId}/month-prices/${id}`,
      ),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
export function useUpdateMealPlan(hotelId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: HotelMealPlanUpdateInput }) =>
      apiClient.patch<Hotel>(`/masters/hotels/${hotelId}/meal-plans/${id}`, input),
    onSuccess: () => invalidateHotel(client, hotelId),
  });
}
/** Non-hook create helpers, used when persisting draft rows right after a hotel is created. */
export async function createRoomType(hotelId: string, input: HotelRoomTypeInput) {
  return apiClient.post<Hotel>(`/masters/hotels/${hotelId}/room-types`, input);
}
export async function createMealPlan(hotelId: string, input: HotelMealPlanInput) {
  return apiClient.post<Hotel>(`/masters/hotels/${hotelId}/meal-plans`, input);
}
export async function createHotelSeason(hotelId: string, input: HotelSeasonInput) {
  return apiClient.post<Hotel>(`/masters/hotels/${hotelId}/seasons`, input);
}
export async function createRoomTypeSeason(
  hotelId: string,
  roomTypeId: string,
  input: HotelRoomTypeSeasonInput,
) {
  return apiClient.post<Hotel>(`/masters/hotels/${hotelId}/room-types/${roomTypeId}/seasons`, input);
}
export async function createMealPlanSeason(
  hotelId: string,
  mealPlanId: string,
  input: HotelMealPlanSeasonInput,
) {
  return apiClient.post<Hotel>(`/masters/hotels/${hotelId}/meal-plans/${mealPlanId}/seasons`, input);
}
export async function createHotelMonthPrice(hotelId: string, input: HotelMonthPriceInput) {
  return apiClient.post<Hotel>(`/masters/hotels/${hotelId}/month-prices`, input);
}
export async function createRoomTypeMonthPrice(
  hotelId: string,
  roomTypeId: string,
  input: HotelRoomTypeMonthPriceInput,
) {
  return apiClient.post<Hotel>(
    `/masters/hotels/${hotelId}/room-types/${roomTypeId}/month-prices`,
    input,
  );
}
export async function createMealPlanMonthPrice(
  hotelId: string,
  mealPlanId: string,
  input: HotelMealPlanMonthPriceInput,
) {
  return apiClient.post<Hotel>(
    `/masters/hotels/${hotelId}/meal-plans/${mealPlanId}/month-prices`,
    input,
  );
}
export async function updateHotelSeason(
  hotelId: string,
  seasonId: string,
  input: HotelSeasonUpdateInput,
) {
  return apiClient.patch<Hotel>(`/masters/hotels/${hotelId}/seasons/${seasonId}`, input);
}
export async function deleteHotelSeason(hotelId: string, seasonId: string) {
  return apiClient.delete<{ deleted: true }>(`/masters/hotels/${hotelId}/seasons/${seasonId}`);
}
export async function approveHotelImage(id: string, input: HotelImageUploadInput) {
  return apiClient.post<{ uploadUrl: string; expiresInSeconds: number }>(
    `/masters/hotels/${id}/image/upload`,
    input,
  );
}
export async function confirmHotelImage(id: string) {
  return apiClient.post<Hotel>(`/masters/hotels/${id}/image/confirm`);
}
export async function hotelImageUrl(id: string, imageId?: string) {
  return apiClient.get<{ url: string; expiresInSeconds: number }>(
    `/masters/hotels/${id}/image/download-url${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
  );
}
export async function deleteHotelImage(id: string, imageId?: string) {
  return apiClient.delete<{ deleted: true }>(
    `/masters/hotels/${id}/image${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
  );
}
export const reorderHotelImages = (id: string, imageIds: string[]) =>
  apiClient.patch<Hotel>(`/masters/hotels/${id}/images/order`, { imageIds });

// ---------------------------------------------------------------------------
// Airlines
// ---------------------------------------------------------------------------

export interface Airline extends MasterVisibilityMeta {
  id: string;
  name: string;
  iataCode: string | null;
  icaoCode: string | null;
  countryCode: string | null;
  countryName: string | null;
  website: string | null;
  internalNotes: string | null;
  status: string;
  hasLogo: boolean;
  logoFileName: string | null;
  logoMimeType: string | null;
  logoConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string };
}

const airlineKeys = {
  all: ['masters', 'airlines'] as const,
  one: (id: string) => ['masters', 'airlines', id] as const,
};

export function useAirlines(params = new URLSearchParams()) {
  const query = masterListQuery(params);
  return useQuery({
    queryKey: [...airlineKeys.all, query],
    queryFn: ({ signal }) =>
      apiClient.get<Page<Airline>>(`/masters/airlines${query ? `?${query}` : ''}`, signal),
  });
}
export function useAirline(id?: string) {
  return useQuery({
    queryKey: airlineKeys.one(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<Airline>(`/masters/airlines/${id}`, signal),
    enabled: Boolean(id),
  });
}
const invalidateAirline = (client: ReturnType<typeof useQueryClient>, id?: string) => {
  void client.invalidateQueries({ queryKey: airlineKeys.all });
  if (id) void client.invalidateQueries({ queryKey: airlineKeys.one(id) });
};
export function useCreateAirline() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AirlineInput) => apiClient.post<Airline>('/masters/airlines', input),
    onSuccess: () => invalidateAirline(client),
  });
}
export function useUpdateAirline(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AirlineUpdateInput) =>
      apiClient.patch<Airline>(`/masters/airlines/${id}`, input),
    onSuccess: () => invalidateAirline(client, id),
  });
}
export function useDeleteAirline() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<Airline>(`/masters/airlines/${id}`),
    onSuccess: (_, id) => invalidateAirline(client, id),
  });
}
export async function approveAirlineLogo(id: string, input: AirlineLogoUploadInput) {
  return apiClient.post<{ uploadUrl: string; expiresInSeconds: number }>(
    `/masters/airlines/${id}/logo/upload`,
    input,
  );
}
export async function confirmAirlineLogo(id: string) {
  return apiClient.post<Airline>(`/masters/airlines/${id}/logo/confirm`);
}
/** Server-side import of a remote airline logo into Airline Master storage. */
export async function importAirlineLogoFromUrl(id: string, url: string) {
  return apiClient.post<Airline>(`/masters/airlines/${id}/logo/import`, { url });
}
export async function airlineLogoUrl(id: string) {
  return apiClient.get<{ url: string; expiresInSeconds: number }>(
    `/masters/airlines/${id}/logo/download-url`,
  );
}
export async function deleteAirlineLogo(id: string) {
  return apiClient.delete<{ deleted: true }>(`/masters/airlines/${id}/logo`);
}

// ---------------------------------------------------------------------------
// Cruises
// ---------------------------------------------------------------------------

export interface CruiseRoomType {
  id: string;
  name: string;
  description: string | null;
  /** Absent when the viewer lacks the costing permission. */
  price?: number | null;
  currency?: string;
  status: string;
  sortOrder: number;
}

export interface Cruise extends MasterVisibilityMeta {
  id: string;
  name: string;
  description: string | null;
  price?: number | null;
  currency?: string | null;
  status: string;
  hasImage: boolean;
  images: MasterImageMeta[];
  imageFileName: string | null;
  imageMimeType: string | null;
  imageConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string };
  updatedBy?: { id: string; fullName: string } | null;
  roomTypes?: CruiseRoomType[];
  /** List responses only. */
  roomTypeCount?: number;
  activeRoomTypeCount?: number;
  priceRange?: { min: number; max: number } | null;
}

const cruiseKeys = {
  all: ['masters', 'cruises'] as const,
  one: (id: string) => ['masters', 'cruises', id] as const,
};

export function useCruises(params = new URLSearchParams()) {
  const query = masterListQuery(params);
  return useQuery({
    queryKey: [...cruiseKeys.all, query],
    queryFn: ({ signal }) =>
      apiClient.get<Page<Cruise>>(`/masters/cruises${query ? `?${query}` : ''}`, signal),
  });
}
export function useCruise(id?: string) {
  return useQuery({
    queryKey: cruiseKeys.one(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<Cruise>(`/masters/cruises/${id}`, signal),
    enabled: Boolean(id),
  });
}
const invalidateCruise = (client: ReturnType<typeof useQueryClient>, id?: string) => {
  void client.invalidateQueries({ queryKey: cruiseKeys.all });
  if (id) void client.invalidateQueries({ queryKey: cruiseKeys.one(id) });
};
export function useCreateCruise() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CruiseInput) => apiClient.post<Cruise>('/masters/cruises', input),
    onSuccess: () => invalidateCruise(client),
  });
}
export function useUpdateCruise(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CruiseUpdateInput) =>
      apiClient.patch<Cruise>(`/masters/cruises/${id}`, input),
    onSuccess: () => invalidateCruise(client, id),
  });
}
export function useDeleteCruise() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<Cruise>(`/masters/cruises/${id}`),
    onSuccess: (_, id) => invalidateCruise(client, id),
  });
}
export async function approveCruiseImage(id: string, input: CruiseImageUploadInput) {
  return apiClient.post<{ uploadUrl: string; expiresInSeconds: number }>(
    `/masters/cruises/${id}/image/upload`,
    input,
  );
}
export async function confirmCruiseImage(id: string) {
  return apiClient.post<Cruise>(`/masters/cruises/${id}/image/confirm`);
}
export async function cruiseImageUrl(id: string, imageId?: string) {
  return apiClient.get<{ url: string; expiresInSeconds: number }>(
    `/masters/cruises/${id}/image/download-url${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
  );
}
export async function deleteCruiseImage(id: string, imageId?: string) {
  return apiClient.delete<{ deleted: true }>(
    `/masters/cruises/${id}/image${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
  );
}
export const reorderCruiseImages = (id: string, imageIds: string[]) =>
  apiClient.patch<Cruise>(`/masters/cruises/${id}/images/order`, { imageIds });

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export interface Vehicle extends MasterVisibilityMeta {
  id: string;
  name: string;
  vehicleType: string;
  capacity: number | null;
  /** Assigned destinations (0–10), in selection order. Absent on legacy payloads. */
  destinations?: Array<{ id: string; name: string }>;
  description: string | null;
  price?: number | null;
  currency?: string | null;
  status: string;
  hasImage: boolean;
  images: MasterImageMeta[];
  imageFileName: string | null;
  imageMimeType: string | null;
  imageConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string };
  updatedBy?: { id: string; fullName: string } | null;
}

const vehicleKeys = {
  all: ['masters', 'vehicles'] as const,
  one: (id: string) => ['masters', 'vehicles', id] as const,
  types: ['masters', 'vehicles', 'types'] as const,
};

export function useVehicles(params = new URLSearchParams()) {
  const query = masterListQuery(params);
  return useQuery({
    queryKey: [...vehicleKeys.all, query],
    queryFn: ({ signal }) =>
      apiClient.get<Page<Vehicle>>(`/masters/vehicles${query ? `?${query}` : ''}`, signal),
  });
}
/** Distinct types already in use, powering the list's type dropdown. */
export function useVehicleTypes() {
  return useQuery({
    queryKey: vehicleKeys.types,
    queryFn: ({ signal }) =>
      apiClient.get<{ vehicleTypes: string[] }>('/masters/vehicles/types', signal),
  });
}
export function useVehicle(id?: string) {
  return useQuery({
    queryKey: vehicleKeys.one(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<Vehicle>(`/masters/vehicles/${id}`, signal),
    enabled: Boolean(id),
  });
}
const invalidateVehicle = (client: ReturnType<typeof useQueryClient>, id?: string) => {
  void client.invalidateQueries({ queryKey: vehicleKeys.all });
  if (id) void client.invalidateQueries({ queryKey: vehicleKeys.one(id) });
};
export function useCreateVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: VehicleInput) => apiClient.post<Vehicle>('/masters/vehicles', input),
    onSuccess: () => invalidateVehicle(client),
  });
}
export function useUpdateVehicle(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: VehicleUpdateInput) =>
      apiClient.patch<Vehicle>(`/masters/vehicles/${id}`, input),
    onSuccess: () => invalidateVehicle(client, id),
  });
}
export function useDeleteVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<Vehicle>(`/masters/vehicles/${id}`),
    onSuccess: (_, id) => invalidateVehicle(client, id),
  });
}
export async function approveVehicleImage(id: string, input: VehicleImageUploadInput) {
  return apiClient.post<{ uploadUrl: string; expiresInSeconds: number }>(
    `/masters/vehicles/${id}/image/upload`,
    input,
  );
}
export async function confirmVehicleImage(id: string) {
  return apiClient.post<Vehicle>(`/masters/vehicles/${id}/image/confirm`);
}
export async function vehicleImageUrl(id: string, imageId?: string) {
  return apiClient.get<{ url: string; expiresInSeconds: number }>(
    `/masters/vehicles/${id}/image/download-url${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
  );
}
export async function deleteVehicleImage(id: string, imageId?: string) {
  return apiClient.delete<{ deleted: true }>(
    `/masters/vehicles/${id}/image${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
  );
}
export const reorderVehicleImages = (id: string, imageIds: string[]) =>
  apiClient.patch<Vehicle>(`/masters/vehicles/${id}/images/order`, { imageIds });

// ---------------------------------------------------------------------------
// Sightseeing
// ---------------------------------------------------------------------------

export interface Sightseeing extends MasterVisibilityMeta {
  id: string;
  title: string;
  sequence: number;
  estimatedHours: number | null;
  suggestedStartTime: string | null;
  description: string | null;
  remarks: string | null;
  pricing?: Array<{ label: string; price: number | null; currency?: string | null }> | null;
  mealDefaults?: SightseeingMealDefaults | null;
  status: string;
  hasImage: boolean;
  images: MasterImageMeta[];
  imageFileName: string | null;
  imageMimeType: string | null;
  imageConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  destination: { id: string; name: string; countryCode?: string; countryName?: string };
  city: { id: string; name: string; airportCode?: string | null };
  createdBy: { id: string; fullName: string };
  updatedBy?: { id: string; fullName: string } | null;
}

export interface SightseeingSummary {
  totalAttractions: number;
  destinations: number;
  citiesCovered: number;
  withImages: number;
}

const sightseeingKeys = {
  all: ['masters', 'sightseeing'] as const,
  one: (id: string) => ['masters', 'sightseeing', id] as const,
  summary: ['masters', 'sightseeing', 'summary'] as const,
  presentations: (ids: string) => ['masters', 'sightseeing', 'presentations', ids] as const,
  activities: (destination: string, city: string) =>
    ['masters', 'sightseeing', 'activities', destination, city] as const,
};

export type SightseeingPresentationMap = Record<
  string,
  {
    imageUrl: string | null;
    images: Array<{ id: string; url: string }>;
  }
>;

/** Batch short-lived display URLs for sightseeing master ids (deduped). */
export async function sightseeingPresentations(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return {} as SightseeingPresentationMap;
  return apiClient.get<SightseeingPresentationMap>(
    `/masters/sightseeing/presentations?ids=${encodeURIComponent(unique.join(','))}`,
  );
}

/**
 * Resolve current display URLs for a set of sightseeing master ids in one
 * request. Callers that keep the result on screen for a long time (the Live
 * Weblink Preview) pass `refetchInterval` so the short-lived signed URLs are
 * re-minted before they expire; the builder editor leaves it unset.
 */
export function useSightseeingPresentations(
  ids: Array<string | null | undefined>,
  options?: { refetchInterval?: number },
) {
  const unique = useMemo(() => [...new Set(ids.filter((id): id is string => Boolean(id)))], [ids]);
  const key = useMemo(() => [...unique].sort().join(','), [unique]);
  return useQuery({
    queryKey: sightseeingKeys.presentations(key),
    queryFn: () => sightseeingPresentations(unique),
    enabled: unique.length > 0,
    staleTime: 60 * 1000,
    ...(options?.refetchInterval ? { refetchInterval: options.refetchInterval } : {}),
  });
}

export interface SightseeingActivity {
  id: string;
  title: string;
  sequence: number;
  estimatedHours: number | null;
  suggestedStartTime: string | null;
  description: string | null;
  pricing?: Array<{ label: string; price: number | null }> | null;
  mealDefaults?: SightseeingMealDefaults | null;
  images: Array<MasterImageMeta & { url?: string | null }>;
  destination: { id: string; name: string };
  city: { id: string; name: string };
}

export interface SightseeingActivities {
  destination: { id: string; name: string } | null;
  city: { id: string; name: string } | null;
  activities: SightseeingActivity[];
}

/**
 * Quotation builder sightseeing dropdown feed. Destination/city are optional
 * narrowers; with neither supplied the feed returns every tenant-visible active
 * sightseeing record so the builder can search across all destinations/cities.
 * Lightweight, permission-compatible with quotation editing.
 */
export function useSightseeingActivities(destination?: string, city?: string) {
  const params = new URLSearchParams();
  if (destination) params.set('destination', destination);
  if (city) params.set('city', city);
  const query = params.toString();
  return useQuery({
    queryKey: sightseeingKeys.activities(destination ?? '', city ?? ''),
    queryFn: ({ signal }) =>
      apiClient.get<SightseeingActivities>(
        `/masters/sightseeing/activities${query ? `?${query}` : ''}`,
        signal,
      ),
  });
}

export function useSightseeingList(params = new URLSearchParams()) {
  const query = masterListQuery(params);
  return useQuery({
    queryKey: [...sightseeingKeys.all, query],
    queryFn: ({ signal }) =>
      apiClient.get<Page<Sightseeing>>(`/masters/sightseeing${query ? `?${query}` : ''}`, signal),
  });
}
/**
 * Complete sightseeing result set for the grouped master list. Follows the
 * server's pagination metadata until every eligible record for the current
 * search/destination/city/status filters is loaded — no total-record cap.
 * Failed pages reject (never silent partial data); rows dedup by master id;
 * rapid filter changes get distinct query keys and abort superseded fetches.
 */
export function useSightseeingListAll(params = new URLSearchParams()) {
  const filterKey = masterFilterKey(params);
  return useQuery({
    queryKey: [...sightseeingKeys.all, 'all', filterKey],
    queryFn: ({ signal }) =>
      fetchAllMasterPages<Sightseeing>(
        '/masters/sightseeing',
        new URLSearchParams(filterKey),
        signal,
      ),
  });
}
/** Counts for the reference's Summary Statistics strip. */
export function useSightseeingSummary(params = new URLSearchParams()) {
  const query = masterListQuery(params);
  return useQuery({
    queryKey: [...sightseeingKeys.summary, query],
    queryFn: ({ signal }) =>
      apiClient.get<SightseeingSummary>(
        `/masters/sightseeing/summary${query ? `?${query}` : ''}`,
        signal,
      ),
  });
}
export function useSightseeing(id?: string) {
  return useQuery({
    queryKey: sightseeingKeys.one(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<Sightseeing>(`/masters/sightseeing/${id}`, signal),
    enabled: Boolean(id),
  });
}
const invalidateSightseeing = (client: ReturnType<typeof useQueryClient>, id?: string) => {
  void client.invalidateQueries({ queryKey: sightseeingKeys.all });
  if (id) void client.invalidateQueries({ queryKey: sightseeingKeys.one(id) });
};
export function useCreateSightseeing() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SightseeingInput) =>
      apiClient.post<Sightseeing>('/masters/sightseeing', input),
    onSuccess: () => invalidateSightseeing(client),
  });
}
export function useUpdateSightseeing(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SightseeingUpdateInput) =>
      apiClient.patch<Sightseeing>(`/masters/sightseeing/${id}`, input),
    onSuccess: () => invalidateSightseeing(client, id),
  });
}
export function useDeleteSightseeing() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<Sightseeing>(`/masters/sightseeing/${id}`),
    onSuccess: (_, id) => invalidateSightseeing(client, id),
  });
}
/** Move a row up or down within its city group. */
export function useReorderSightseeing() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: 'UP' | 'DOWN' }) =>
      apiClient.patch<Sightseeing>(`/masters/sightseeing/${id}/reorder`, { direction }),
    onSuccess: (_, variables) => invalidateSightseeing(client, variables.id),
  });
}
export async function approveSightseeingImage(id: string, input: SightseeingImageUploadInput) {
  return apiClient.post<{ uploadUrl: string; expiresInSeconds: number }>(
    `/masters/sightseeing/${id}/image/upload`,
    input,
  );
}
export async function confirmSightseeingImage(id: string) {
  return apiClient.post<Sightseeing>(`/masters/sightseeing/${id}/image/confirm`);
}
export async function sightseeingImageUrl(id: string, imageId?: string) {
  return apiClient.get<{ url: string; expiresInSeconds: number }>(
    `/masters/sightseeing/${id}/image/download-url${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
  );
}
export async function deleteSightseeingImage(id: string, imageId?: string) {
  return apiClient.delete<{ deleted: true }>(
    `/masters/sightseeing/${id}/image${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
  );
}
export const reorderSightseeingImages = (id: string, imageIds: string[]) =>
  apiClient.patch<Sightseeing>(`/masters/sightseeing/${id}/images/order`, { imageIds });

// ---------------------------------------------------------------------------
// Add-On Services
// ---------------------------------------------------------------------------

export interface AddOnServiceDestinationLink {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface AddOnServicePricingEntry {
  id: string;
  label: string;
  price: number | null;
  currency: string;
}

export interface AddOnService extends MasterVisibilityMeta {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  pricingBasis: string | null;
  /** Repeatable pricing options (legacy single price arrives as one entry). */
  pricing: AddOnServicePricingEntry[];
  destinations: AddOnServiceDestinationLink[];
  status: string;
  hasImage: boolean;
  images: MasterImageMeta[];
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string };
  updatedBy?: { id: string; fullName: string } | null;
}

export async function approveAddOnServiceImage(id: string, input: AddOnServiceImageUploadInput) {
  return apiClient.post<{ uploadUrl: string; expiresInSeconds: number }>(
    `/masters/add-on-services/${id}/image/upload`,
    input,
  );
}
export async function confirmAddOnServiceImage(id: string) {
  return apiClient.post<AddOnService>(`/masters/add-on-services/${id}/image/confirm`);
}
export async function addOnServiceImageUrl(id: string, imageId?: string) {
  return apiClient.get<{ url: string; expiresInSeconds: number }>(
    `/masters/add-on-services/${id}/image/download-url${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
  );
}
export async function deleteAddOnServiceImage(id: string, imageId?: string) {
  return apiClient.delete<{ deleted: true }>(
    `/masters/add-on-services/${id}/image${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
  );
}
export const reorderAddOnServiceImages = (id: string, imageIds: string[]) =>
  apiClient.patch<AddOnService>(`/masters/add-on-services/${id}/images/order`, { imageIds });

const addOnServiceKeys = {
  all: ['masters', 'add-on-services'] as const,
  one: (id: string) => ['masters', 'add-on-services', id] as const,
};

export function useAddOnServices(params = new URLSearchParams()) {
  const query = masterListQuery(params);
  return useQuery({
    queryKey: [...addOnServiceKeys.all, query],
    queryFn: ({ signal }) =>
      apiClient.get<Page<AddOnService>>(
        `/masters/add-on-services${query ? `?${query}` : ''}`,
        signal,
      ),
  });
}
export function useAddOnService(id?: string) {
  return useQuery({
    queryKey: addOnServiceKeys.one(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<AddOnService>(`/masters/add-on-services/${id}`, signal),
    enabled: Boolean(id),
  });
}
const invalidateAddOnService = (client: ReturnType<typeof useQueryClient>, id?: string) => {
  void client.invalidateQueries({ queryKey: addOnServiceKeys.all });
  if (id) void client.invalidateQueries({ queryKey: addOnServiceKeys.one(id) });
};
export function useCreateAddOnService() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AddOnServiceInput) =>
      apiClient.post<AddOnService>('/masters/add-on-services', input),
    onSuccess: () => invalidateAddOnService(client),
  });
}
export function useUpdateAddOnService(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AddOnServiceUpdateInput) =>
      apiClient.patch<AddOnService>(`/masters/add-on-services/${id}`, input),
    onSuccess: () => invalidateAddOnService(client, id),
  });
}
export function useDeleteAddOnService() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<AddOnService>(`/masters/add-on-services/${id}`),
    onSuccess: (_, id) => invalidateAddOnService(client, id),
  });
}
// ---------------------------------------------------------------------------
// Visa Types
// ---------------------------------------------------------------------------

export interface VisaTypeSection {
  id: string;
  visaTypeId: string;
  title: string;
  content: string;
  sequence: number;
}
export interface VisaType extends MasterVisibilityMeta {
  id: string;
  destinationId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  destination: { id: string; name: string; countryCode?: string; countryName?: string };
  sections: VisaTypeSection[];
  _count: { sections: number };
  createdBy: { id: string; fullName: string };
  updatedBy?: { id: string; fullName: string } | null;
}

const visaTypeKeys = {
  all: ['masters', 'visa-types'] as const,
  one: (id: string) => ['masters', 'visa-types', id] as const,
};
export function useVisaTypes(params = new URLSearchParams()) {
  const query = masterListQuery(params);
  return useQuery({
    queryKey: [...visaTypeKeys.all, query],
    queryFn: ({ signal }) =>
      apiClient.get<Page<VisaType>>(`/masters/visa-types${query ? `?${query}` : ''}`, signal),
  });
}
export function useVisaType(id?: string) {
  return useQuery({
    queryKey: visaTypeKeys.one(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<VisaType>(`/masters/visa-types/${id}`, signal),
    enabled: Boolean(id),
  });
}
const invalidateVisaType = (client: ReturnType<typeof useQueryClient>, id?: string) => {
  void client.invalidateQueries({ queryKey: visaTypeKeys.all });
  if (id) void client.invalidateQueries({ queryKey: visaTypeKeys.one(id) });
};
export function useCreateVisaType() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: VisaTypeInput) => apiClient.post<VisaType>('/masters/visa-types', input),
    onSuccess: () => invalidateVisaType(client),
  });
}
export function useUpdateVisaType(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: VisaTypeUpdateInput) =>
      apiClient.patch<VisaType>(`/masters/visa-types/${id}`, input),
    onSuccess: () => invalidateVisaType(client, id),
  });
}
export function useDeleteVisaType() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<VisaType>(`/masters/visa-types/${id}`),
    onSuccess: (_, id) => invalidateVisaType(client, id),
  });
}

// ---------------------------------------------------------------------------
// Testimonials
// ---------------------------------------------------------------------------

export interface Testimonial extends MasterVisibilityMeta {
  id: string;
  clientName: string | null;
  destinationName: string;
  description: string;
  isVisible: boolean;
  status: string;
  hasImage: boolean;
  images: MasterImageMeta[];
  imageFileName: string | null;
  imageMimeType: string | null;
  imageConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string };
  updatedBy?: { id: string; fullName: string } | null;
}

const testimonialKeys = {
  all: ['masters', 'testimonials'] as const,
  one: (id: string) => ['masters', 'testimonials', id] as const,
};
export function useTestimonials(params = new URLSearchParams()) {
  const query = masterListQuery(params);
  return useQuery({
    queryKey: [...testimonialKeys.all, query],
    queryFn: ({ signal }) =>
      apiClient.get<Page<Testimonial>>(`/masters/testimonials${query ? `?${query}` : ''}`, signal),
  });
}
export function useTestimonial(id?: string) {
  return useQuery({
    queryKey: testimonialKeys.one(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<Testimonial>(`/masters/testimonials/${id}`, signal),
    enabled: Boolean(id),
  });
}
const invalidateTestimonial = (client: ReturnType<typeof useQueryClient>, id?: string) => {
  void client.invalidateQueries({ queryKey: testimonialKeys.all });
  if (id) void client.invalidateQueries({ queryKey: testimonialKeys.one(id) });
};
export function useCreateTestimonial() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: TestimonialInput) =>
      apiClient.post<Testimonial>('/masters/testimonials', input),
    onSuccess: () => invalidateTestimonial(client),
  });
}
export function useUpdateTestimonial(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: TestimonialUpdateInput) =>
      apiClient.patch<Testimonial>(`/masters/testimonials/${id}`, input),
    onSuccess: () => invalidateTestimonial(client, id),
  });
}
export function useDeleteTestimonial() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<Testimonial>(`/masters/testimonials/${id}`),
    onSuccess: (_, id) => invalidateTestimonial(client, id),
  });
}
export async function approveTestimonialImage(id: string, input: TestimonialImageUploadInput) {
  return apiClient.post<{ uploadUrl: string; expiresInSeconds: number }>(
    `/masters/testimonials/${id}/image/upload`,
    input,
  );
}
export async function confirmTestimonialImage(id: string) {
  return apiClient.post<Testimonial>(`/masters/testimonials/${id}/image/confirm`);
}
export async function testimonialImageUrl(id: string, imageId?: string) {
  return apiClient.get<{ url: string; expiresInSeconds: number }>(
    `/masters/testimonials/${id}/image/download-url${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
  );
}
export async function deleteTestimonialImage(id: string, imageId?: string) {
  return apiClient.delete<{ deleted: true }>(
    `/masters/testimonials/${id}/image${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
  );
}
export const reorderTestimonialImages = (id: string, imageIds: string[]) =>
  apiClient.patch<Testimonial>(`/masters/testimonials/${id}/images/order`, { imageIds });

// ---------------------------------------------------------------------------
// FAQs
// ---------------------------------------------------------------------------

export interface Faq extends MasterVisibilityMeta {
  id: string;
  question: string;
  answer: string;
  destinations: string[] | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string };
  updatedBy?: { id: string; fullName: string } | null;
}

const faqKeys = {
  all: ['masters', 'faqs'] as const,
  one: (id: string) => ['masters', 'faqs', id] as const,
};
export function useFaqs(params = new URLSearchParams()) {
  const query = masterListQuery(params);
  return useQuery({
    queryKey: [...faqKeys.all, query],
    queryFn: ({ signal }) =>
      apiClient.get<Page<Faq>>(`/masters/faqs${query ? `?${query}` : ''}`, signal),
  });
}
export function useFaq(id?: string) {
  return useQuery({
    queryKey: faqKeys.one(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<Faq>(`/masters/faqs/${id}`, signal),
    enabled: Boolean(id),
  });
}
const invalidateFaq = (client: ReturnType<typeof useQueryClient>, id?: string) => {
  void client.invalidateQueries({ queryKey: faqKeys.all });
  if (id) void client.invalidateQueries({ queryKey: faqKeys.one(id) });
};
export function useCreateFaq() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: FaqInput) => apiClient.post<Faq>('/masters/faqs', input),
    onSuccess: () => invalidateFaq(client),
  });
}
export function useUpdateFaq(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: FaqUpdateInput) => apiClient.patch<Faq>(`/masters/faqs/${id}`, input),
    onSuccess: () => invalidateFaq(client, id),
  });
}
export function useDeleteFaq() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<Faq>(`/masters/faqs/${id}`),
    onSuccess: (_, id) => invalidateFaq(client, id),
  });
}

export type MasterImageQueryScope =
  | 'destinations'
  | 'hotels'
  | 'cruises'
  | 'vehicles'
  | 'sightseeing'
  | 'add-on-services'
  | 'testimonials';

const masterImageQueryRoot = (scope: MasterImageQueryScope) => {
  switch (scope) {
    case 'destinations':
      return keys.destinations;
    case 'hotels':
      return hotelKeys.all;
    case 'cruises':
      return cruiseKeys.all;
    case 'vehicles':
      return vehicleKeys.all;
    case 'sightseeing':
      return sightseeingKeys.all;
    case 'add-on-services':
      return addOnServiceKeys.all;
    case 'testimonials':
      return testimonialKeys.all;
  }
};

/** Refresh list, detail, and thumbnail queries after the final image mutation. */
export function useRefreshMasterImageQueries(scope: MasterImageQueryScope) {
  const client = useQueryClient();
  return useCallback(() => refreshMasterImageQueries(client, scope), [client, scope]);
}

export function refreshMasterImageQueries(
  client: ReturnType<typeof useQueryClient>,
  scope: MasterImageQueryScope,
) {
  return client.invalidateQueries({
    queryKey: masterImageQueryRoot(scope),
    refetchType: 'all',
  });
}

// ---------------------------------------------------------------------------
// Global records — hide / restore / hidden list
// ---------------------------------------------------------------------------

/** Stable internal master type keys used by the generic hide/restore routes. */
export type GlobalMasterType =
  | 'CITY'
  | 'DESTINATION'
  | 'HOTEL'
  | 'AIRLINE'
  | 'CRUISE'
  | 'VEHICLE'
  | 'SIGHTSEEING'
  | 'ADD_ON_SERVICE'
  | 'VISA_TYPE'
  | 'TESTIMONIAL';

export interface HiddenGlobalMasterRow {
  hideId: string;
  masterType: GlobalMasterType;
  masterId: string;
  masterTypeLabel: string;
  name: string;
  hiddenAt: string;
  hiddenBy: { id: string; fullName: string } | null;
}

export interface HiddenGlobalMastersResponse {
  data: HiddenGlobalMasterRow[];
  count: number;
}

const hiddenKeys = {
  all: ['masters', 'hidden'] as const,
  query: (query: string) => ['masters', 'hidden', query] as const,
};

/** Global records the current tenant has hidden, optionally filtered by type. */
export function useHiddenGlobalMasters(masterType?: GlobalMasterType) {
  const params = new URLSearchParams();
  if (masterType) params.set('masterType', masterType);
  const query = params.toString();
  return useQuery({
    queryKey: hiddenKeys.query(query),
    queryFn: ({ signal }) =>
      apiClient.get<HiddenGlobalMastersResponse>(
        `/masters/hidden${query ? `?${query}` : ''}`,
        signal,
      ),
  });
}

/**
 * Invalidate every master list/dropdown/lookup/hidden query after a hide or
 * restore so tenant and system-admin changes are visible on the next render.
 */
function invalidateAllMasterQueries(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: ['masters'] });
}

export function useHideGlobalMaster() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ masterType, masterId }: { masterType: GlobalMasterType; masterId: string }) =>
      apiClient.post(`/masters/${masterType}/${masterId}/hide`),
    onSuccess: () => invalidateAllMasterQueries(client),
  });
}

export function useRestoreGlobalMaster() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ masterType, masterId }: { masterType: GlobalMasterType; masterId: string }) =>
      apiClient.delete(`/masters/${masterType}/${masterId}/hide`),
    onSuccess: () => invalidateAllMasterQueries(client),
  });
}
