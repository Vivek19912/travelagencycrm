import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Image as ImageIcon,
  MapPinned,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { PERMISSIONS } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { ExcelImportDialog } from '@/features/masters/excel-import/ExcelImportDialog';
import { formatTime12Hour } from '@/utils/dateTime';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  useDeleteSightseeing,
  masterImageFingerprint,
  useAllCities,
  useAllDestinations,
  useHideGlobalMaster,
  useReorderSightseeing,
  useSightseeingListAll,
  useSightseeingSummary,
  sightseeingImageUrl,
  type Sightseeing,
} from '@/features/masters/masters.api';
import {
  GlobalBadge,
  HIDE_GLOBAL_CONFIRM,
  MasterHeader,
  RichTextPreview,
  StatusBadge,
} from './MasterUi';
import { StylishCoverDialog } from './StylishCoverDialog';

const ACTIVE_OPTIONS = 'status=ACTIVE';

function SightseeingThumbnail({ row }: { row: Sightseeing }) {
  const image = useQuery({
    queryKey: ['masters', 'sightseeing', row.id, 'image', masterImageFingerprint(row)],
    queryFn: () => sightseeingImageUrl(row.id),
    enabled: row.hasImage,
    staleTime: 240_000,
  });
  if (row.hasImage && image.data?.url)
    return <img src={image.data.url} alt="" className="h-12 w-16 rounded object-cover" />;
  return (
    <div className="flex h-12 w-16 items-center justify-center rounded bg-slate-100">
      <ImageIcon className="h-5 w-5 text-slate-300" />
    </div>
  );
}

/**
 * Sightseeing list.
 *
 * The reference groups rows by Destination and then by City, which is what
 * makes the sequence column meaningful, so the same grouping is rebuilt here
 * from the complete multi-page result set (every eligible page is fetched —
 * there is no total-record cap).
 */
