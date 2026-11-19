import crypto from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { Prisma, type DestinationType, type MasterStatus } from '@prisma/client';
import {
  COUNTRIES,
  MASTER_TYPE,
  PERMISSIONS,
  countryNameForCode,
  normalizeDestinationStylishCover,
  type CityInput,
  type CityUpdateInput,
  type DestinationImageUploadInput,
  type DestinationInput,
  type DestinationStylishCoverInput,
  type DestinationUpdateInput,
} from '@interscale/shared';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import type { AuthContext } from '../../middleware/authenticate.js';
import {
  destinationImageObjectKey,
  storageService,
} from '../../services/storage/storage.service.js';
import { normalizeCustomerName } from '../../utils/normalize.js';
import {
  buildPaginationMeta,
  resolvePagination,
  toPrismaPagination,
} from '../../utils/pagination.js';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { permissionsService } from '../auth/permissions.service.js';
import {
  assertCanModifyMaster,
  buildVisibleWhere,
  masterRecordMeta,
  resolveMasterScope,
  type MasterScope,
} from './master-visibility.js';
import {
  appendMasterImage,
  collectMasterStorageKeys,
  deleteMasterStorageKeys,
  effectiveMasterImages,
  findMasterImage,
  masterImageWriteData,
  partitionKeysBySnapshotReferences,
  presentMasterImages,
  removeMasterImage,
  reorderMasterImages,
} from './master-images.js';

export type MastersRequestContext = { ipAddress: string | null; userAgent: string | null };
const blankToNull = (value: string | null | undefined): string | null =>
  value?.trim() ? value.trim() : null;
const userSelect = { id: true, fullName: true } as const;
const has = (auth: AuthContext, permission: string) =>
  permissionsService.userHasPermission(auth.userId, permission);
const cleanAirport = (value: string | null | undefined) => value?.trim().toUpperCase() || null;

function audit(
  auth: AuthContext,
  action: Prisma.ActivityLogUncheckedCreateInput['action'],
  entityType: 'City' | 'Destination',
  entityId: string,
  context: MastersRequestContext,
  metadata?: Prisma.InputJsonValue,
): Prisma.ActivityLogUncheckedCreateInput {
  return {
    companyId: auth.companyId,
    actorUserId: auth.userId,
    action,
    entityType,
    entityId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

const richTextAlignStyle = {
  'text-align': [/^left$/i, /^center$/i, /^right$/i, /^justify$/i],
};
const richTextColorStyles = {
  ...richTextAlignStyle,
  color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(\s*(\d{1,3}%?\s*,\s*){2}\d{1,3}%?\s*\)$/i],
  'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb\(\s*(\d{1,3}%?\s*,\s*){2}\d{1,3}%?\s*\)$/i],
};

export function sanitizeRichText(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  // The allowlist must cover everything the Masters rich-text editor produces
  // (contentEditable divs per line, alignment, font colors, code blocks), or
  // formatting such as line breaks and alignment would be lost on save.
  const safe = sanitizeHtml(value, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'ul',
      'ol',
      'li',
      'blockquote',
      'h2',
      'h3',
      'a',
      'div',
      'span',
      'font',
      'pre',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      font: ['color', 'face', 'size'],
      '*': ['align'],
      p: ['style'],
      div: ['style'],
      span: ['style'],
    },
    allowedStyles: {
      p: richTextColorStyles,
      div: richTextColorStyles,
      span: richTextColorStyles,
      font: richTextColorStyles,
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: (_tag, attrs) => ({
        tagName: 'a',
        attribs: { ...attrs, target: '_blank', rel: 'noopener noreferrer' },
      }),
    },
  }).trim();
  return safe || null;
}

function countrySnapshot(code: string): string {
  const name = countryNameForCode(code);
  if (!name) throw new ValidationError('Select a valid country.');
  return name;
}

function duplicateError(error: unknown, label: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    throw new ConflictError(`${label} already exists in that country.`);
  throw error;
}

function presentCity<T extends Record<string, unknown>>(row: T, scope: MasterScope) {
  const { companyId, normalizedName, ...safe } = row;
  void companyId;
  void normalizedName;
  return {
    ...safe,
    ...masterRecordMeta({ companyId: String(companyId) }, scope),
  };
}

