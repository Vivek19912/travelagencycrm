import { useState } from 'react';
import { ArrowLeftRight, Link2, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { PERMISSIONS } from '@interscale/shared';
import type { CrmManagedMapping } from '@interscale/shared';
import { ApiError } from '@/api/client';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField } from '@/components/ui/FormField';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  useCreateCrmMapping,
  useCrmMappingCredential,
  useCrmMappings,
  useDeleteCrmMapping,
  useRemoveCrmMappingCredential,
  useSaveCrmMappingCredential,
  useUpdateCrmMapping,
} from '@/features/integrations/crmUserMapping.api';

const inputClass = 'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm';

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}

const STATUS_TONE = {
  active: 'success',
  'crm-user-removed': 'danger',
  'wacrm-user-removed': 'danger',
  unknown: 'neutral',
} as const;

const STATUS_LABEL: Record<CrmManagedMapping['status'], string> = {
  active: 'Active',
  'crm-user-removed': 'Salesperson removed',
  'wacrm-user-removed': 'User removed',
  unknown: 'Unknown',
};

/**
 * CRM User Mapping — Settings → Integrations tab (company admins).
 *
 * Manages the mappings stored in WhatsApp Max (one WhatsApp Max user
 * → one Travel Agency CRM salesperson, by internal ids) through this
 * company's stored API key. The key is pasted once, encrypted at rest,
 * and never shown again; every management call is proxied server-side
 * so neither secret ever reaches the browser.
 */
