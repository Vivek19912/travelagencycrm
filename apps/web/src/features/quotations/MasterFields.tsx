import { useMemo, type ReactNode } from 'react';
import type { QuotationVersionInput } from '@interscale/shared';
import { normalizeAddonPricingSnapshot } from './addonPricing';
import { MasterSelect, type MasterOption } from '@/components/ui/MasterSelect';
import {
  useAddOnServices,
  useAirlines,
  useCruise,
  useCruises,
  useAllHotels,
  useHotel,
  useSightseeingList,
  useVehicles,
  type MasterImageMeta,
} from '@/features/masters/masters.api';

/**
 * The master pickers shared by the quotation builder and the template builder.
 *
 * These components only choose ids and hand back a patch; the caller writes
 * both the id and the snapshot text onto its own row. That split is deliberate:
 * the snapshot columns stay authoritative for rendering, so a row keeps reading
 * correctly long after the master it came from is renamed or archived.
 *
 * Nothing here is required. A row with no master selected is a normal,
 * fully supported row.
 */

const ACTIVE = () => new URLSearchParams({ status: 'ACTIVE', pageSize: '100' });

/**
 * Rendered as a component, so it must stay at module scope: an inline function
 * would remount every child (resetting a picker's typed text) on each parent
 * re-render, which now happens on every keystroke of an editable combobox.
 */
const FieldShell = ({
  label,
  showLabels,
  children,
}: {
  label: string;
  showLabels: boolean;
  children: ReactNode;
}) =>
  showLabels ? (
    <label className="text-sm font-semibold text-slate-800">
      {label}
      <span className="ml-0.5 text-red-500">*</span>
      <span className="mt-1 block">{children}</span>
    </label>
  ) : (
    <>{children}</>
  );

// ---------------------------------------------------------------------------
// Hotels
// ---------------------------------------------------------------------------

export interface HotelRowPatch {
  hotelId?: string | null | undefined;
  hotelRoomTypeId?: string | null | undefined;
  hotelMealPlanId?: string | null | undefined;
  city?: string;
  hotelName?: string;
  roomType?: string | null;
  mealPlan?: string | null;
  category?: string | null;
  internalCost?: number;
  sellingPrice?: number;
  images?: QuotationVersionInput['hotels'][number]['images'];
  imageSnapshotPresent?: boolean | undefined;
  pdfImageUrl?: string | null;
}

interface HotelMasterFieldsProps {
  value: {
    hotelId?: string | null | undefined;
    hotelRoomTypeId?: string | null | undefined;
    hotelMealPlanId?: string | null | undefined;
  };
  /** Costing inputs are hidden without the permission, so never prefill them. */
  canCost: boolean;
  preferredCity?: string | undefined;
  showLabels?: boolean;
  /** Saved snapshot text, shown when no master is linked (typed custom value). */
  roomTypeText?: string | null | undefined;
  mealPlanText?: string | null | undefined;
  /** Saved snapshot hotel name (e.g. imported from a hotel bookmark), shown
   * when no Hotel Master is linked. */
  hotelNameText?: string | null | undefined;
  /**
   * Render ONLY the hotel picker. The quotation builder uses this because its
   * room types and meal plans are per-allocation repeatable lists managed by
   * the builder itself; the template builder keeps the combined layout.
   */
  hotelOnly?: boolean;
  onChange: (patch: HotelRowPatch) => void;
  onMasterSelect?: (hotelId: string, images: MasterImageMeta[] | undefined, name: string) => void;
}