export function SightseeingPage() {
  const [params, setParams] = useSearchParams();
  const listParams = useMemo(() => {
    // Paging is owned by the all-pages fetch below; only filters travel here.
    const next = new URLSearchParams(params);
    next.delete('page');
    next.delete('pageSize');
    return next;
  }, [params]);
  const destinationOptions = useMemo(() => new URLSearchParams(ACTIVE_OPTIONS), []);
  const cityOptions = useMemo(() => new URLSearchParams(ACTIVE_OPTIONS), []);
  const rows = useSightseeingListAll(listParams);
  const summary = useSightseeingSummary(params);
  const destinations = useAllDestinations(destinationOptions);
  const cities = useAllCities(cityOptions);
  const remove = useDeleteSightseeing();
  const reorder = useReorderSightseeing();
  const hideMaster = useHideGlobalMaster();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSIONS.MASTER_SIGHTSEEING_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.MASTER_SIGHTSEEING_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.MASTER_SIGHTSEEING_DELETE);
  const [openDestinations, setOpenDestinations] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [coverDestination, setCoverDestination] = useState<{ id: string; name: string } | null>(null);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing destination invalidates any city already chosen.
    if (key === 'destinationId') next.delete('cityId');
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  const deleteRow = (id: string, title: string) => {
    if (window.confirm(`Permanently delete sightseeing ${title}? This action cannot be undone.`))
      remove.mutate(id);
  };
  const hideRow = (id: string) => {
    if (window.confirm(HIDE_GLOBAL_CONFIRM))
      hideMaster.mutate({ masterType: 'SIGHTSEEING', masterId: id });
  };

  const activeStatus = params.get('status') ?? '';
  const emptyMessage =
    activeStatus === 'INACTIVE'
        ? 'No inactive sightseeing records found.'
        : activeStatus === 'ACTIVE'
          ? 'No active sightseeing records found.'
          : 'No current sightseeing records found.';

  /** Group the page into destination → city buckets, preserving server order. */
  const groups = useMemo(() => {
    const data = rows.data?.data ?? [];
    const byDestination = new Map<
      string,
      { name: string; cities: Map<string, { name: string; items: Sightseeing[] }> }
    >();
    for (const row of data) {
      const destination = byDestination.get(row.destination.id) ?? {
        name: row.destination.name,
        cities: new Map<string, { name: string; items: Sightseeing[] }>(),
      };
      const city = destination.cities.get(row.city.id) ?? { name: row.city.name, items: [] };
      city.items.push(row);
      destination.cities.set(row.city.id, city);
      byDestination.set(row.destination.id, destination);
    }
    return [...byDestination.entries()];
  }, [rows.data]);

  const stats = summary.data;

  return (
    <div className="space-y-5">
      <MasterHeader
        title="Sightseeing Master"
        description="Organized by destinations"
        current="Sightseeing"
      />

      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-700">Filters &amp; Actions</h2>
          {canCreate && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Import Excel
              </Button>
              <Link to="/masters/sightseeing/new">
                <Button size="sm">
                  <Plus className="h-4 w-4" /> Add New Sightseeing
                </Button>
              </Link>
            </div>
          )}
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-[minmax(0,1fr)_220px_220px_160px]">
          <label className="relative">
            <span className="sr-only">Search sightseeing</span>
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              aria-label="Search sightseeing"
              placeholder="Search sightseeing…"
              className="w-full rounded-lg border py-2.5 pl-9 pr-3 text-sm"
              value={params.get('search') ?? ''}
              onChange={(event) => update('search', event.target.value)}
            />
          </label>
          <select
            aria-label="Destination"
            className="rounded-lg border px-3 py-2.5 text-sm"
            value={params.get('destinationId') ?? ''}
            onChange={(event) => update('destinationId', event.target.value)}
          >
            <option value="">All Destinations</option>
            {(destinations.data?.data ?? []).map((destination) => (
              <option key={destination.id} value={destination.id}>
                {destination.name}
              </option>
            ))}
          </select>
          <select
            aria-label="City"
            className="rounded-lg border px-3 py-2.5 text-sm"
            value={params.get('cityId') ?? ''}
            onChange={(event) => update('cityId', event.target.value)}
          >
            <option value="">All Cities</option>
            {(cities.data?.data ?? []).map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </select>
          {canUpdate ? (
            <select
              aria-label="Sightseeing status"
              className="rounded-lg border px-3 py-2.5 text-sm"
              value={activeStatus}
              onChange={(event) => update('status', event.target.value)}
            >
              <option value="">Current statuses</option>
              <option>ACTIVE</option>
              <option>INACTIVE</option>
            </select>
          ) : (
            <div />
          )}
        </div>

        {rows.isPending ? (
          <div className="h-72 animate-pulse bg-slate-100" />
        ) : rows.isError ? (
          <div role="alert" className="p-8 text-center">
            <p className="text-red-700">
              Sightseeing could not be loaded. The list may be incomplete — no records are
              shown until every page loads successfully.
            </p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => rows.refetch()}>
              Retry
            </Button>
          </div>
        ) : !rows.data?.data.length ? (
          <div className="p-12 text-center">
            <MapPinned className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-3 font-semibold">No sightseeing found</h2>
            <p className="text-sm text-slate-500">{emptyMessage}</p>
          </div>
        ) : (
          <>
            {/* Desktop: destination → city grouped tables. */}
            <div className="hidden md:block">
              {groups.map(([destinationId, destination]) => {
                const isOpen = openDestinations.has(destinationId);
                const toggle = () =>
                  setOpenDestinations((current) => {
                    const next = new Set(current);
                    if (next.has(destinationId)) next.delete(destinationId);
                    else next.add(destinationId);
                    return next;
                  });
                return (
                  <section
                    key={destinationId}
                    className="mb-4 overflow-hidden rounded-lg border last:mb-0"
                  >
                    <header className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                      <button
                        type="button"
                        onClick={toggle}
                        aria-expanded={isOpen}
                        className="flex items-center gap-2 text-left"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-5 w-5 text-slate-500" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-slate-500" />
                        )}
                        <MapPinned className="h-4 w-4 text-brand-600" aria-hidden="true" />
                        <h2 className="font-semibold text-brand-700">{destination.name}</h2>
                        <span className="text-xs text-slate-500">
                          {[...destination.cities.values()].reduce(
                            (total, city) => total + city.items.length,
                            0,
                          )}{' '}
                          attractions ({destination.cities.size}{' '}
                          {destination.cities.size === 1 ? 'city' : 'cities'})
                        </span>
                      </button>
                      <div className="flex gap-2">
                        {canUpdate && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setCoverDestination({ id: destinationId, name: destination.name })
                            }
                          >
                            Manage Stylish PDF Cover Images
                          </Button>
                        )}
                        {canCreate && (
                          <Link to={`/masters/sightseeing/new?destinationId=${destinationId}`}>
                            <Button size="sm" variant="secondary">
                              <Plus className="h-4 w-4" /> Add Sightseeing
                            </Button>
                          </Link>
                        )}
                        <Link to={`/masters/destinations/${destinationId}`}>
                          <Button size="sm" variant="secondary">
                            View Destination
                          </Button>
                        </Link>
                      </div>
                    </header>

                    {isOpen && (
                      <>
                        {[...destination.cities.entries()].map(([cityId, city]) => (
                          <div key={cityId}>
                            <div className="flex items-center gap-2 border-y bg-slate-100/70 px-4 py-1.5">
                              <Building2
                                className="h-3.5 w-3.5 text-slate-500"
                                aria-hidden="true"
                              />
                              <span className="text-xs font-semibold text-slate-700">
                                {city.name}
                              </span>
                              <span className="rounded bg-slate-200 px-1.5 text-[11px] font-semibold text-slate-700">
                                {city.items.length}
                              </span>
                            </div>
                            <table className="min-w-full text-left text-sm">
                              <thead className="sr-only">
                                <tr>
                                  <th>Image</th>
                                  <th>Title</th>
                                  <th>City</th>
                                  <th>Sequence</th>
                                  <th>Duration</th>
                                  <th>Start time</th>
                                  <th>Status</th>
                                  <th>Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {city.items.map((row) => (
                                  <tr key={row.id} className="hover:bg-slate-50">
                                    <td className="w-16 px-4 py-2.5">
                                      <SightseeingThumbnail row={row} />
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <Link
                                        to={`/masters/sightseeing/${row.id}`}
                                        className="font-semibold text-brand-700 hover:underline"
                                      >
                                        {row.title}
                                        {row.isGlobal && <GlobalBadge />}
                                      </Link>
                                      <RichTextPreview
                                        html={row.description}
                                        className="mt-0.5 text-xs text-slate-500"
                                      />
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                        {row.city.name}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <span className="rounded bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                                        {row.sequence}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2.5">
                                      {row.estimatedHours != null ? (
                                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                                          {row.estimatedHours.toFixed(1)}h
                                        </span>
                                      ) : (
                                        <span className="text-slate-400">—</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-2.5 text-slate-600">
                                      {row.suggestedStartTime ? (
                                        <span className="inline-flex items-center gap-1 text-xs">
                                          <Clock
                                            className="h-3 w-3 text-slate-400"
                                            aria-hidden="true"
                                          />
                                          {formatTime12Hour(row.suggestedStartTime)}
                                        </span>
                                      ) : (
                                        <span className="text-slate-400">—</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <StatusBadge value={row.status} />
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <div className="flex gap-1">
                                        {canUpdate && !row.isGlobal && (
                                            <>
                                              <button
                                                aria-label={`Move ${row.title} up`}
                                                onClick={() =>
                                                  reorder.mutate({ id: row.id, direction: 'UP' })
                                                }
                                                className="rounded border p-1.5 text-slate-600 hover:bg-slate-100"
                                              >
                                                <ArrowUp className="h-3.5 w-3.5" />
                                              </button>
                                              <button
                                                aria-label={`Move ${row.title} down`}
                                                onClick={() =>
                                                  reorder.mutate({ id: row.id, direction: 'DOWN' })
                                                }
                                                className="rounded border p-1.5 text-slate-600 hover:bg-slate-100"
                                              >
                                                <ArrowDown className="h-3.5 w-3.5" />
                                              </button>
                                            </>
                                          )}
                                        <Link
                                          aria-label={`View ${row.title}`}
                                          to={`/masters/sightseeing/${row.id}`}
                                          className="rounded bg-cyan-600 p-1.5 text-white"
                                        >
                                          <Eye className="h-3.5 w-3.5" />
                                        </Link>
                                        {canUpdate && !row.isGlobal && (
                                          <Link
                                            aria-label={`Edit ${row.title}`}
                                            to={`/masters/sightseeing/${row.id}/edit`}
                                            className="rounded bg-brand-600 p-1.5 text-white"
                                          >
                                            <Pencil className="h-3.5 w-3.5" />
                                          </Link>
                                        )}
                                        {row.canHide && (
                                          <button
                                            aria-label={`Hide ${row.title} for this company`}
                                            title="Hide this global record for your company"
                                            onClick={() => hideRow(row.id)}
                                            className="rounded bg-amber-600 p-1.5 text-white"
                                          >
                                            <EyeOff className="h-3.5 w-3.5" />
                                          </button>
                                        )}
                                        {canDelete && !row.isGlobal && (
                                            <button
                                              aria-label={`Delete ${row.title}`}
                                              title="Permanently delete"
                                              onClick={() => deleteRow(row.id, row.title)}
                                              className="rounded bg-red-600 p-1.5 text-white"
                                            >
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                          )}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </>
                    )}
                  </section>
                );
              })}
            </div>

            {/* Mobile: flat cards. */}
            <div className="divide-y md:hidden">
              {(rows.data?.data ?? []).map((row) => (
                <article key={row.id} className="flex items-center justify-between gap-2 p-4">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">
                      {row.title}
                      {row.isGlobal && <GlobalBadge />}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {row.destination.name} · {row.city.name} · #{row.sequence}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Link to={`/masters/sightseeing/${row.id}`}>
                      <Button variant="secondary">View</Button>
                    </Link>
                    {canUpdate && !row.isGlobal && (
                      <Link to={`/masters/sightseeing/${row.id}/edit`}>
                        <Button variant="secondary">Edit</Button>
                      </Link>
                    )}
                    {row.canHide && (
                      <Button
                        variant="secondary"
                        onClick={() => hideRow(row.id)}
                        title="Hide for this company"
                      >
                        Hide
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {stats && (
        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <h2 className="border-b bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800">
            Summary Statistics
          </h2>
          <dl className="grid grid-cols-2 divide-x divide-y text-center sm:grid-cols-4 sm:divide-y-0">
            {[
              { label: 'Total Attractions', value: stats.totalAttractions },
              { label: 'Destinations', value: stats.destinations },
              { label: 'Cities Covered', value: stats.citiesCovered },
              { label: 'With Images', value: stats.withImages },
            ].map((tile) => (
              <div key={tile.label} className="p-4">
                <dt className="text-xs text-slate-500">{tile.label}</dt>
                <dd className="mt-0.5 text-xl font-semibold text-slate-900">{tile.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <ExcelImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        initialMasterType="SIGHTSEEING"
        onSuccess={() => rows.refetch()}
      />
      <StylishCoverDialog
        key={coverDestination?.id ?? 'closed'}
        destinationId={coverDestination?.id ?? null}
        destinationName={coverDestination?.name ?? ''}
        open={coverDestination !== null}
        onClose={() => setCoverDestination(null)}
      />
    </div>
  );
}
