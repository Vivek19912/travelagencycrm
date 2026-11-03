import { Router } from 'express';
import { PERMISSIONS, wacrmCredentialMintSchema, wacrmLeadPayloadSchema } from '@interscale/shared';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../../middleware/authenticate.js';
import { authenticateIntegration } from '../../middleware/wacrm-auth.middleware.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validateRequest } from '../../middleware/validate-request.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { integrationsController } from './wacrm.controller.js';

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

export { router as integrationsRoutes };
