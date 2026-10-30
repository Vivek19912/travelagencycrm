import { Router } from 'express';
import { z } from 'zod';
import { publicAcceptSchema, publicRejectSchema, quotationTrackSchema } from '@interscale/shared';
import { asyncHandler } from '../../utils/async-handler.js';
import { validateRequest } from '../../middleware/validate-request.js';
import { optionalAuth } from '../../middleware/authenticate.js';
import { publicQuotationLimiter } from '../../middleware/rate-limiters.js';
import { sendSuccess } from '../../utils/api-response.js';
import { quotationsService } from './quotations.service.js';

const router = Router();
const token = z.object({ token: z.string().min(32).max(200) });
const slug = z.object({ slug: z.string().min(1).max(200) });
router.use(publicQuotationLimiter);
router.get(
  '/by-slug/:slug',
  optionalAuth,
  validateRequest({ params: slug }),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await quotationsService.publicViewBySlug(req.params.slug!, {
        userAgent: req.get('user-agent') ?? null,
        ip: req.ip ?? null,
        authCompanyId: req.auth?.companyId ?? null,
        staffViewToken: typeof req.query.stv === 'string' ? req.query.stv : null,
        customDomainCompanyId: req.customDomain?.companyId ?? null,
      }),
    ),
  ),
);
router.get(
  '/by-slug/:slug/preview',
  optionalAuth,
  validateRequest({ params: slug }),
  asyncHandler(async (req, res) => {
    // Short public cache: copy changes propagate quickly while crawlers
    // reusing a URL (plus `?v=` cache-busting) keep working previews.
    res.set('Cache-Control', 'public, max-age=600');
    res
      .status(200)
      .type('html')
      .send(
        await quotationsService.publicPreviewBySlug(req.params.slug!, {
          customDomainCompanyId: req.customDomain?.companyId ?? null,
        }),
      );
  }),
);
router.post(
  '/by-slug/:slug/track',
  optionalAuth,
  validateRequest({ params: slug, body: quotationTrackSchema }),
  asyncHandler(async (req, res) => {
    await quotationsService.trackWeblinkVisitBySlug(req.params.slug!, req.body, {
      userAgent: req.get('user-agent') ?? null,
      ip: req.ip ?? null,
      authCompanyId: req.auth?.companyId ?? null,
      staffViewToken: req.body.staffViewToken ?? null,
      customDomainCompanyId: req.customDomain?.companyId ?? null,
    });
    sendSuccess(res, { ok: true });
  }),
);
router.post(
  '/by-slug/:slug/accept',
  validateRequest({ params: slug, body: publicAcceptSchema }),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await quotationsService.publicDecisionBySlug(req.params.slug!, 'accept', req.body),
      'Quotation accepted.',
    ),
  ),
);
router.post(
  '/by-slug/:slug/reject',
  validateRequest({ params: slug, body: publicRejectSchema }),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await quotationsService.publicDecisionBySlug(req.params.slug!, 'reject', req.body),
      'Quotation rejected.',
    ),
  ),
);
router.get(
  '/:token',
  optionalAuth,
  validateRequest({ params: token }),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await quotationsService.publicView(req.params.token!, {
        userAgent: req.get('user-agent') ?? null,
        ip: req.ip ?? null,
        authCompanyId: req.auth?.companyId ?? null,
        staffViewToken: typeof req.query.stv === 'string' ? req.query.stv : null,
        customDomainCompanyId: req.customDomain?.companyId ?? null,
      }),
    ),
  ),
);
router.get(
  '/:token/preview',
  optionalAuth,
  validateRequest({ params: token }),
  asyncHandler(async (req, res) => {
    // Short public cache: copy changes propagate quickly while crawlers
    // reusing a URL (plus `?v=` cache-busting) keep working previews.
    res.set('Cache-Control', 'public, max-age=600');
    res
      .status(200)
      .type('html')
      .send(
        await quotationsService.publicPreviewByToken(req.params.token!, {
          customDomainCompanyId: req.customDomain?.companyId ?? null,
        }),
      );
  }),
);
router.post(
  '/:token/track',
  optionalAuth,
  validateRequest({ params: token, body: quotationTrackSchema }),
  asyncHandler(async (req, res) => {
    await quotationsService.trackWeblinkVisit(req.params.token!, req.body, {
      userAgent: req.get('user-agent') ?? null,
      ip: req.ip ?? null,
      authCompanyId: req.auth?.companyId ?? null,
      staffViewToken: req.body.staffViewToken ?? null,
      customDomainCompanyId: req.customDomain?.companyId ?? null,
    });
    sendSuccess(res, { ok: true });
  }),
);
router.post(
  '/:token/accept',
  validateRequest({ params: token, body: publicAcceptSchema }),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await quotationsService.publicDecision(req.params.token!, 'accept', req.body),
      'Quotation accepted.',
    ),
  ),
);
router.post(
  '/:token/reject',
  validateRequest({ params: token, body: publicRejectSchema }),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await quotationsService.publicDecision(req.params.token!, 'reject', req.body),
      'Quotation rejected.',
    ),
  ),
);
export { router as publicQuotationsRoutes };