function presentDestination<T extends Record<string, unknown>>(row: T, scope: MasterScope) {
  const {
    companyId,
    normalizedName,
    imageBucket,
    imageObjectKey,
    pendingImageObjectKey,
    pendingImageFileName,
    pendingImageMimeType,
    pendingImageFileSize,
    cities,
    ...safe
  } = row;
  void companyId;
  void normalizedName;
  void imageBucket;
  void imageObjectKey;
  void pendingImageObjectKey;
  void pendingImageFileName;
  void pendingImageMimeType;
  void pendingImageFileSize;
  const hiddenCityIds = new Set(scope.hiddenMasterIds);
  const safeCities = Array.isArray(cities)
    ? cities
        .map((link) => {
          const value = link as Record<string, unknown>;
          const city = value.city as Record<string, unknown>;
          const {
            companyId: _companyId,
            normalizedName: _normalizedName,
            ...safeCity
          } = city;
          void _companyId;
          void _normalizedName;
          return { id: value.id, sequence: value.sequence, cityId: value.cityId, city: safeCity };
        })
        .filter(
          (link) =>
            // A tenant that hid a global city must not see it listed under a
            // destination's city selector either.
            !(
              scope.systemCompanyId &&
              String((link as { city: Record<string, unknown> }).city.companyId) ===
                scope.systemCompanyId &&
              hiddenCityIds.has(link.cityId as string)
            ),
        )
    : [];
  return {
    ...safe,
    ...masterRecordMeta({ companyId: String(companyId) }, scope),
    cities: safeCities,
    hasImage: Boolean(imageObjectKey && row.imageConfirmedAt),
    images: presentMasterImages(row as unknown as Parameters<typeof presentMasterImages>[0]),
  };
}

async function managerVisibility(auth: AuthContext, updatePermission: string) {
  return has(auth, updatePermission);
}

async function getCity(auth: AuthContext, cityId: string, scope: MasterScope) {
  const canManage = await managerVisibility(auth, PERMISSIONS.MASTER_CITIES_UPDATE);
  const city = await prisma.city.findFirst({
    where: {
      id: cityId,
      ...buildVisibleWhere(scope),
      ...(canManage ? {} : { status: 'ACTIVE' }),
    },
    include: { createdBy: { select: userSelect }, _count: { select: { destinationLinks: true } } },
  });
  if (!city) throw new NotFoundError('City not found.');
  return city;
}

const destinationInclude = {
  createdBy: { select: userSelect },
  cities: { orderBy: { sequence: 'asc' as const }, include: { city: true } },
  _count: { select: { cities: true } },
} as const;

async function getDestination(auth: AuthContext, destinationId: string, scope: MasterScope) {
  const canManage = await managerVisibility(auth, PERMISSIONS.MASTER_DESTINATIONS_UPDATE);
  const destination = await prisma.destination.findFirst({
    where: {
      id: destinationId,
      ...buildVisibleWhere(scope),
      ...(canManage ? {} : { status: 'ACTIVE' }),
    },
    include: destinationInclude,
  });
  if (!destination) throw new NotFoundError('Destination not found.');
  return destination;
}

async function validateCities(scope: MasterScope, countryCode: string, cityIds: string[]) {
  if (new Set(cityIds).size !== cityIds.length)
    throw new ValidationError('A city can only be selected once.');
  const cities = await prisma.city.findMany({
    where: {
      id: { in: cityIds },
      countryCode,
      status: 'ACTIVE',
      ...buildVisibleWhere(scope),
    },
    select: { id: true },
  });
  if (cities.length !== cityIds.length)
    throw new ValidationError(
      'Every selected city must be active, visible to this company, and belong to the chosen country.',
    );
}

function policyData(input: DestinationInput | DestinationUpdateInput) {
  return {
    ...('inclusions' in input ? { inclusions: sanitizeRichText(input.inclusions) } : {}),
    ...('exclusions' in input ? { exclusions: sanitizeRichText(input.exclusions) } : {}),
    ...('paymentPolicies' in input
      ? { paymentPolicies: sanitizeRichText(input.paymentPolicies) }
      : {}),
    ...('cancellationPolicies' in input
      ? { cancellationPolicies: sanitizeRichText(input.cancellationPolicies) }
      : {}),
    ...('bookingTerms' in input ? { bookingTerms: sanitizeRichText(input.bookingTerms) } : {}),
    ...('childPolicy' in input ? { childPolicy: sanitizeRichText(input.childPolicy) } : {}),
  };
}

