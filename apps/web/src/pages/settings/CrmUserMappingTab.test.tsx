import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { CrmUserMappingTab } from './CrmUserMappingTab';

const auth = { hasPermission: (_key: string) => true };

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.hasPermission(key) }),
}));

function response(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => (ok ? { success: true, data } : { success: false, error: data }),
  } as Response;
}

const SALES = { id: 'crm-501', fullName: 'Salesperson X', email: 'x@crm.test', username: 'salesx' };

function mockFetch(handlers: { credential?: unknown; overview?: unknown }) {
  const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
  const mockFn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      body = undefined;
    }
    calls.push({ url: u, method: init?.method ?? 'GET', body });
    if (u.endsWith('/crm-user-mappings/credential')) {
      if ((init?.method ?? 'GET') === 'PUT') {
        return response({ configured: true, keyPrefix: 'wacrm_live_ab…', updatedAt: '2026-11-03T00:00:00.000Z' });
      }
      if (init?.method === 'DELETE') return response({ deleted: true });
      return response(handlers.credential ?? { configured: false, keyPrefix: null, updatedAt: null });
    }
    if (u.endsWith('/crm-user-mappings') && (init?.method ?? 'GET') === 'GET') {
      return response(handlers.overview);
    }
    if (u.endsWith('/crm-user-mappings') && init?.method === 'POST') {
      const b = body as Record<string, string>;
      return response(
        {
          mapping: {
            id: 'map-new',
            wacrm_user_id: b.wacrm_user_id,
            wacrm_name: 'Agent A',
            wacrm_email: 'agent@w.test',
            crm_user_id: b.crm_user_id,
            crm_name: 'Salesperson X',
            crm_email: 'x@crm.test',
            status: 'active',
            created_at: '2026-11-03T00:00:00.000Z',
            updated_at: '2026-11-03T00:00:00.000Z',
          },
        },
        true,
        201,
      );
    }
    if (/\/crm-user-mappings\/.+$/.test(u) && init?.method === 'PATCH') {
      return response({ mapping: (body as Record<string, unknown>) ?? {} });
    }
    if (/\/crm-user-mappings\/.+$/.test(u) && init?.method === 'DELETE') {
      return response({ deleted: true });
    }
    return response({ code: 'NOT_FOUND', message: 'missing stub' }, false, 404);
  });
  vi.stubGlobal('fetch', mockFn);
  return { calls, mockFn };
}

const OVERVIEW = {
  mappings: [
    {
      id: 'map-1',
      wacrm_user_id: 'w-1',
      wacrm_name: 'Agent A',
      wacrm_email: 'agent@w.test',
      crm_user_id: 'crm-501',
      crm_name: 'Salesperson X',
      crm_email: 'x@crm.test',
      status: 'active',
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
    },
  ],
  wacrm_users: [{ id: 'w-1', name: 'Agent A', email: 'agent@w.test', role: 'agent' }],
  crm_users: [SALES],
  crm_reachable: true,
};

beforeEach(() => {
  vi.unstubAllGlobals();
  auth.hasPermission = () => true;
});

describe('CrmUserMappingTab', () => {
  it('shows the credential setup when nothing is configured', async () => {
    mockFetch({});
    renderWithProviders(<CrmUserMappingTab />);
    expect(await screen.findByLabelText('WhatsApp Max API key')).toBeInTheDocument();
    expect(screen.queryByText('Salesperson X')).not.toBeInTheDocument();
  });

  it('saves the key and masks it afterwards (never echoes the secret)', async () => {
    const { calls } = mockFetch({});
    renderWithProviders(<CrmUserMappingTab />);
    fireEvent.change(await screen.findByLabelText('WhatsApp Max API key'), {
      target: { value: 'wacrm_live_secret-value-xyz' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save API key' }));
    await waitFor(() => expect(screen.getByText('wacrm_live_ab…')).toBeInTheDocument());
    expect(document.body.textContent).not.toContain('wacrm_live_secret-value-xyz');
    expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/credential'))).toBe(true);
  });

  it('displays salesperson names — never raw UUIDs', async () => {
    mockFetch({
      credential: { configured: true, keyPrefix: 'wacrm_live_ab…', updatedAt: null },
      overview: OVERVIEW,
    });
    renderWithProviders(<CrmUserMappingTab />);
    expect(await screen.findByText('Salesperson X')).toBeInTheDocument();
    expect(screen.getByText('Agent A')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('crm-501');
    expect(document.body.textContent).not.toContain('w-1');
  });

  it('creates a mapping with ids while showing names', async () => {
    const { calls } = mockFetch({
      credential: { configured: true, keyPrefix: 'wacrm_live_ab…', updatedAt: null },
      overview: { ...OVERVIEW, mappings: [] },
    });
    renderWithProviders(<CrmUserMappingTab />);
    await screen.findByText('No mappings yet');
    fireEvent.change(screen.getByLabelText('WhatsApp Max user'), { target: { value: 'w-1' } });
    fireEvent.change(screen.getByLabelText('CRM salesperson'), { target: { value: 'crm-501' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save mapping' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'POST' &&
            (c.body as Record<string, string>)?.wacrm_user_id === 'w-1' &&
            (c.body as Record<string, string>)?.crm_user_id === 'crm-501',
        ),
      ).toBe(true),
    );
  });

  it('denies non-admin viewers without calling the API', async () => {
    auth.hasPermission = () => false;
    const { mockFn } = mockFetch({});
    renderWithProviders(<CrmUserMappingTab />);
    expect(await screen.findByText('Only administrators can manage CRM user mappings.')).toBeInTheDocument();
    expect(mockFn).not.toHaveBeenCalled();
  });

  it('surfaces backend errors with a retry affordance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ code: 'SERVICE_UNAVAILABLE', message: 'WhatsApp Max is unreachable.' }, false, 502)),
    );
    renderWithProviders(<CrmUserMappingTab />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