export function HotelMasterFields({
  value,
  canCost,
  preferredCity,
  showLabels = false,
  roomTypeText,
  mealPlanText,
  hotelNameText,
  hotelOnly = false,
  onChange,
  onMasterSelect,
}: HotelMasterFieldsProps) {
  const hotels = useAllHotels(ACTIVE());
  const detail = useHotel(value.hotelId ?? undefined);

  const hotelOptions = useMemo<MasterOption[]>(() => {
    const normalizedCity = preferredCity?.trim().toLowerCase();
    return [...(hotels.data?.data ?? [])]
      .sort((a, b) => {
        const aMatches =
          a.city.name.toLowerCase() === normalizedCity ||
          a.destination.name.toLowerCase() === normalizedCity;
        const bMatches =
          b.city.name.toLowerCase() === normalizedCity ||
          b.destination.name.toLowerCase() === normalizedCity;
        if (aMatches !== bMatches) return aMatches ? -1 : 1;
        if (a.isDefaultForCity !== b.isDefaultForCity) return a.isDefaultForCity ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((hotel) => ({
        id: hotel.id,
        label: hotel.name,
        hint: hotel.city?.name,
      }));
  }, [hotels.data, preferredCity]);
  const roomTypes = detail.data?.roomTypes ?? [];
  const mealPlans = detail.data?.mealPlans ?? [];

  /**
   * Cost and price are recomputed from the room type and meal plan together,
   * never accumulated, so switching either one cannot drift the totals.
   */
  const pricing = (roomTypeId: string | null, mealPlanId: string | null): HotelRowPatch => {
    const room = roomTypes.find((entry) => entry.id === roomTypeId);
    const meal = mealPlans.find((entry) => entry.id === mealPlanId);
    const selling = (room?.sellingPrice ?? 0) + (meal?.sellingPrice ?? 0);
    // A master with no price of its own must not overwrite a typed figure.
    if (!room?.sellingPrice && !meal?.sellingPrice) return {};
    return {
      sellingPrice: selling,
      ...(canCost ? { internalCost: (room?.baseCost ?? 0) + (meal?.baseCost ?? 0) } : {}),
    };
  };

  return (
    <>
      <FieldShell label="Hotel Name" showLabels={showLabels}>
        <MasterSelect
          ariaLabel="Hotel master"
          placeholder="Link a hotel"
          options={hotelOptions}
          value={value.hotelId}
          loading={hotels.isPending}
          fallbackLabel={detail.data?.name ?? hotelNameText ?? undefined}
          onText={(text) =>
            onChange({
              // Free-typed names stay in the row snapshot (e.g. a bookmarked
              // hotel that has no Master record).
              hotelName: text.trim() ? text : '',
            })
          }
          onSelect={(option) => {
            const selected = (hotels.data?.data ?? []).find((hotel) => hotel.id === option?.id);
            onChange({
              hotelId: option?.id ?? null,
              // The child selections belong to the previous hotel.
              hotelRoomTypeId: null,
              hotelMealPlanId: null,
              roomType: null,
              mealPlan: null,
              ...(option
                ? {
                    hotelName: option.label,
                    ...(option.hint ? { city: option.hint } : {}),
                    category: selected?.starCategory ? `${selected.starCategory} Star` : null,
                  }
                : {}),
            });
            if (selected) onMasterSelect?.(selected.id, selected.images, selected.name);
          }}
        />
      </FieldShell>
      {hotelOnly ? null : (
        <>
          <FieldShell label="Room Type" showLabels={showLabels}>
            <MasterSelect
              ariaLabel="Room type master"
              placeholder={value.hotelId ? 'Link a room type' : 'Type room type'}
              options={roomTypes.map((room) => ({ id: room.id, label: room.name }))}
              value={value.hotelRoomTypeId}
              loading={Boolean(value.hotelId) && detail.isPending}
              fallbackLabel={roomTypeText ?? undefined}
              onText={(text) =>
                onChange({
                  hotelRoomTypeId: null,
                  roomType: text.trim() ? text : null,
                })
              }
              onSelect={(option) =>
                onChange({
                  hotelRoomTypeId: option?.id ?? null,
                  ...(option ? { roomType: option.label } : {}),
                  ...pricing(option?.id ?? null, value.hotelMealPlanId ?? null),
                })
              }
            />
          </FieldShell>
          <FieldShell label="Meal Plan" showLabels={showLabels}>
            <MasterSelect
              ariaLabel="Meal plan master"
              placeholder={value.hotelId ? 'Link a meal plan' : 'Type meal plan'}
              options={mealPlans.map((meal) => ({ id: meal.id, label: meal.name, hint: meal.type }))}
              value={value.hotelMealPlanId}
              loading={Boolean(value.hotelId) && detail.isPending}
              fallbackLabel={mealPlanText ?? undefined}
              onText={(text) =>
                onChange({
                  hotelMealPlanId: null,
                  mealPlan: text.trim() ? text : null,
                })
              }
              onSelect={(option) =>
                onChange({
                  hotelMealPlanId: option?.id ?? null,
                  ...(option ? { mealPlan: option.label } : {}),
                  ...pricing(value.hotelRoomTypeId ?? null, option?.id ?? null),
                })
              }
            />
          </FieldShell>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export interface ServiceRowPatch {
  airlineId?: string | null | undefined;
  cruiseId?: string | null | undefined;
  cruiseRoomTypeId?: string | null | undefined;
  vehicleId?: string | null | undefined;
  sightseeingId?: string | null | undefined;
  addOnServiceId?: string | null | undefined;
  name?: string;
  sellingPrice?: number;
  description?: string | null;
  notes?: string | null;
  duration?: string | null;
  taxCategory?: string | null;
  dayNumber?: number | null;
  city?: string | null;
  quantity?: number;
  pricingBasis?: QuotationVersionInput['services'][number]['pricingBasis'];
  pricingBasisLabel?: string | null;
  pricingSnapshot?: QuotationVersionInput['services'][number]['pricingSnapshot'];
  internalCost?: number;
  images?: QuotationVersionInput['services'][number]['images'];
  imageSnapshotPresent?: boolean | undefined;
  pdfImageUrl?: string | null;
}

export const SERVICE_MASTER_KEYS = [
  'airlineId',
  'cruiseId',
  'cruiseRoomTypeId',
  'vehicleId',
  'sightseeingId',
  'addOnServiceId',
] as const;

/** Every master link cleared — used when the service type changes. */
export const CLEARED_SERVICE_MASTERS: ServiceRowPatch = Object.fromEntries(
  SERVICE_MASTER_KEYS.map((key) => [key, null]),
);

interface ServiceMasterFieldsProps {
  serviceType: string;
  value: {
    airlineId?: string | null | undefined;
    cruiseId?: string | null | undefined;
    cruiseRoomTypeId?: string | null | undefined;
    vehicleId?: string | null | undefined;
    sightseeingId?: string | null | undefined;
    addOnServiceId?: string | null | undefined;
  };
  onChange: (patch: ServiceRowPatch) => void;
}

/**
 * Renders the picker that matches the row's service type, and nothing for the
 * types that have no master behind them. The server enforces the same pairing.
 */
export function ServiceMasterFields({ serviceType, value, onChange }: ServiceMasterFieldsProps) {
  const enabled = {
    flight: serviceType === 'FLIGHT',
    cruise: serviceType === 'CRUISE',
    vehicle: serviceType === 'VEHICLE_TRANSFER',
    sightseeing: serviceType === 'SIGHTSEEING',
    addOn: serviceType === 'OTHER_ADD_ON',
  };

  if (enabled.flight) return <AirlineField value={value.airlineId} onChange={onChange} />;
  if (enabled.cruise) return <CruiseFields value={value} onChange={onChange} />;
  if (enabled.vehicle) return <VehicleField value={value.vehicleId} onChange={onChange} />;
  if (enabled.sightseeing)
    return <SightseeingField value={value.sightseeingId} onChange={onChange} />;
  if (enabled.addOn) return <AddOnField value={value.addOnServiceId} onChange={onChange} />;
  return null;
}

function AirlineField({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (patch: ServiceRowPatch) => void;
}) {
  const airlines = useAirlines(ACTIVE());
  return (
    <MasterSelect
      ariaLabel="Airline master"
      placeholder="Link an airline"
      options={(airlines.data?.data ?? []).map((row) => ({ id: row.id, label: row.name }))}
      value={value}
      loading={airlines.isPending}
      // Airlines carry no price, so the row's own figures are left untouched.
      onSelect={(option) =>
        onChange({ airlineId: option?.id ?? null, ...(option ? { name: option.label } : {}) })
      }
    />
  );
}

function CruiseFields({
  value,
  onChange,
}: {
  value: { cruiseId?: string | null | undefined; cruiseRoomTypeId?: string | null | undefined };
  onChange: (patch: ServiceRowPatch) => void;
}) {
  const cruises = useCruises(ACTIVE());
  const detail = useCruise(value.cruiseId ?? undefined);
  const roomTypes = detail.data?.roomTypes ?? [];
  return (
    <>
      <MasterSelect
        ariaLabel="Cruise master"
        placeholder="Link a cruise"
        options={(cruises.data?.data ?? []).map((row) => ({ id: row.id, label: row.name }))}
        value={value.cruiseId}
        loading={cruises.isPending}
        fallbackLabel={detail.data?.name}
        onSelect={(option) => {
          const selected = (cruises.data?.data ?? []).find((cruise) => cruise.id === option?.id);
          onChange({
            cruiseId: option?.id ?? null,
            cruiseRoomTypeId: null,
            ...(option ? { name: option.label } : {}),
            ...(selected?.price != null && Number(selected.price) > 0
              ? { sellingPrice: Number(selected.price) }
              : {}),
          });
        }}
      />
      <MasterSelect
        ariaLabel="Cruise room type master"
        placeholder={
          !value.cruiseId
            ? 'Select cruise first'
            : roomTypes.length > 0
              ? 'Select room type'
              : 'No room types configured'
        }
        options={roomTypes.map((room) => ({ id: room.id, label: room.name }))}
        value={value.cruiseRoomTypeId}
        disabled={!value.cruiseId}
        loading={Boolean(value.cruiseId) && detail.isPending}
        onSelect={(option) => {
          const room = roomTypes.find((entry) => entry.id === option?.id);
          onChange({
            cruiseRoomTypeId: option?.id ?? null,
            // price is absent for viewers without the costing permission.
            ...(room?.price != null ? { sellingPrice: Number(room.price) } : {}),
          });
        }}
      />
    </>
  );
}

function VehicleField({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (patch: ServiceRowPatch) => void;
}) {
  const vehicles = useVehicles(ACTIVE());
  return (
    <MasterSelect
      ariaLabel="Vehicle master"
      placeholder="Link a vehicle"
      options={(vehicles.data?.data ?? []).map((row) => ({
        id: row.id,
        label: row.name,
        hint: row.vehicleType,
      }))}
      value={value}
      loading={vehicles.isPending}
      onSelect={(option) => {
        const selected = (vehicles.data?.data ?? []).find((row) => row.id === option?.id);
        onChange({
          vehicleId: option?.id ?? null,
          ...(option ? { name: option.label } : {}),
          ...(selected?.price != null && Number(selected.price) > 0
            ? { sellingPrice: Number(selected.price) }
            : {}),
        });
      }}
    />
  );
}

function SightseeingField({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (patch: ServiceRowPatch) => void;
}) {
  const sightseeing = useSightseeingList(ACTIVE());
  return (
    <MasterSelect
      ariaLabel="Sightseeing master"
      placeholder="Link a sightseeing"
      options={(sightseeing.data?.data ?? []).map((row) => ({ id: row.id, label: row.title }))}
      value={value}
      loading={sightseeing.isPending}
      onSelect={(option) =>
        onChange({ sightseeingId: option?.id ?? null, ...(option ? { name: option.label } : {}) })
      }
    />
  );
}

function AddOnField({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (patch: ServiceRowPatch) => void;
}) {
  const services = useAddOnServices(ACTIVE());
  const rows = services.data?.data ?? [];
  return (
    <MasterSelect
      ariaLabel="Add-on service master"
      placeholder="Link an add-on service"
      options={rows.map((row) => ({ id: row.id, label: row.name }))}
      value={value}
      loading={services.isPending}
      onSelect={(option) => {
        const row = rows.find((entry) => entry.id === option?.id);
        // Every pricing option travels in the quotation-owned snapshot; the
        // chargeable price defaults to the first priced option.
        const snapshot = row
          ? normalizeAddonPricingSnapshot({
              id: row.id,
              pricing: row.pricing,
              price: row.price,
              currency: row.currency,
              pricingBasis: row.pricingBasis,
            })
          : [];
        const firstPriced = snapshot.find((entry) => entry.price != null);
        const firstLabel = (snapshot[0]?.label ?? '').trim();
        onChange({
          addOnServiceId: option?.id ?? null,
          ...(option ? { name: option.label } : {}),
          ...(firstPriced != null
            ? { sellingPrice: Number(firstPriced.price) }
            : row?.price != null
              ? { sellingPrice: Number(row.price) }
              : {}),
          ...(firstLabel !== '' ? { pricingBasisLabel: firstLabel } : {}),
          ...(snapshot.length > 0 ? { pricingSnapshot: snapshot } : {}),
        });
      }}
    />
  );
}