export function CrmUserMappingTab() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission(PERMISSIONS.SETTINGS_UPDATE);
  // Non-managers never fire the credential query (defence in depth;
  // the tab itself only renders for managers).
  const credential = useCrmMappingCredential(canManage);
  const saveCredential = useSaveCrmMappingCredential();
  const removeCredential = useRemoveCrmMappingCredential();
  const mappings = useCrmMappings(credential.data?.configured === true);

  const [secret, setSecret] = useState('');
  const [secretError, setSecretError] = useState('');
  const [confirmingRemoveKey, setConfirmingRemoveKey] = useState(false);
  const [removeKeyFeedback, setRemoveKeyFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [wacrmUserId, setWacrmUserId] = useState('');
  const [crmUserId, setCrmUserId] = useState('');
  const createMapping = useCreateCrmMapping();
  const [createError, setCreateError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCrmUserId, setEditCrmUserId] = useState('');
  const updateMapping = useUpdateCrmMapping();
  const [editError, setEditError] = useState('');

  const [deleting, setDeleting] = useState<CrmManagedMapping | null>(null);
  const deleteMapping = useDeleteCrmMapping();
  const [deleteError, setDeleteError] = useState('');

  const configured = credential.data?.configured === true;
  const overview = mappings.data;
  const unmappedWacrmUsers = (overview?.wacrm_users ?? []).filter(
    (u) => !(overview?.mappings ?? []).some((m) => m.wacrm_user_id === u.id),
  );

  async function handleSaveCredential() {
    setSecretError('');
    if (!secret.trim()) {
      setSecretError('Paste the WhatsApp Max API key first.');
      return;
    }
    try {
      await saveCredential.mutateAsync(secret.trim());
      setSecret('');
    } catch (err) {
      setSecretError(messageOf(err));
    }
  }

  async function handleRemoveCredential() {
    setRemoveKeyFeedback(null);
    try {
      await removeCredential.mutateAsync();
      setConfirmingRemoveKey(false);
      setRemoveKeyFeedback({ ok: true, message: 'API key removed.' });
    } catch (err) {
      setRemoveKeyFeedback({ ok: false, message: messageOf(err) });
    }
  }

  async function handleCreate() {
    setCreateError('');
    if (!wacrmUserId || !crmUserId) {
      setCreateError('Choose a WhatsApp Max user and a salesperson.');
      return;
    }
    try {
      await createMapping.mutateAsync({ wacrm_user_id: wacrmUserId, crm_user_id: crmUserId });
      setWacrmUserId('');
      setCrmUserId('');
    } catch (err) {
      setCreateError(messageOf(err));
    }
  }

  async function handleUpdate(id: string) {
    setEditError('');
    if (!editCrmUserId) {
      setEditError('Choose a salesperson.');
      return;
    }
    try {
      await updateMapping.mutateAsync({ id, crm_user_id: editCrmUserId });
      setEditingId(null);
    } catch (err) {
      setEditError(messageOf(err));
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteError('');
    try {
      await deleteMapping.mutateAsync(deleting.id);
      setDeleting(null);
    } catch (err) {
      setDeleteError(messageOf(err));
    }
  }

  if (!canManage) {
    return <Alert tone="error">Only administrators can manage CRM user mappings.</Alert>;
  }

  if (credential.isLoading) {
    return <Skeleton className="h-96" />;
  }
  if (credential.isError) {
    return (
      <Alert tone="error">
        CRM user mapping settings could not be loaded.{' '}
        <Button variant="secondary" size="sm" onClick={() => credential.refetch()}>
          Retry
        </Button>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="CRM User Mapping"
        description="Map each WhatsApp Max user to the Travel Agency CRM salesperson their Workspace-created leads are assigned to. Users without a mapping fall back to the workspace owner."
      />

      <Card>
        <CardHeader><h2 className="font-semibold">WhatsApp Max connection</h2></CardHeader>
        <CardBody>
          {configured ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                Connected with key <Badge>{credential.data?.keyPrefix ?? '…'}</Badge>{' '}
                {credential.data?.updatedAt
                  ? `· saved ${new Date(credential.data.updatedAt).toLocaleDateString()}`
                  : ''}
              </p>
              {canManage && !confirmingRemoveKey && (
                <Button variant="danger" size="sm" onClick={() => setConfirmingRemoveKey(true)}>
                  Remove API key
                </Button>
              )}
              {removeKeyFeedback && (
                <p
                  role={removeKeyFeedback.ok ? 'status' : 'alert'}
                  className={`text-sm ${removeKeyFeedback.ok ? 'text-emerald-700' : 'text-red-700'}`}
                >
                  {removeKeyFeedback.message}
                </p>
              )}
              {canManage && confirmingRemoveKey && (
                <div role="alertdialog" aria-label="Remove WhatsApp Max API key" className="rounded-lg border border-red-200 bg-red-50/60 p-4">
                  <p className="text-sm text-slate-700">
                    Remove the saved API key? Mappings stay stored in WhatsApp Max but can no
                    longer be managed from here until a key is saved again.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Button variant="secondary" size="sm" disabled={removeCredential.isPending} onClick={() => setConfirmingRemoveKey(false)}>
                      Cancel
                    </Button>
                    <Button variant="danger" size="sm" isLoading={removeCredential.isPending} onClick={handleRemoveCredential}>
                      Remove API key
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                Paste a WhatsApp Max API key with the <strong>CRM-mappings</strong> scope (mint it
                in WhatsApp Max under Settings → API keys). It is encrypted at rest and never
                shown again.
              </p>
              <FormField label="WhatsApp Max API key" required>
                <input
                  aria-label="WhatsApp Max API key"
                  type="password"
                  autoComplete="new-password"
                  className={inputClass}
                  placeholder="wacrm_live_…"
                  value={secret}
                  onChange={(e) => {
                    setSecret(e.target.value);
                    if (secretError) setSecretError('');
                  }}
                  disabled={!canManage || saveCredential.isPending}
                />
              </FormField>
              {secretError && (
                <p role="alert" className="text-sm text-red-700">
                  {secretError}
                </p>
              )}
              {canManage && (
                <Button isLoading={saveCredential.isPending} onClick={handleSaveCredential}>
                  Save API key
                </Button>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {configured && (
        <Card>
          <CardHeader><h2 className="font-semibold">Mappings</h2></CardHeader>
          <CardBody>
            {mappings.isLoading ? (
              <Skeleton className="h-48" />
            ) : mappings.isError || !mappings.data ? (
              <Alert tone="error">
                Mappings could not be loaded. {messageOf(mappings.error)}{' '}
                <Button variant="secondary" size="sm" onClick={() => mappings.refetch()}>
                  Retry
                </Button>
              </Alert>
            ) : (
              <div className="space-y-5">
                {!mappings.data.crm_reachable && (
                  <Alert tone="info">
                    WhatsApp Max is currently unreachable — saved mappings are intact, but names
                    and statuses may be stale.
                  </Alert>
                )}
                {canManage && (
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <FormField label="WhatsApp Max user" required>
                      <select
                        aria-label="WhatsApp Max user"
                        className={inputClass}
                        value={wacrmUserId}
                        onChange={(e) => setWacrmUserId(e.target.value)}
                      >
                        <option value="">Select user</option>
                        {unmappedWacrmUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                            {u.email && u.email !== u.name ? ` (${u.email})` : ''}
                            {u.role ? ` · ${u.role}` : ''}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="CRM salesperson" required>
                      <select
                        aria-label="CRM salesperson"
                        className={inputClass}
                        value={crmUserId}
                        onChange={(e) => setCrmUserId(e.target.value)}
                      >
                        <option value="">Select salesperson</option>
                        {(overview?.crm_users ?? []).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.fullName}
                            {u.email && u.email !== u.fullName ? ` (${u.email})` : ''}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <Button isLoading={createMapping.isPending} onClick={handleCreate}>
                      <Plus className="h-4 w-4" /> Save mapping
                    </Button>
                  </div>
                )}
                {createError && (
                  <p role="alert" className="text-sm text-red-700">
                    {createError}
                  </p>
                )}
                {mappings.data.mappings.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="No mappings yet"
                    description="Leads are assigned to the workspace owner until you add a mapping."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-slate-500">
                          <th className="py-2 pr-3 font-medium">WhatsApp Max user</th>
                          <th className="py-2 pr-3 font-medium">CRM salesperson</th>
                          <th className="py-2 pr-3 font-medium">Status</th>
                          <th className="py-2 pr-3 font-medium">Created</th>
                          {canManage && <th className="py-2 text-right font-medium">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {mappings.data.mappings.map((m) => (
                          <tr key={m.id} className="border-b last:border-0">
                            <td className="py-2 pr-3">
                              <div className="font-medium">{m.wacrm_name ?? 'Unknown user'}</div>
                              {m.wacrm_email && (
                                <div className="text-xs text-slate-500">{m.wacrm_email}</div>
                              )}
                            </td>
                            <td className="py-2 pr-3">
                              {editingId === m.id ? (
                                <select
                                  aria-label="CRM salesperson"
                                  className={inputClass}
                                  value={editCrmUserId}
                                  onChange={(e) => setEditCrmUserId(e.target.value)}
                                >
                                  <option value="">Select salesperson</option>
                                  {(overview?.crm_users ?? []).map((u) => (
                                    <option key={u.id} value={u.id}>
                                      {u.fullName}
                                      {u.email && u.email !== u.fullName ? ` (${u.email})` : ''}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <>
                                  <div className="font-medium">{m.crm_name ?? 'Unknown salesperson'}</div>
                                  {m.crm_email && (
                                    <div className="text-xs text-slate-500">{m.crm_email}</div>
                                  )}
                                </>
                              )}
                            </td>
                            <td className="py-2 pr-3">
                              <StatusBadge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</StatusBadge>
                            </td>
                            <td className="py-2 pr-3 text-slate-600">
                              {new Date(m.created_at).toLocaleDateString()}
                            </td>
                            {canManage && (
                              <td className="py-2 text-right">
                                {editingId === m.id ? (
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => {
                                        setEditingId(null);
                                        setEditError('');
                                      }}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      isLoading={updateMapping.isPending}
                                      onClick={() => handleUpdate(m.id)}
                                    >
                                      Save
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      aria-label={`Edit mapping for ${m.wacrm_name ?? 'user'}`}
                                      onClick={() => {
                                        setEditingId(m.id);
                                        setEditCrmUserId(m.crm_user_id);
                                        setEditError('');
                                      }}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      aria-label={`Delete mapping for ${m.wacrm_name ?? 'user'}`}
                                      onClick={() => {
                                        setDeleting(m);
                                        setDeleteError('');
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {editError && (
                  <p role="alert" className="text-sm text-red-700">
                    {editError}
                  </p>
                )}
                {deleting && (
                  <div
                    role="alertdialog"
                    aria-label="Delete mapping"
                    className="rounded-lg border border-red-200 bg-red-50/60 p-4"
                  >
                    <p className="text-sm text-slate-700">
                      Delete the mapping for {deleting.wacrm_name ?? 'this user'}? Their future
                      leads will fall back to the workspace owner.
                    </p>
                    {deleteError && (
                      <p role="alert" className="mt-2 text-sm text-red-700">
                        {deleteError}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Button variant="secondary" size="sm" onClick={() => setDeleting(null)}>
                        Cancel
                      </Button>
                      <Button variant="danger" size="sm" isLoading={deleteMapping.isPending} onClick={handleDelete}>
                        Delete mapping
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <p className="flex items-start gap-2 text-sm text-slate-600">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Mappings are stored in WhatsApp Max and matched by internal user IDs — matching
              emails or names are not required. <ArrowLeftRight className="inline h-3 w-3" /> Lead
              assignment keeps using the saved mapping; edits apply to future leads only.
            </span>
          </p>
        </CardBody>
      </Card>
    </div>
  );
}


