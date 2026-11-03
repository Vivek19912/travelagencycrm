import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/api-response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { crmMappingsService } from './crm-mappings.service.js';

function auth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export const crmMappingsController = {
  async credentialStatus(req: Request, res: Response) {
    sendSuccess(res, await crmMappingsService.credentialStatus(auth(req)));
  },

  async saveCredential(req: Request, res: Response) {
    // The raw key travels only in this request body over the
    // session-authenticated channel; it is encrypted at rest and
    // never echoed back (status returns a masked prefix only).
    sendSuccess(
      res,
      await crmMappingsService.saveCredential(auth(req), req.body.secret),
      'WhatsApp Max API key saved.',
    );
  },

  async deleteCredential(req: Request, res: Response) {
    sendSuccess(
      res,
      await crmMappingsService.deleteCredential(auth(req)),
      'WhatsApp Max API key removed.',
    );
  },

  async list(req: Request, res: Response) {
    sendSuccess(res, await crmMappingsService.overview(auth(req)));
  },

  async create(req: Request, res: Response) {
    sendSuccess(
      res,
      await crmMappingsService.createMapping(auth(req), req.body),
      'Mapping created.',
      201,
    );
  },

  async update(req: Request, res: Response) {
    sendSuccess(
      res,
      await crmMappingsService.updateMapping(auth(req), req.params.id!, req.body),
      'Mapping updated.',
    );
  },

  async remove(req: Request, res: Response) {
    sendSuccess(
      res,
      await crmMappingsService.deleteMapping(auth(req), req.params.id!),
      'Mapping deleted.',
    );
  },
};
