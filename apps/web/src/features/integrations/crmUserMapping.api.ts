import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import type {
  CrmManagedMapping,
  CrmMappingsOverview,
  WacrmCredentialStatus,
} from '@interscale/shared';

const key = ['integrations', 'crm-user-mappings'] as const;
const credentialKey = [...key, 'credential'] as const;

export function useCrmMappingCredential(enabled = true) {
  return useQuery({
    queryKey: credentialKey,
    queryFn: ({ signal }) =>
      apiClient.get<WacrmCredentialStatus>('/integrations/crm-user-mappings/credential', signal),
    retry: false,
    enabled,
  });
}

export function useSaveCrmMappingCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (secret: string) =>
      apiClient.put<WacrmCredentialStatus>('/integrations/crm-user-mappings/credential', { secret }),
    onSuccess: (saved) => qc.setQueryData(credentialKey, saved),
  });
}

export function useRemoveCrmMappingCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.delete<{ deleted: boolean }>('/integrations/crm-user-mappings/credential'),
    onSuccess: () => {
      qc.setQueryData(credentialKey, {
        configured: false,
        keyPrefix: null,
        updatedAt: null,
      } satisfies WacrmCredentialStatus);
      qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useCrmMappings(enabled: boolean) {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => apiClient.get<CrmMappingsOverview>('/integrations/crm-user-mappings', signal),
    enabled,
    retry: false,
  });
}

export function useCreateCrmMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { wacrm_user_id: string; crm_user_id: string }) =>
      apiClient.post<{ mapping: CrmManagedMapping }>('/integrations/crm-user-mappings', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useUpdateCrmMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; crm_user_id: string }) =>
      apiClient.patch<{ mapping: CrmManagedMapping }>(
        `/integrations/crm-user-mappings/${input.id}`,
        { crm_user_id: input.crm_user_id },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useDeleteCrmMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ deleted: boolean }>(`/integrations/crm-user-mappings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}
