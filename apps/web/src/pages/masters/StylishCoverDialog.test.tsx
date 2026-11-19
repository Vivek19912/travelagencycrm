import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { SightseeingPage } from './SightseeingPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const cityId = '11111111-1111-4111-8111-111111111111';
const destinationId = '22222222-2222-4222-8222-222222222222';
const sightA = '77777777-7777-4777-8777-777777777777';
const sightB = '88888888-8888-4888-8888-888888888888';

const sightseeings = [
  {
    id: sightA,
    title: 'DAY 6 | KAZA LOCAL SIGHTSEEING',
    sequence: 6,
    estimatedHours: 4,
    suggestedStartTime: null,
    description: null,
    remarks: null,
    status: 'ACTIVE',
    hasImage: true,
    images: [
      { id: 'img-a1', fileName: 'kaza-1.png', mimeType: 'image/png', fileSize: 10, isPrimary: true },
      { id: 'img-a2', fileName: 'kaza-2.png', mimeType: 'image/png', fileSize: 10, isPrimary: false },
    ],
    imageFileName: 'kaza-1.png',
    imageMimeType: 'image/png',
    imageConfirmedAt: '2026-08-20T00:00:00.000Z',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    destination: { id: destinationId, name: 'Spiti Valley' },
    city: { id: cityId, name: 'Kaza' },
    createdBy: { id: 'u1', fullName: 'Aditi Rao' },
    updatedBy: null,
  },
  {
    id: sightB,
    title: 'DAY 2 | SANGLA TO KALPA',
    sequence: 2,
    estimatedHours: 5,
    suggestedStartTime: null,
    description: null,
    remarks: null,
    status: 'ACTIVE',
    hasImage: true,
    images: [
      { id: 'img-b1', fileName: 'sangla.png', mimeType: 'image/png', fileSize: 10, isPrimary: true },
    ],
    imageFileName: 'sangla.png',
    imageMimeType: 'image/png',
    imageConfirmedAt: '2026-08-20T00:00:00.000Z',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    destination: { id: destinationId, name: 'Spiti Valley' },
    city: { id: cityId, name: 'Kaza' },
    createdBy: { id: 'u1', fullName: 'Aditi Rao' },
    updatedBy: null,
  },
];

const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 },
});

const summary = { totalAttractions: 2, destinations: 1, citiesCovered: 1, withImages: 2 };

const presentations = {
  [sightA]: {
    imageUrl: 'https://files.test/kaza-1.png',
    images: [
      { id: 'img-a1', url: 'https://files.test/kaza-1.png' },
      { id: 'img-a2', url: 'https://files.test/kaza-2.png' },
    ],
  },
  [sightB]: {
    imageUrl: 'https://files.test/sangla.png',
    images: [{ id: 'img-b1', url: 'https://files.test/sangla.png' }],
  },
};

