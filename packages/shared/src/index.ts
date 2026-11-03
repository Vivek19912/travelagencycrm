/**
 * @interscale/shared
 *
 * Contracts shared between the Express API and the React web app: response
 * envelopes, error codes, domain enums, the permission catalogue, default role
 * definitions and validation limits.
 *
 * This package must never import Prisma or any server-only dependency — the
 * frontend bundles it.
 */

export * from './constants.js';
export * from './api-response.js';
export * from './integrations.js';
export * from './health.js';
export * from './enums.js';
export * from './permissions.js';
export * from './reminders.js';
export * from './roles.js';
export * from './validation.js';
export * from './auth.js';
export * from './users.js';
export * from './administration.js';
export * from './queries.js';
export * from './quotations.js';
export * from './public-slug.js';
export * from './bookings.js';
export * from './hotel-vouchers.js';
export * from './payments.js';
export * from './email.js';
export * from './customers.js';
export * from './vendors.js';
export * from './countries.js';
export * from './masters.js';
export * from './dashboard.js';
export * from './settings.js';
export * from './reports.js';
export * from './system-masters.js';
export * from './search.js';
