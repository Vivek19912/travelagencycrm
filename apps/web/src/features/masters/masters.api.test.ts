import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchAllMasterPages,
  masterImageFingerprint,
  refreshMasterImageQueries,
  type MasterImageMeta,
} from './masters.api';
import { apiClient } from '@/api/client';

vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn() } }));

const image = (id: string, fileName = 'image.png', isPrimary = true): MasterImageMeta => ({
  id,
  fileName,
  mimeType: 'image/png',
  fileSize: 100,
  isPrimary,
});

describe('fetchAllMasterPages — complete destination-scoped retrieval', () => {
  it('pages through the full filtered result and dedupes overlapping rows by id', async () => {
    const get = vi.mocked(apiClient.get);
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      const page = Number(new URL(url, 'http://localhost').searchParams.get('page'));
      if (page === 1)
        return {
          data: [{ id: 'a' }, { id: 'b' }],
          pagination: { page: 1, pageSize: 100, total: 3, totalPages: 2 },
        };
      return {
        data: [{ id: 'b' }, { id: 'c' }],
        pagination: { page: 2, pageSize: 100, total: 3, totalPages: 2 },
      };
    });
    const result = await fetchAllMasterPages<{ id: string }>(
      '/masters/hotels',
      new URLSearchParams({ status: 'ACTIVE', destinationId: 'dest-1' }),
    );
    // Overlapping row `b` is kept once; the default on page 2 is retrieved.
    expect(result.data.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    // Every request reuses the same destination-scoped filters at the max page size.
    expect(get).toHaveBeenCalledTimes(2);
    for (const [url] of get.mock.calls) {
      expect(String(url)).toContain('status=ACTIVE');
      expect(String(url)).toContain('destinationId=dest-1');
      expect(String(url)).toContain('pageSize=100');
    }
  });

  it('rejects when any page fails instead of returning a partial result', async () => {
    const get = vi.mocked(apiClient.get);
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      const page = Number(new URL(url, 'http://localhost').searchParams.get('page'));
      if (page === 1)
        return {
          data: [{ id: 'a' }],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 2 },
        };
      throw new Error('page 2 failed');
    });
    await expect(
      fetchAllMasterPages<{ id: string }>('/masters/hotels', new URLSearchParams()),
    ).rejects.toThrow('page 2 failed');
  });
});

describe('Master image query synchronization', () => {
  it('changes the thumbnail fingerprint when an identical-filename primary gets a new image ID', () => {
    expect(masterImageFingerprint({ images: [image('image-a')] })).toBe('image-a');
    expect(masterImageFingerprint({ images: [image('image-b')] })).toBe('image-b');
  });

  it.each([
    ['destinations', ['masters', 'destinations']],
    ['hotels', ['masters', 'hotels']],
  ] as const)(
    'awaits authoritative list, detail, and thumbnail refreshes for %s',
    async (scope, root) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let currentId = 'image-a';
      const listQuery = vi.fn(async () => ({
        data: [{ id: 'master-1', images: [image(currentId)] }],
      }));
      const detailQuery = vi.fn(async () => ({ id: 'master-1', images: [image(currentId)] }));
      const thumbnailQuery = vi.fn(async () => ({ url: `https://images.example/${currentId}` }));
      const listKey = [...root, 'pageSize=10'];
      const detailKey = [...root, 'master-1'];
      const thumbnailKey = [...root, 'master-1', 'image', 'image-a'];

      await Promise.all([
        client.fetchQuery({ queryKey: listKey, queryFn: listQuery }),
        client.fetchQuery({ queryKey: detailKey, queryFn: detailQuery }),
        client.fetchQuery({ queryKey: thumbnailKey, queryFn: thumbnailQuery }),
      ]);
      currentId = 'image-b';

      await refreshMasterImageQueries(client, scope);

      expect(client.getQueryData(listKey)).toEqual({
        data: [{ id: 'master-1', images: [image('image-b')] }],
      });
      expect(client.getQueryData(detailKey)).toEqual({
        id: 'master-1',
        images: [image('image-b')],
      });
      expect(client.getQueryData(thumbnailKey)).toEqual({
        url: 'https://images.example/image-b',
      });
      expect(listQuery).toHaveBeenCalledTimes(2);
      expect(detailQuery).toHaveBeenCalledTimes(2);
      expect(thumbnailQuery).toHaveBeenCalledTimes(2);
    },
  );
});