function stubApi(options: { cover?: unknown; putCalls?: unknown[] } = {}) {
  const putCalls = options.putCalls ?? [];
  const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = String(request);
    if (url.includes('/masters/sightseeing/summary')) return response(summary);
    if (url.includes('/masters/sightseeing/presentations')) return response(presentations);
    if (url.includes('/masters/destinations') && init?.method === 'PUT') {
      putCalls.push(JSON.parse(String(init.body)));
      return response({
        destination: { id: destinationId, name: 'Spiti Valley' },
        cards: [],
      });
    }
    if (url.includes('/stylish-cover'))
      return response(
        options.cover ?? { destination: { id: destinationId, name: 'Spiti Valley' }, cards: [] },
      );
    if (url.includes(`/masters/sightseeing/${sightA}`) && !url.includes('/masters/sightseeing?'))
      return response(sightseeings[0]);
    if (url.includes('/masters/sightseeing')) return response(page(sightseeings));
    if (url.includes('/masters/destinations'))
      return response(
        page([
          {
            id: destinationId,
            name: 'Spiti Valley',
            cities: [],
            _count: { cities: 1 },
            hasImage: false,
            images: [],
            createdAt: '2026-07-20T00:00:00.000Z',
            updatedAt: '2026-07-20T00:00:00.000Z',
            createdBy: { id: 'u1', fullName: 'Aditi Rao' },
          },
        ]),
      );
    if (url.includes('/masters/cities')) return response(page([]));
    return response(page([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, putCalls };
}

const ALL = ['masters.sightseeing.view', 'masters.sightseeing.update'];

function renderPage() {
  renderWithProviders(<Routes><Route path="/masters/sightseeing" element={<SightseeingPage />} /></Routes>, {
    route: '/masters/sightseeing',
  });
}

async function openDialog() {
  renderPage();
  await screen.findByRole('heading', { name: 'Spiti Valley' });
  await userEvent.click(screen.getByRole('button', { name: 'Manage Stylish PDF Cover Images' }));
  await screen.findByRole('dialog', { name: /Manage Stylish PDF cover images/ });
}

describe('Destination Stylish PDF cover dialog', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(ALL);
  });

  it('offers a cover manager per destination group', async () => {
    stubApi();
    renderPage();
    await screen.findByRole('heading', { name: 'Spiti Valley' });
    expect(
      screen.getByRole('button', { name: 'Manage Stylish PDF Cover Images' }),
    ).toBeInTheDocument();
  });

  it('selects three images in order and saves them', async () => {
    const { putCalls } = stubApi();
    await openDialog();

    const day6Options = await screen.findAllByRole('button', { name: /Select image .* from DAY 6/ });
    expect(day6Options).toHaveLength(2);
    await userEvent.click(day6Options[0]!);
    await userEvent.click(screen.getByRole('button', { name: /Select image .* from DAY 2/ }));
    // Second image of the same sightseeing record is selectable too.
    await userEvent.click(day6Options[1]!);

    const dialog = screen.getByRole('dialog', { name: /Manage Stylish PDF cover images/ });
    expect(within(dialog).getByText('Card 1')).toBeInTheDocument();
    expect(within(dialog).getByText('Card 2')).toBeInTheDocument();
    expect(within(dialog).getByText('Card 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save cover images' }));
    await waitFor(() => expect(putCalls).toHaveLength(1));
    expect(putCalls[0]).toEqual({
      cards: [
        { sightseeingId: sightA, imageId: 'img-a1' },
        { sightseeingId: sightB, imageId: 'img-b1' },
        { sightseeingId: sightA, imageId: 'img-a2' },
      ],
    });
  });

  it('reorders cards and prevents duplicates and saving fewer than three', async () => {
    stubApi();
    await openDialog();

    await userEvent.click(
      (await screen.findAllByRole('button', { name: /Select image .* from DAY 6/ }))[0]!,
    );
    // The chosen image can no longer be selected again.
    expect(
      (await screen.findAllByRole('button', { name: /Select image kaza-1\.png from DAY 6/ }))[0],
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save cover images' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /Select image .* from DAY 2/ }));
    await userEvent.click(
      (await screen.findAllByRole('button', { name: /Select image .* from DAY 6/ }))[1]!,
    );

    // Move Card 3 up: order becomes Card 1, Card 3, Card 2.
    const dialog = screen.getByRole('dialog', { name: /Manage Stylish PDF cover images/ });
    const card3 = within(dialog).getByText('Card 3').closest('div')!;
    await userEvent.click(within(card3.parentElement!).getByRole('button', { name: 'Move Card 3 up' }));
    expect(screen.getByRole('button', { name: 'Save cover images' })).toBeEnabled();
  });

  it('pre-fills and flags a stale saved image', async () => {
    stubApi({
      cover: {
        destination: { id: destinationId, name: 'Spiti Valley' },
        cards: [
          {
            sightseeingId: sightA,
            imageId: 'img-a1',
            valid: true,
            title: 'DAY 6 | KAZA LOCAL SIGHTSEEING',
            cityName: 'Kaza',
            isPrimary: true,
            url: 'https://files.test/kaza-1.png',
          },
          {
            sightseeingId: sightA,
            imageId: 'img-gone',
            valid: false,
            title: 'DAY 6 | KAZA LOCAL SIGHTSEEING',
            cityName: 'Kaza',
            isPrimary: false,
            url: null,
          },
          {
            sightseeingId: sightB,
            imageId: 'img-b1',
            valid: true,
            title: 'DAY 2 | SANGLA TO KALPA',
            cityName: 'Kaza',
            isPrimary: true,
            url: 'https://files.test/sangla.png',
          },
        ],
      },
    });
    await openDialog();
    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
    // A stale slot blocks saving until it is replaced.
    expect(screen.getByRole('button', { name: 'Save cover images' })).toBeDisabled();
  });

  it('hides the manager without the update permission', async () => {
    auth.permissions = new Set(['masters.sightseeing.view']);
    stubApi();
    renderPage();
    await screen.findByRole('heading', { name: 'Spiti Valley' });
    expect(
      screen.queryByRole('button', { name: 'Manage Stylish PDF Cover Images' }),
    ).not.toBeInTheDocument();
  });
});
