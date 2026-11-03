import { Router } from 'express';
import {
  PERMISSIONS,
  crmMappingCreateSchema,
  crmMappingIdParamsSchema,
  crmMappingUpdateSchema,
  wacrmApiKeySchema,
  wacrmCredentialMintSchema,
  wacrmLeadPayloadSchema,
} from '@interscale/shared';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../../middleware/authenticate.js';
import { authenticateIntegration } from '../../middleware/wacrm-auth.middleware.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validateRequest } from '../../middleware/validate-request.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { integrationsController } from './wacrm.controller.js';
import { crmMappingsController } from './crm-mappings.controller.js';

const router = Router();
const credentialId = z.object({ id: z.string().uuid() });

// --- Credential lifecycle (interactive sessions, settings permission).
// The minted secret is returned once; afterwards only metadata reads.
router.post(
  '/credentials',
  requireAuth,
  requireVerifiedEmail,
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  validateRequest({ body: wacrmCredentialMintSchema }),
  asyncHandler(integrationsController.mintCredential),
);
router.get(
  '/credentials',
  requireAuth,
  requireVerifiedEmail,
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  asyncHandler(integrationsController.listCredentials),
);
router.delete(
  '/credentials/:id',
  requireAuth,
  requireVerifiedEmail,
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  validateRequest({ params: credentialId }),
  asyncHandler(integrationsController.revokeCredential),
);

// --- WACRM server-to-server surface (Bearer integration credential).
// Tenant and actor derive from the credential, never the request.
router.get(
  '/wacrm/lookups',
  authenticateIntegration,
  requirePermission(PERMISSIONS.QUERIES_VIEW),
  asyncHandler(integrationsController.wacrmLookups),
);
router.post(
  '/wacrm/leads',
  authenticateIntegration,
  requirePermission(PERMISSIONS.QUERIES_CREATE),
  validateRequest({ body: wacrmLeadPayloadSchema }),
  asyncHandler(integrationsController.wacrmCreateLead),
);

// Read-only existence probe for WACRM stale-link recovery: answers
// whether a lead id exists in the locator-scoped company. Always
// 200 with { exists } (missing reads the same as foreign-tenant,
// so nothing leaks); auth failures stay 401 via the middleware.
router.get(
  '/wacrm/leads/:id',
  authenticateIntegration,
  requirePermission(PERMISSIONS.QUERIES_VIEW),
  validateRequest({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(integrationsController.wacrmLeadExists),
);

// --- CRM User Mapping management (interactive admin sessions).
// The mappings live in WhatsApp Max; these session-gated endpoints
// proxy to its versioned machine API using the per-company API key
// stored encrypted server-side (never in the browser, never in
// logs). Only settings managers may manage them.
router.get(
  '/crm-user-mappings/credential',
  requireAuth,
  requireVerifiedEmail,
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  asyncHandler(crmMappingsController.credentialStatus),
);
router.put(
  '/crm-user-mappings/credential',
  requireAuth,
  requireVerifiedEmail,
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  validateRequest({ body: z.object({ secret: wacrmApiKeySchema }) }),
  asyncHandler(crmMappingsController.saveCredential),
);
router.delete(
  '/crm-user-mappings/credential',
  requireAuth,
  requireVerifiedEmail,
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  asyncHandler(crmMappingsController.deleteCredential),
);
router.get(
  '/crm-user-mappings',
  requireAuth,
  requireVerifiedEmail,
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  asyncHandler(crmMappingsController.list),
);
router.post(
  '/crm-user-mappings',
  requireAuth,
  requireVerifiedEmail,
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  validateRequest({ body: crmMappingCreateSchema }),
  asyncHandler(crmMappingsController.create),
);
router.patch(
  '/crm-user-mappings/:id',
  requireAuth,
  requireVerifiedEmail,
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  validateRequest({ params: crmMappingIdParamsSchema, body: crmMappingUpdateSchema }),
  asyncHandler(crmMappingsController.update),
);
router.delete(
  '/crm-user-mappings/:id',
  requireAuth,
  requireVerifiedEmail,
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  validateRequest({ params: crmMappingIdParamsSchema }),
  asyncHandler(crmMappingsController.remove),
);

export { router as integrationsRoutes };