export const citiesService = {
  async list(auth: AuthContext, query: Record<string, unknown>) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.CITY);
    const pagination = resolvePagination({
      page: Number(query.page) || undefined,
      pageSize: Number(query.pageSize) || 10,
    });
    const canManage = await managerVisibility(auth, PERMISSIONS.MASTER_CITIES_UPDATE);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const status = query.status ? (String(query.status) as MasterStatus) : undefined;
    const where: Prisma.CityWhereInput = {
      ...buildVisibleWhere(scope),
      ...(canManage ? { ...(status ? { status } : {}) } : { status: 'ACTIVE' }),
      ...(query.country ? { countryCode: String(query.country) } : {}),
      ...(query.hasAirportCode !== undefined
        ? query.hasAirportCode
          ? { airportCode: { not: null } }
          : { airportCode: null }
        : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: query.createdFrom as Date } : {}),
              ...(query.createdTo ? { lte: query.createdTo as Date } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { airportCode: { contains: search, mode: 'insensitive' } },
              { countryName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const order = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const sortBy = String(query.sortBy ?? 'createdAt');
    const orderBy: Prisma.CityOrderByWithRelationInput =
      sortBy === 'country'
        ? { countryName: order }
        : sortBy === 'airportCode'
          ? { airportCode: order }
          : sortBy === 'createdAt'
            ? { createdAt: order }
            : sortBy === 'updatedAt'
              ? { updatedAt: order }
              : { name: order };
    const [rows, total] = await Promise.all([
      prisma.city.findMany({
        where,
        ...toPrismaPagination(pagination),
        orderBy,
        include: {
          createdBy: { select: userSelect },
          _count: { select: { destinationLinks: true } },
        },
      }),
      prisma.city.count({ where }),
    ]);
    return {
      data: rows.map((row) => presentCity(row as unknown as Record<string, unknown>, scope)),
      pagination: buildPaginationMeta(pagination, total),
    };
  },

  async lookups(auth: AuthContext, query: Record<string, unknown>) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.CITY);
    const countryCode = typeof query.country === 'string' ? query.country : undefined;
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const cities = countryCode
      ? await prisma.city.findMany({
          where: {
            ...buildVisibleWhere(scope),
            countryCode,
            status: 'ACTIVE',
            ...(search
              ? {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { airportCode: { contains: search, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          orderBy: { name: 'asc' },
          take: 100,
          select: { id: true, name: true, airportCode: true, countryCode: true },
        })
      : [];
    return { countries: COUNTRIES, cities };
  },

  async details(auth: AuthContext, cityId: string) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.CITY);
    return presentCity(
      (await getCity(auth, cityId, scope)) as unknown as Record<string, unknown>,
      scope,
    );
  },

  async create(auth: AuthContext, input: CityInput, context: MastersRequestContext) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.CITY);
    const normalizedName = normalizeCustomerName(input.name);
    try {
      const city = await prisma.$transaction(async (tx) => {
        const created = await tx.city.create({
          data: {
            companyId: auth.companyId,
            countryCode: input.countryCode,
            countryName: countrySnapshot(input.countryCode),
            name: input.name.trim(),
            normalizedName,
            airportCode: cleanAirport(input.airportCode),
            status: input.status,
            createdById: auth.userId,
          },
          include: {
            createdBy: { select: userSelect },
            _count: { select: { destinationLinks: true } },
          },
        });
        await tx.activityLog.create({
          data: audit(auth, 'CITY_CREATED', 'City', created.id, context, {
            countryCode: created.countryCode,
            airportCode: created.airportCode,
            sourceGlobal: scope.isSystemAdmin,
          }),
        });
        return created;
      });
      return presentCity(city as unknown as Record<string, unknown>, scope);
    } catch (error) {
      duplicateError(error, 'That city');
    }
  },

  async update(
    auth: AuthContext,
    cityId: string,
    input: CityUpdateInput,
    context: MastersRequestContext,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.CITY);
    const current = await getCity(auth, cityId, scope);
    assertCanModifyMaster(current, scope);
    try {
      const city = await prisma.$transaction(async (tx) => {
        const updated = await tx.city.update({
          where: { id: current.id },
          data: {
            ...(input.countryCode
              ? { countryCode: input.countryCode, countryName: countrySnapshot(input.countryCode) }
              : {}),
            ...(input.name
              ? { name: input.name.trim(), normalizedName: normalizeCustomerName(input.name) }
              : {}),
            ...(input.airportCode !== undefined
              ? { airportCode: cleanAirport(input.airportCode) }
              : {}),
            ...(input.status
              ? {
                  status: input.status,
                }
              : {}),
          },
          include: {
            createdBy: { select: userSelect },
            _count: { select: { destinationLinks: true } },
          },
        });
        await tx.activityLog.create({
          data: audit(auth, 'CITY_UPDATED', 'City', updated.id, context, {
            changedFields: Object.keys(input),
          }),
        });
        return updated;
      });
      return presentCity(city as unknown as Record<string, unknown>, scope);
    } catch (error) {
      duplicateError(error, 'That city');
    }
  },

  async status(
    auth: AuthContext,
    cityId: string,
    status: MasterStatus,
    context: MastersRequestContext,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.CITY);
    const current = await getCity(auth, cityId, scope);
    assertCanModifyMaster(current, scope);
    try {
      const city = await prisma.$transaction(async (tx) => {
        const updated = await tx.city.update({
          where: { id: current.id },
          data: { status },
          include: {
            createdBy: { select: userSelect },
            _count: { select: { destinationLinks: true } },
          },
        });
        await tx.activityLog.create({
          data: audit(auth, 'CITY_STATUS_CHANGED', 'City', updated.id, context, {
            previousStatus: current.status,
            status,
          }),
        });
        return updated;
      });
      return presentCity(city as unknown as Record<string, unknown>, scope);
    } catch (error) {
      duplicateError(error, 'An active city with that name');
    }
  },

  async remove(auth: AuthContext, cityId: string, context: MastersRequestContext) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.CITY);
    const current = await getCity(auth, cityId, scope);
    assertCanModifyMaster(current, scope);
    const [destinationLinks, hotels, sightseeings] = await Promise.all([
      prisma.destinationCity.count({ where: { companyId: auth.companyId, cityId: current.id } }),
      prisma.hotel.count({ where: { companyId: auth.companyId, cityId: current.id } }),
      prisma.sightseeing.count({ where: { companyId: auth.companyId, cityId: current.id } }),
    ]);
    if (destinationLinks + hotels + sightseeings > 0)
      throw new ConflictError(
        'Cannot delete this city because it is being used by existing master records.',
        { destinationLinks, hotels, sightseeings },
      );
    const metadata = { name: current.name, countryCode: current.countryCode };
    try {
      await prisma.$transaction(async (tx) => {
        await tx.city.delete({ where: { id: current.id } });
        await tx.activityLog.create({
          data: audit(auth, 'CITY_DELETED', 'City', current.id, context, metadata),
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003')
        throw new ConflictError(
          'Cannot delete this city because it is being used by existing master records.',
        );
      throw error;
    }
    return { deleted: true, id: current.id };
  },
};

export const destinationsService = {
  async list(auth: AuthContext, query: Record<string, unknown>) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    const pagination = resolvePagination({
      page: Number(query.page) || undefined,
      pageSize: Number(query.pageSize) || 10,
    });
    const canManage = await managerVisibility(auth, PERMISSIONS.MASTER_DESTINATIONS_UPDATE);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const status = query.status ? (String(query.status) as MasterStatus) : undefined;
    const where: Prisma.DestinationWhereInput = {
      ...buildVisibleWhere(scope),
      ...(canManage ? { ...(status ? { status } : {}) } : { status: 'ACTIVE' }),
      ...(query.country ? { countryCode: String(query.country) } : {}),
      ...(query.destinationType
        ? { destinationType: String(query.destinationType) as DestinationType }
        : {}),
      ...(query.cityId ? { cities: { some: { cityId: String(query.cityId) } } } : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: query.createdFrom as Date } : {}),
              ...(query.createdTo ? { lte: query.createdTo as Date } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { privateName: { contains: search, mode: 'insensitive' } },
              { countryName: { contains: search, mode: 'insensitive' } },
              { cities: { some: { city: { name: { contains: search, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const order = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const sortBy = String(query.sortBy ?? 'createdAt');
    const orderBy: Prisma.DestinationOrderByWithRelationInput =
      sortBy === 'country'
        ? { countryName: order }
        : sortBy === 'destinationType'
          ? { destinationType: order }
          : sortBy === 'cityCount'
            ? { cities: { _count: order } }
            : sortBy === 'createdAt'
              ? { createdAt: order }
              : sortBy === 'updatedAt'
                ? { updatedAt: order }
                : { name: order };
    const [rows, total] = await Promise.all([
      prisma.destination.findMany({
        where,
        ...toPrismaPagination(pagination),
        orderBy,
        include: destinationInclude,
      }),
      prisma.destination.count({ where }),
    ]);
    return {
      data: rows.map((row) => presentDestination(row as unknown as Record<string, unknown>, scope)),
      pagination: buildPaginationMeta(pagination, total),
    };
  },

  async lookups(auth: AuthContext, query: Record<string, unknown>) {
    return citiesService.lookups(auth, query);
  },

  async details(auth: AuthContext, destinationId: string) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    return presentDestination(
      (await getDestination(auth, destinationId, scope)) as unknown as Record<string, unknown>,
      scope,
    );
  },

  async create(auth: AuthContext, input: DestinationInput, context: MastersRequestContext) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    await validateCities(scope, input.countryCode, input.cityIds);
    try {
      const destination = await prisma.$transaction(async (tx) => {
        const created = await tx.destination.create({
          data: {
            companyId: auth.companyId,
            countryCode: input.countryCode,
            countryName: countrySnapshot(input.countryCode),
            name: input.name.trim(),
            normalizedName: normalizeCustomerName(input.name),
            // Internal-only label; blank becomes null. Never used for
            // customer-facing naming or matching.
            privateName: blankToNull(input.privateName),
            // Optional itinerary-vendor contact; blank becomes null.
            email: blankToNull(input.email),
            destinationType: input.destinationType,
            status: input.status,
            createdById: auth.userId,
            ...policyData(input),
            cities: {
              create: input.cityIds.map((cityId, sequence) => ({
                companyId: auth.companyId,
                cityId,
                sequence,
              })),
            },
          },
          include: destinationInclude,
        });
        await tx.activityLog.create({
          data: audit(auth, 'DESTINATION_CREATED', 'Destination', created.id, context, {
            countryCode: created.countryCode,
            destinationType: created.destinationType,
            cityCount: input.cityIds.length,
            sourceGlobal: scope.isSystemAdmin,
          }),
        });
        return created;
      });
      return presentDestination(destination as unknown as Record<string, unknown>, scope);
    } catch (error) {
      duplicateError(error, 'That destination');
    }
  },

  async update(
    auth: AuthContext,
    destinationId: string,
    input: DestinationUpdateInput,
    context: MastersRequestContext,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    const current = await getDestination(auth, destinationId, scope);
    assertCanModifyMaster(current, scope);
    const countryCode = input.countryCode ?? current.countryCode;
    if (input.cityIds) await validateCities(scope, countryCode, input.cityIds);
    else if (input.countryCode) {
      const validExisting = current.cities.every((link) => link.city.countryCode === countryCode);
      if (!validExisting)
        throw new ValidationError(
          'Remove cities from the previous country before changing country.',
        );
    }
    try {
      const destination = await prisma.$transaction(async (tx) => {
        if (input.cityIds) {
          await tx.destinationCity.deleteMany({ where: { destinationId: current.id } });
          await tx.destinationCity.createMany({
            data: input.cityIds.map((cityId, sequence) => ({
              companyId: auth.companyId,
              destinationId: current.id,
              cityId,
              sequence,
            })),
          });
        }
        await tx.destination.update({
          where: { id: current.id },
          data: {
            ...(input.countryCode
              ? { countryCode: input.countryCode, countryName: countrySnapshot(input.countryCode) }
              : {}),
            ...(input.name
              ? { name: input.name.trim(), normalizedName: normalizeCustomerName(input.name) }
              : {}),
            ...('privateName' in input ? { privateName: blankToNull(input.privateName) } : {}),
            ...('email' in input ? { email: blankToNull(input.email) } : {}),
            ...(input.destinationType ? { destinationType: input.destinationType } : {}),
            ...(input.status ? { status: input.status } : {}),
            ...policyData(input),
          },
        });
        await tx.activityLog.create({
          data: audit(auth, 'DESTINATION_UPDATED', 'Destination', current.id, context, {
            changedFields: Object.keys(input),
            cityCount: input.cityIds?.length,
          }),
        });
        return tx.destination.findUniqueOrThrow({
          where: { id: current.id },
          include: destinationInclude,
        });
      });
      return presentDestination(destination as unknown as Record<string, unknown>, scope);
    } catch (error) {
      duplicateError(error, 'That destination');
    }
  },

  async status(
    auth: AuthContext,
    destinationId: string,
    status: MasterStatus,
    context: MastersRequestContext,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    const current = await getDestination(auth, destinationId, scope);
    assertCanModifyMaster(current, scope);
    try {
      const destination = await prisma.$transaction(async (tx) => {
        await tx.destination.update({
          where: { id: current.id },
          data: { status },
        });
        await tx.activityLog.create({
          data: audit(auth, 'DESTINATION_STATUS_CHANGED', 'Destination', current.id, context, {
            previousStatus: current.status,
            status,
          }),
        });
        return tx.destination.findUniqueOrThrow({
          where: { id: current.id },
          include: destinationInclude,
        });
      });
      return presentDestination(destination as unknown as Record<string, unknown>, scope);
    } catch (error) {
      duplicateError(error, 'An active destination with that name');
    }
  },

  async remove(auth: AuthContext, destinationId: string, context: MastersRequestContext) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    const current = await getDestination(auth, destinationId, scope);
    assertCanModifyMaster(current, scope);
    const [hotels, sightseeings, visaTypes] = await Promise.all([
      prisma.hotel.count({ where: { companyId: auth.companyId, destinationId: current.id } }),
      prisma.sightseeing.count({
        where: { companyId: auth.companyId, destinationId: current.id },
      }),
      prisma.visaType.count({ where: { companyId: auth.companyId, destinationId: current.id } }),
    ]);
    if (hotels + sightseeings + visaTypes > 0)
      throw new ConflictError(
        'Cannot delete this destination because it is being used by existing master records.',
        { hotels, sightseeings, visaTypes },
      );
    // Master-owned storage only: gallery + legacy + pending keys under this
    // company's masters/ prefix. Quotation snapshot objects are never touched.
    // Keys still referenced by quotation snapshots are retained so saved
    // quotations, weblinks and PDFs keep rendering.
    const storageKeys = collectMasterStorageKeys(current, auth.companyId);
    const { deletable, retained } = await partitionKeysBySnapshotReferences(storageKeys);
    const s3Failures = await deleteMasterStorageKeys(deletable, {
      masterType: 'DESTINATION',
      masterId: current.id,
    });
    if (s3Failures.length > 0)
      throw new ValidationError(
        `Failed to delete ${s3Failures.length} associated file(s) from storage. Destination not deleted. Please retry.`,
      );
    const metadata = {
      name: current.name,
      countryCode: current.countryCode,
      retainedStorageFiles: retained.length,
    };
    try {
      await prisma.$transaction(async (tx) => {
        // DestinationCity, VehicleDestination and AddOnServiceDestination
        // cascade automatically; hotels/sightseeings/visa types were blocked
        // above and quotation/booking links are SetNull.
        await tx.destination.delete({ where: { id: current.id } });
        await tx.activityLog.create({
          data: audit(auth, 'DESTINATION_DELETED', 'Destination', current.id, context, metadata),
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003')
        throw new ConflictError(
          'Cannot delete this destination because it is being used by existing master records.',
        );
      throw error;
    }
    return { deleted: true, id: current.id };
  },

  async cities(auth: AuthContext, destinationId: string) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    return presentDestination(
      (await getDestination(auth, destinationId, scope)) as unknown as Record<string, unknown>,
      scope,
    );
  },

  async addCity(
    auth: AuthContext,
    destinationId: string,
    cityId: string,
    context: MastersRequestContext,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    const destination = await getDestination(auth, destinationId, scope);
    assertCanModifyMaster(destination, scope);
    await validateCities(scope, destination.countryCode, [cityId]);
    if (destination.cities.some((row) => row.cityId === cityId))
      throw new ConflictError('That city is already linked to this destination.');
    await prisma.$transaction(async (tx) => {
      await tx.destinationCity.create({
        data: {
          companyId: auth.companyId,
          destinationId,
          cityId,
          sequence: destination.cities.length,
        },
      });
      await tx.activityLog.create({
        data: audit(auth, 'DESTINATION_CITY_ADDED', 'Destination', destinationId, context, {
          cityId,
        }),
      });
    });
    return this.details(auth, destinationId);
  },

  async removeCity(
    auth: AuthContext,
    destinationId: string,
    cityId: string,
    context: MastersRequestContext,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    const destination = await getDestination(auth, destinationId, scope);
    assertCanModifyMaster(destination, scope);
    if (destination.cities.length <= 1)
      throw new ValidationError('A destination must retain at least one city.');
    const link = destination.cities.find((row) => row.cityId === cityId);
    if (!link) throw new NotFoundError('Destination city not found.');
    const remaining = destination.cities.filter((row) => row.cityId !== cityId);
    await prisma.$transaction(async (tx) => {
      await tx.destinationCity.delete({ where: { id: link.id } });
      for (const [sequence, row] of remaining.entries())
        await tx.destinationCity.update({ where: { id: row.id }, data: { sequence } });
      await tx.activityLog.create({
        data: audit(auth, 'DESTINATION_CITY_REMOVED', 'Destination', destinationId, context, {
          cityId,
        }),
      });
    });
    return this.details(auth, destinationId);
  },

  async reorderCities(
    auth: AuthContext,
    destinationId: string,
    cityIds: string[],
    context: MastersRequestContext,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    const destination = await getDestination(auth, destinationId, scope);
    assertCanModifyMaster(destination, scope);
    const existing = new Set(destination.cities.map((row) => row.cityId));
    if (cityIds.length !== existing.size || cityIds.some((id) => !existing.has(id)))
      throw new ValidationError('Reorder must include every linked city exactly once.');
    await prisma.$transaction(async (tx) => {
      await tx.destinationCity.deleteMany({ where: { destinationId } });
      await tx.destinationCity.createMany({
        data: cityIds.map((cityId, sequence) => ({
          companyId: auth.companyId,
          destinationId,
          cityId,
          sequence,
        })),
      });
      await tx.activityLog.create({
        data: audit(auth, 'DESTINATION_CITY_REORDERED', 'Destination', destinationId, context, {
          cityCount: cityIds.length,
        }),
      });
    });
    return this.details(auth, destinationId);
  },

  async createImageUpload(
    auth: AuthContext,
    destinationId: string,
    input: DestinationImageUploadInput,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    const destination = await getDestination(auth, destinationId, scope);
    assertCanModifyMaster(destination, scope);
    const max = env.DESTINATION_IMAGE_MAX_UPLOAD_SIZE_MB * 1024 * 1024;
    if (input.fileSize > max)
      throw new ValidationError(
        `Destination images must be ${env.DESTINATION_IMAGE_MAX_UPLOAD_SIZE_MB} MB or smaller.`,
      );
    const key = destinationImageObjectKey({
      companyId: auth.companyId,
      destinationId,
      imageId: crypto.randomUUID(),
      fileName: input.fileName,
    });
    const oldPending = destination.pendingImageObjectKey;
    await prisma.destination.update({
      where: { id: destination.id },
      data: {
        pendingImageObjectKey: key,
        pendingImageFileName: input.fileName,
        pendingImageMimeType: input.mimeType,
        pendingImageFileSize: input.fileSize,
      },
    });
    if (oldPending && oldPending !== key) await storageService.deleteObject(oldPending);
    return {
      uploadUrl: await storageService.createUploadUrl(
        key,
        input.mimeType,
        input.fileSize,
        env.DESTINATION_IMAGE_PRESIGNED_URL_EXPIRY_SECONDS,
      ),
      expiresInSeconds: env.DESTINATION_IMAGE_PRESIGNED_URL_EXPIRY_SECONDS,
    };
  },

  async confirmImage(auth: AuthContext, destinationId: string, context: MastersRequestContext) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    const destination = await getDestination(auth, destinationId, scope);
    assertCanModifyMaster(destination, scope);
    const key = destination.pendingImageObjectKey;
    if (
      !key ||
      !destination.pendingImageFileName ||
      !destination.pendingImageMimeType ||
      !destination.pendingImageFileSize
    )
      throw new ValidationError('No destination image upload is awaiting confirmation.');
    const metadata = await storageService.headObject(key);
    if (!metadata) throw new ValidationError('The uploaded destination image could not be found.');
    if (
      metadata.size !== destination.pendingImageFileSize ||
      metadata.contentType !== destination.pendingImageMimeType
    )
      throw new ValidationError('Uploaded image metadata does not match the approved file.');
    const confirmedAt = new Date();
    const images = appendMasterImage(
      destination,
      {
        objectKey: key,
        fileName: destination.pendingImageFileName,
        mimeType: destination.pendingImageMimeType,
        fileSize: destination.pendingImageFileSize,
      },
      confirmedAt,
    );
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.destination.update({
        where: { id: destination.id },
        data: {
          imageStorageProvider: storageService.provider,
          imageBucket: storageService.bucket,
          ...masterImageWriteData(images),
          pendingImageObjectKey: null,
          pendingImageFileName: null,
          pendingImageMimeType: null,
          pendingImageFileSize: null,
        },
        include: destinationInclude,
      });
      await tx.activityLog.create({
        data: audit(auth, 'DESTINATION_IMAGE_UPLOADED', 'Destination', destination.id, context, {
          imageId: images.at(-1)!.id,
          mimeType: destination.pendingImageMimeType,
          fileSize: destination.pendingImageFileSize,
        }),
      });
      return row;
    });
    return presentDestination(updated as unknown as Record<string, unknown>, scope);
  },

  async imageDownload(auth: AuthContext, destinationId: string, imageId?: string) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    const destination = await getDestination(auth, destinationId, scope);
    const image = findMasterImage(destination, imageId);
    if (!image) throw new NotFoundError('Destination image not found.');
    return {
      url: await storageService.createDownloadUrl(
        image.objectKey,
        image.fileName,
        env.DESTINATION_IMAGE_PRESIGNED_URL_EXPIRY_SECONDS,
      ),
      expiresInSeconds: env.DESTINATION_IMAGE_PRESIGNED_URL_EXPIRY_SECONDS,
    };
  },

  async deleteImage(
    auth: AuthContext,
    destinationId: string,
    context: MastersRequestContext,
    imageId?: string,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    const destination = await getDestination(auth, destinationId, scope);
    assertCanModifyMaster(destination, scope);
    const removed = removeMasterImage(destination, imageId);
    if (!removed) throw new NotFoundError('Destination image not found.');
    await prisma.$transaction(async (tx) => {
      await tx.destination.update({
        where: { id: destination.id },
        data: {
          ...masterImageWriteData(removed.images),
          imageStorageProvider: removed.images.length ? destination.imageStorageProvider : null,
          imageBucket: removed.images.length ? destination.imageBucket : null,
        },
      });
      await tx.activityLog.create({
        data: audit(auth, 'DESTINATION_IMAGE_DELETED', 'Destination', destination.id, context, {
          imageId: removed.target.id,
          remainingImageCount: removed.images.length,
        }),
      });
    });
    return { deleted: true };
  },
  async reorderImages(
    auth: AuthContext,
    destinationId: string,
    imageIds: string[],
    context: MastersRequestContext,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    const destination = await getDestination(auth, destinationId, scope);
    assertCanModifyMaster(destination, scope);
    const images = reorderMasterImages(destination, imageIds);
    if (!images) throw new ValidationError('Image order must contain every current image once.');
    await prisma.$transaction(async (tx) => {
      await tx.destination.update({
        where: { id: destination.id },
        data: masterImageWriteData(images),
      });
      await tx.activityLog.create({
        data: audit(auth, 'DESTINATION_UPDATED', 'Destination', destination.id, context, {
          change: 'IMAGE_ORDER',
          imageIds,
        }),
      });
    });
    return this.details(auth, destinationId);
  },

  /**
   * Destination-level Stylish PDF cover selection (tenant-owned config).
   * Returns the saved three ordered image references with display data for
   * the management dialog; stale references stay visible but marked invalid
   * so the admin can replace them. Empty cards array when unconfigured.
   *
   * The destination row itself is never modified here, so global (System)
   * destinations can carry a tenant-specific configuration.
   */
  async stylishCover(auth: AuthContext, destinationId: string) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    const destination = await getDestination(auth, destinationId, scope);
    const saved = await prisma.destinationStylishCover.findUnique({
      where: { companyId_destinationId: { companyId: auth.companyId, destinationId: destination.id } },
    });
    const cards = normalizeDestinationStylishCover(saved ? { cards: saved.cards } : null);
    if (!cards) return { destination: { id: destination.id, name: destination.name }, cards: [] };
    const resolved = await Promise.all(
      cards.map(async (card) => {
        const row = await prisma.sightseeing.findFirst({
          where: { id: card.sightseeingId, ...buildVisibleWhere(scope) },
          select: {
            id: true,
            title: true,
            destinationId: true,
            city: { select: { name: true } },
            images: true,
            imageObjectKey: true,
            imageFileName: true,
            imageMimeType: true,
            imageFileSize: true,
            imageConfirmedAt: true,
          },
        });
        const gallery = row ? effectiveMasterImages(row) : [];
        const image = gallery.find((entry) => entry.id === card.imageId) ?? null;
        const valid = Boolean(
          row && row.destinationId === destination.id && image,
        );
        let url: string | null = null;
        if (valid && image) {
          try {
            url = await storageService.createDownloadUrl(
              image.objectKey,
              image.fileName,
              env.MASTER_MEDIA_PRESIGNED_URL_EXPIRY_SECONDS,
            );
          } catch {
            url = null;
          }
        }
        return {
          sightseeingId: card.sightseeingId,
          imageId: card.imageId,
          valid,
          title: row?.title ?? null,
          cityName: row?.city?.name ?? null,
          isPrimary: image ? gallery[0]?.id === image.id : null,
          url,
        };
      }),
    );
    return { destination: { id: destination.id, name: destination.name }, cards: resolved };
  },

  /**
   * Replace the tenant's three ordered cover images for a destination.
   * References only — existing master images are reused in place, never
   * copied or moved. Every card must point at a visible sightseeing record
   * of THIS destination with that image still in its gallery.
   */
  async saveStylishCover(
    auth: AuthContext,
    destinationId: string,
    input: DestinationStylishCoverInput,
    context: MastersRequestContext,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
    const destination = await getDestination(auth, destinationId, scope);
    const cards = input.cards;
    if (new Set(cards.map((card) => `${card.sightseeingId}\n${card.imageId}`)).size !== cards.length)
      throw new ValidationError('Select three different images.');
    const rows = await prisma.sightseeing.findMany({
      where: {
        id: { in: cards.map((card) => card.sightseeingId) },
        ...buildVisibleWhere(scope),
      },
      select: {
        id: true,
        destinationId: true,
        images: true,
        imageObjectKey: true,
        imageFileName: true,
        imageMimeType: true,
        imageFileSize: true,
        imageConfirmedAt: true,
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const card of cards) {
      const row = byId.get(card.sightseeingId);
      if (!row || row.destinationId !== destination.id)
        throw new ValidationError('Every image must belong to a sightseeing record of this destination.');
      if (!effectiveMasterImages(row).some((image) => image.id === card.imageId))
        throw new ValidationError('A selected image is no longer available. Refresh and try again.');
    }
    const normalized = normalizeDestinationStylishCover({ cards });
    if (!normalized) throw new ValidationError('Select exactly three different images.');
    await prisma.$transaction(async (tx) => {
      await tx.destinationStylishCover.upsert({
        where: { companyId_destinationId: { companyId: auth.companyId, destinationId: destination.id } },
        create: {
          companyId: auth.companyId,
          destinationId: destination.id,
          cards: normalized as unknown as Prisma.InputJsonValue,
          createdById: auth.userId,
        },
        update: { cards: normalized as unknown as Prisma.InputJsonValue, updatedById: auth.userId },
      });
      await tx.activityLog.create({
        data: audit(auth, 'DESTINATION_UPDATED', 'Destination', destination.id, context, {
          change: 'STYLISH_COVER',
        }),
      });
    });
    return this.stylishCover(auth, destinationId);
  },
};
