import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Image as ImageIcon,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  useDestinationStylishCover,
  useSaveDestinationStylishCover,
  useSightseeingListAll,
  useSightseeingPresentations,
  type DestinationStylishCoverSelection,
  type Sightseeing,
} from '@/features/masters/masters.api';

interface Props {
  destinationId: string | null;
  destinationName: string;
  open: boolean;
  onClose: () => void;
}

interface AvailableImage {
  key: string;
  sightseeingId: string;
  imageId: string;
  title: string;
  cityName: string;
  fileName: string;
  isPrimary: boolean;
}

const slotLabel = (index: number) => `Card ${index + 1}`;

export function StylishCoverDialog({ destinationId, destinationName, open, onClose }: Props) {
  const listParams = useMemo(() => {
    const params = new URLSearchParams({ status: 'ACTIVE' });
    if (destinationId) params.set('destinationId', destinationId);
    return params;
  }, [destinationId]);
  const sightseeing = useSightseeingListAll(open ? listParams : new URLSearchParams());
  const cover = useDestinationStylishCover(open ? destinationId : null);
  const save = useSaveDestinationStylishCover(destinationId ?? '');
  const [selected, setSelected] = useState<DestinationStylishCoverSelection[]>([]);
  const [initializedKey, setInitializedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const available: AvailableImage[] = useMemo(() => {
    const rows: Sightseeing[] = (sightseeing.data?.data ?? []) as Sightseeing[];
    const items: AvailableImage[] = [];
    for (const row of rows) {
      if (row.destination.id !== destinationId) continue;
      for (const image of row.images ?? []) {
        items.push({
          key: `${row.id} ${image.id}`,
          sightseeingId: row.id,
          imageId: image.id,
          title: row.title,
          cityName: row.city.name,
          fileName: image.fileName,
          isPrimary: image.isPrimary,
        });
      }
    }
    return items;
  }, [sightseeing.data, destinationId]);
  const availableByKey = useMemo(() => new Map(available.map((item) => [item.key, item])), [available]);

  const presentationIds = useMemo(
    () => [...new Set(available.map((item) => item.sightseeingId))],
    [available],
  );
  const presentations = useSightseeingPresentations(open ? presentationIds : []);

  const thumbnailFor = (sightseeingId: string, imageId: string): string | null => {
    const entry = presentations.data?.[sightseeingId];
    return entry?.images.find((image) => image.id === imageId)?.url ?? null;
  };

  // Seed the selection from the saved configuration whenever new saved data
  // arrives (including a cached-then-fresh transition). Keying by the saved
  // cards — not just the destination — keeps a stale cache from pinning an
  // empty selection over the real configuration.
  const coverCardsKey = cover.data ? JSON.stringify(cover.data.cards ?? []) : '';
  useEffect(() => {
    if (!open || !destinationId || !cover.data) return;
    const key = `${destinationId}:${coverCardsKey}`;
    if (initializedKey === key) return;
    setSelected(
      cover.data.cards.map((card) => ({
        sightseeingId: card.sightseeingId,
        imageId: card.imageId,
      })),
    );
    setInitializedKey(key);
  }, [open, destinationId, cover.data, coverCardsKey, initializedKey]);
  useEffect(() => {
    if (!open) {
      setInitializedKey(null);
      setSelected([]);
      setError(null);
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const selectedKeys = useMemo(
    () => new Set(selected.map((item) => `${item.sightseeingId} ${item.imageId}`)),
    [selected],
  );
  const selectable = selected.length < 3;

  const addImage = (item: AvailableImage) => {
    setError(null);
    if (selectedKeys.has(item.key) || selected.length >= 3) return;
    setSelected((current) => [...current, { sightseeingId: item.sightseeingId, imageId: item.imageId }]);
  };
  const removeAt = (index: number) =>
    setSelected((current) => current.filter((_, slot) => slot !== index));
  const move = (index: number, direction: -1 | 1) =>
    setSelected((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const [moved] = next.splice(index, 1);
      if (!moved) return current;
      next.splice(target, 0, moved);
      return next;
    });

  const slotDisplay = (index: number) => {
    const slot = selected[index];
    if (!slot) return null;
    const known = availableByKey.get(`${slot.sightseeingId} ${slot.imageId}`);
    if (known) return { ...known, stale: false as const, url: thumbnailFor(slot.sightseeingId, slot.imageId) };
    const saved = (cover.data?.cards ?? []).find(
      (card) => card.sightseeingId === slot.sightseeingId && card.imageId === slot.imageId,
    );
    return {
      key: `${slot.sightseeingId} ${slot.imageId}`,
      sightseeingId: slot.sightseeingId,
      imageId: slot.imageId,
      title: saved?.title ?? 'Removed image',
      cityName: saved?.cityName ?? '',
      fileName: '',
      isPrimary: false,
      stale: true as const,
      url: saved?.url ?? null,
    };
  };

  const allValid =
    selected.length === 3 &&
    selected.every((slot) => availableByKey.has(`${slot.sightseeingId} ${slot.imageId}`));
  const canSave = allValid && !save.isPending;

  const handleSave = () => {
    setError(null);
    if (!allValid) {
      setError('Select three available images before saving.');
      return;
    }
    save.mutate(selected, {
      onSuccess: onClose,
      onError: (failure) =>
        setError(failure instanceof Error ? failure.message : 'Unable to save the cover selection.'),
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Manage Stylish PDF cover images for ${destinationName}`}
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-card shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Stylish PDF cover images · {destinationName}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Select exactly three existing sightseeing images, in display order. Card 1
              renders first on Page 1, then Card 2 and Card 3.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close cover image manager"
            onClick={onClose}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {cover.isPending || sightseeing.isPending ? (
            <div className="h-48 animate-pulse rounded-lg bg-slate-100" />
          ) : cover.isError || sightseeing.isError ? (
            <p role="alert" className="text-sm text-red-700">
              Cover images could not be loaded. Close and try again.
            </p>
          ) : (
            <>
              <section aria-label="Selected cover images">
                <h3 className="text-sm font-semibold text-slate-700">
                  Selected images ({selected.length}/3)
                </h3>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  {[0, 1, 2].map((slot) => {
                    const item = slotDisplay(slot);
                    return (
                      <div key={slot} className="rounded-xl border p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-brand-700">
                          {slotLabel(slot)}
                        </p>
                        {item ? (
                          <div className="mt-2">
                            {item.url ? (
                              <img
                                src={item.url}
                                alt=""
                                className="h-24 w-full rounded object-cover"
                              />
                            ) : (
                              <div className="flex h-24 items-center justify-center rounded bg-slate-100">
                                <ImageIcon className="h-6 w-6 text-slate-300" />
                              </div>
                            )}
                            <p className="mt-2 truncate text-sm font-semibold" title={item.title}>
                              {item.title}
                            </p>
                            <p className="text-xs text-slate-500">
                              {item.cityName}
                              {item.isPrimary ? ' · Primary' : ' · Additional'}
                            </p>
                            {item.stale && (
                              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700">
                                <TriangleAlert className="h-3.5 w-3.5" /> No longer available —
                                remove it
                              </p>
                            )}
                            <div className="mt-2 flex gap-1">
                              <button
                                type="button"
                                aria-label={`Move ${slotLabel(slot)} up`}
                                disabled={slot === 0}
                                onClick={() => move(slot, -1)}
                                className="rounded border p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${slotLabel(slot)} down`}
                                disabled={slot === selected.length - 1}
                                onClick={() => move(slot, 1)}
                                className="rounded border p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove ${slotLabel(slot)}`}
                                onClick={() => removeAt(slot)}
                                className="rounded border p-1.5 text-slate-600 hover:bg-slate-100"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-slate-400">
                            Empty — select an image below.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section aria-label="Available sightseeing images">
                <h3 className="text-sm font-semibold text-slate-700">Available images</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Only images belonging to {destinationName} are listed.
                </p>
                {available.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">
                    No sightseeing images found for this destination.
                  </p>
                ) : (
                  <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {available.map((item) => {
                      const taken = selectedKeys.has(item.key);
                      const url = thumbnailFor(item.sightseeingId, item.imageId);
                      return (
                        <li key={item.key}>
                          <button
                            type="button"
                            disabled={taken || !selectable}
                            onClick={() => addImage(item)}
                            aria-label={`Select image ${item.fileName} from ${item.title}`}
                            className={`block w-full rounded-xl border p-2 text-left transition ${
                              taken
                                ? 'border-emerald-500 bg-emerald-50'
                                : selectable
                                  ? 'hover:border-brand-400 hover:bg-brand-50'
                                  : 'opacity-60'
                            }`}
                          >
                            <span className="flex gap-2">
                              {url ? (
                                <img
                                  src={url}
                                  alt=""
                                  className="h-14 w-20 shrink-0 rounded object-cover"
                                />
                              ) : (
                                <span className="flex h-14 w-20 shrink-0 items-center justify-center rounded bg-slate-100">
                                  <ImageIcon className="h-5 w-5 text-slate-300" />
                                </span>
                              )}
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold" title={item.title}>
                                  {item.title}
                                  {taken && (
                                    <Check className="ml-1 inline h-4 w-4 text-emerald-600" />
                                  )}
                                </span>
                                <span className="block text-xs text-slate-500">
                                  {item.cityName} · {item.isPrimary ? 'Primary' : 'Additional'}
                                </span>
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}

          {(error || save.isError) && (
            <p role="alert" className="text-sm text-red-700">
              {error ?? 'Unable to save the cover selection.'}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={handleSave} isLoading={save.isPending}>
            Save cover images
          </Button>
        </div>
      </div>
    </div>
  );
}
