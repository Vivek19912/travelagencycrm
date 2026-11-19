import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/api-response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { citiesService, destinationsService } from './masters.service.js';
import { hotelsService } from './hotels.service.js';
import { airlinesService } from './airlines.service.js';
import { cruisesService } from './cruises.service.js';
import { vehiclesService } from './vehicles.service.js';
import { sightseeingService } from './sightseeing.service.js';
import { addOnServicesService } from './add-on-services.service.js';
import { visaTypesService } from './visa-types.service.js';
import { testimonialsService } from './testimonials.service.js';
import { faqsService } from './faqs.service.js';

const auth = (req: Request) => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};
const context = (req: Request) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export const citiesController = {
  list: async (req: Request, res: Response) =>
    sendSuccess(res, await citiesService.list(auth(req), req.query)),
  lookups: async (req: Request, res: Response) =>
    sendSuccess(res, await citiesService.lookups(auth(req), req.query)),
  details: async (req: Request, res: Response) =>
    sendSuccess(res, await citiesService.details(auth(req), req.params.cityId!)),
  create: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await citiesService.create(auth(req), req.body, context(req)),
      'City created.',
      201,
    ),
  update: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await citiesService.update(auth(req), req.params.cityId!, req.body, context(req)),
      'City updated.',
    ),
  status: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await citiesService.status(auth(req), req.params.cityId!, req.body.status, context(req)),
      'City status updated.',
    ),
  remove: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await citiesService.remove(auth(req), req.params.cityId!, context(req)),
      'City permanently deleted.',
    ),
};

export const destinationsController = {
  list: async (req: Request, res: Response) =>
    sendSuccess(res, await destinationsService.list(auth(req), req.query)),
  lookups: async (req: Request, res: Response) =>
    sendSuccess(res, await destinationsService.lookups(auth(req), req.query)),
  details: async (req: Request, res: Response) =>
    sendSuccess(res, await destinationsService.details(auth(req), req.params.destinationId!)),
  create: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await destinationsService.create(auth(req), req.body, context(req)),
      'Destination created.',
      201,
    ),
  update: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await destinationsService.update(
        auth(req),
        req.params.destinationId!,
        req.body,
        context(req),
      ),
      'Destination updated.',
    ),
  status: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await destinationsService.status(
        auth(req),
        req.params.destinationId!,
        req.body.status,
        context(req),
      ),
      'Destination status updated.',
    ),
  remove: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await destinationsService.remove(auth(req), req.params.destinationId!, context(req)),
      'Destination permanently deleted.',
    ),
  cities: async (req: Request, res: Response) =>
    sendSuccess(res, await destinationsService.cities(auth(req), req.params.destinationId!)),
  addCity: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await destinationsService.addCity(
        auth(req),
        req.params.destinationId!,
        req.body.cityId,
        context(req),
      ),
      'City added.',
      201,
    ),
  removeCity: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await destinationsService.removeCity(
        auth(req),
        req.params.destinationId!,
        req.params.cityId!,
        context(req),
      ),
      'City removed.',
    ),
  reorderCities: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await destinationsService.reorderCities(
        auth(req),
        req.params.destinationId!,
        req.body.cityIds,
        context(req),
      ),
      'Cities reordered.',
    ),
  imageUpload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await destinationsService.createImageUpload(auth(req), req.params.destinationId!, req.body),
      'Destination image upload authorized.',
      201,
    ),
  imageConfirm: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await destinationsService.confirmImage(auth(req), req.params.destinationId!, context(req)),
      'Destination image confirmed.',
    ),
  imageDownload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await destinationsService.imageDownload(
        auth(req),
        req.params.destinationId!,
        req.query.imageId as string | undefined,
      ),
    ),
  imageDelete: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await destinationsService.deleteImage(
        auth(req),
        req.params.destinationId!,
        context(req),
        req.query.imageId as string | undefined,
      ),
      'Destination image deleted.',
    ),
  imageReorder: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await destinationsService.reorderImages(
        auth(req),
        req.params.destinationId!,
        req.body.imageIds,
        context(req),
      ),
    ),
  stylishCover: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await destinationsService.stylishCover(auth(req), req.params.destinationId!),
    ),
  saveStylishCover: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await destinationsService.saveStylishCover(
        auth(req),
        req.params.destinationId!,
        req.body,
        context(req),
      ),
      'Stylish PDF cover saved.',
    ),
};

export const hotelsController = {
  list: async (req: Request, res: Response) =>
    sendSuccess(res, await hotelsService.list(auth(req), req.query)),
  lookups: async (req: Request, res: Response) =>
    sendSuccess(res, await hotelsService.lookups(auth(req), req.query)),
  details: async (req: Request, res: Response) =>
    sendSuccess(res, await hotelsService.details(auth(req), req.params.hotelId!)),
  create: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.create(auth(req), req.body, context(req)),
      'Hotel created.',
      201,
    ),
  update: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.update(auth(req), req.params.hotelId!, req.body, context(req)),
      'Hotel updated.',
    ),
  status: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.status(auth(req), req.params.hotelId!, req.body.status, context(req)),
      'Hotel status updated.',
    ),
  remove: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.remove(auth(req), req.params.hotelId!, context(req)),
      'Hotel permanently deleted.',
    ),
  createRoomType: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.createRoomType(auth(req), req.params.hotelId!, req.body, context(req)),
      'Room type created.',
      201,
    ),
  updateRoomType: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.updateRoomType(
        auth(req),
        req.params.hotelId!,
        req.params.roomTypeId!,
        req.body,
        context(req),
      ),
      'Room type updated.',
    ),
  createMealPlan: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.createMealPlan(auth(req), req.params.hotelId!, req.body, context(req)),
      'Meal plan created.',
      201,
    ),
  updateMealPlan: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.updateMealPlan(
        auth(req),
        req.params.hotelId!,
        req.params.mealPlanId!,
        req.body,
        context(req),
      ),
      'Meal plan updated.',
    ),
  createSeason: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.createSeason(auth(req), req.params.hotelId!, req.body, context(req)),
      'Season created.',
      201,
    ),
  updateSeason: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.updateSeason(
        auth(req),
        req.params.hotelId!,
        req.params.seasonId!,
        req.body,
        context(req),
      ),
      'Season updated.',
    ),
  deleteSeason: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.deleteSeason(auth(req), req.params.hotelId!, req.params.seasonId!, context(req)),
      'Season deleted.',
    ),
  createRoomTypeSeason: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.createRoomTypeSeason(
        auth(req),
        req.params.hotelId!,
        req.params.roomTypeId!,
        req.body,
        context(req),
      ),
      'Room type season created.',
      201,
    ),
  updateRoomTypeSeason: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.updateRoomTypeSeason(
        auth(req),
        req.params.hotelId!,
        req.params.roomTypeId!,
        req.params.seasonId!,
        req.body,
        context(req),
      ),
      'Room type season updated.',
    ),
  deleteRoomTypeSeason: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.deleteRoomTypeSeason(
        auth(req),
        req.params.hotelId!,
        req.params.roomTypeId!,
        req.params.seasonId!,
        context(req),
      ),
      'Room type season deleted.',
    ),
  createMealPlanSeason: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.createMealPlanSeason(
        auth(req),
        req.params.hotelId!,
        req.params.mealPlanId!,
        req.body,
        context(req),
      ),
      'Meal plan season created.',
      201,
    ),
  updateMealPlanSeason: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.updateMealPlanSeason(
        auth(req),
        req.params.hotelId!,
        req.params.mealPlanId!,
        req.params.seasonId!,
        req.body,
        context(req),
      ),
      'Meal plan season updated.',
    ),
  deleteMealPlanSeason: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.deleteMealPlanSeason(
        auth(req),
        req.params.hotelId!,
        req.params.mealPlanId!,
        req.params.seasonId!,
        context(req),
      ),
      'Meal plan season deleted.',
    ),
  createMonthPrice: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.createMonthPrice(auth(req), req.params.hotelId!, req.body, context(req)),
      'Month price created.',
      201,
    ),
  updateMonthPrice: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.updateMonthPrice(
        auth(req),
        req.params.hotelId!,
        req.params.monthPriceId!,
        req.body,
        context(req),
      ),
      'Month price updated.',
    ),
  deleteMonthPrice: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.deleteMonthPrice(
        auth(req),
        req.params.hotelId!,
        req.params.monthPriceId!,
        context(req),
      ),
      'Month price deleted.',
    ),
  createRoomTypeMonthPrice: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.createRoomTypeMonthPrice(
        auth(req),
        req.params.hotelId!,
        req.params.roomTypeId!,
        req.body,
        context(req),
      ),
      'Room type month price created.',
      201,
    ),
  updateRoomTypeMonthPrice: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.updateRoomTypeMonthPrice(
        auth(req),
        req.params.hotelId!,
        req.params.roomTypeId!,
        req.params.monthPriceId!,
        req.body,
        context(req),
      ),
      'Room type month price updated.',
    ),
  deleteRoomTypeMonthPrice: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.deleteRoomTypeMonthPrice(
        auth(req),
        req.params.hotelId!,
        req.params.roomTypeId!,
        req.params.monthPriceId!,
        context(req),
      ),
      'Room type month price deleted.',
    ),
  createMealPlanMonthPrice: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.createMealPlanMonthPrice(
        auth(req),
        req.params.hotelId!,
        req.params.mealPlanId!,
        req.body,
        context(req),
      ),
      'Meal plan month price created.',
      201,
    ),
  updateMealPlanMonthPrice: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.updateMealPlanMonthPrice(
        auth(req),
        req.params.hotelId!,
        req.params.mealPlanId!,
        req.params.monthPriceId!,
        req.body,
        context(req),
      ),
      'Meal plan month price updated.',
    ),
  deleteMealPlanMonthPrice: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.deleteMealPlanMonthPrice(
        auth(req),
        req.params.hotelId!,
        req.params.mealPlanId!,
        req.params.monthPriceId!,
        context(req),
      ),
      'Meal plan month price deleted.',
    ),
  imageUpload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.createImageUpload(auth(req), req.params.hotelId!, req.body),
      'Hotel image upload authorized.',
      201,
    ),
  imageConfirm: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.confirmImage(auth(req), req.params.hotelId!, context(req)),
      'Hotel image confirmed.',
    ),
  imageDownload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.imageDownload(
        auth(req),
        req.params.hotelId!,
        req.query.imageId as string | undefined,
      ),
    ),
  imageDelete: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.deleteImage(
        auth(req),
        req.params.hotelId!,
        context(req),
        req.query.imageId as string | undefined,
      ),
      'Hotel image deleted.',
    ),
  imageReorder: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelsService.reorderImages(
        auth(req),
        req.params.hotelId!,
        req.body.imageIds,
        context(req),
      ),
    ),
};

export const airlinesController = {
  list: async (req: Request, res: Response) =>
    sendSuccess(res, await airlinesService.list(auth(req), req.query)),
  lookups: async (req: Request, res: Response) =>
    sendSuccess(res, await airlinesService.lookups(auth(req), req.query)),
  details: async (req: Request, res: Response) =>
    sendSuccess(res, await airlinesService.details(auth(req), req.params.airlineId!)),
  create: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await airlinesService.create(auth(req), req.body, context(req)),
      'Airline created.',
      201,
    ),
  update: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await airlinesService.update(auth(req), req.params.airlineId!, req.body, context(req)),
      'Airline updated.',
    ),
  status: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await airlinesService.status(auth(req), req.params.airlineId!, req.body.status, context(req)),
      'Airline status updated.',
    ),
  remove: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await airlinesService.remove(auth(req), req.params.airlineId!, context(req)),
      'Airline permanently deleted.',
    ),
  logoUpload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await airlinesService.createLogoUpload(auth(req), req.params.airlineId!, req.body),
      'Airline logo upload authorized.',
      201,
    ),
  logoConfirm: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await airlinesService.confirmLogo(auth(req), req.params.airlineId!, context(req)),
      'Airline logo confirmed.',
    ),
  logoImport: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await airlinesService.importLogoFromUrl(
        auth(req),
        req.params.airlineId!,
        req.body,
        context(req),
      ),
      'Airline logo imported.',
    ),
  logoDownload: async (req: Request, res: Response) =>
    sendSuccess(res, await airlinesService.logoDownload(auth(req), req.params.airlineId!)),
  logoDelete: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await airlinesService.deleteLogo(auth(req), req.params.airlineId!, context(req)),
      'Airline logo deleted.',
    ),
};

export const cruisesController = {
  list: async (req: Request, res: Response) =>
    sendSuccess(res, await cruisesService.list(auth(req), req.query)),
  lookups: async (req: Request, res: Response) =>
    sendSuccess(res, await cruisesService.lookups(auth(req), req.query)),
  details: async (req: Request, res: Response) =>
    sendSuccess(res, await cruisesService.details(auth(req), req.params.cruiseId!)),
  create: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await cruisesService.create(auth(req), req.body, context(req)),
      'Cruise created.',
      201,
    ),
  update: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await cruisesService.update(auth(req), req.params.cruiseId!, req.body, context(req)),
      'Cruise updated.',
    ),
  status: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await cruisesService.status(auth(req), req.params.cruiseId!, req.body.status, context(req)),
      'Cruise status updated.',
    ),
  remove: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await cruisesService.remove(auth(req), req.params.cruiseId!, context(req)),
      'Cruise permanently deleted.',
    ),
  imageUpload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await cruisesService.createImageUpload(auth(req), req.params.cruiseId!, req.body),
      'Cruise image upload authorized.',
      201,
    ),
  imageConfirm: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await cruisesService.confirmImage(auth(req), req.params.cruiseId!, context(req)),
      'Cruise image confirmed.',
    ),
  imageDownload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await cruisesService.imageDownload(
        auth(req),
        req.params.cruiseId!,
        req.query.imageId as string | undefined,
      ),
    ),
  imageDelete: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await cruisesService.deleteImage(
        auth(req),
        req.params.cruiseId!,
        context(req),
        req.query.imageId as string | undefined,
      ),
      'Cruise image deleted.',
    ),
  imageReorder: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await cruisesService.reorderImages(
        auth(req),
        req.params.cruiseId!,
        req.body.imageIds,
        context(req),
      ),
    ),
};

export const vehiclesController = {
  list: async (req: Request, res: Response) =>
    sendSuccess(res, await vehiclesService.list(auth(req), req.query)),
  types: async (req: Request, res: Response) =>
    sendSuccess(res, await vehiclesService.types(auth(req))),
  lookups: async (req: Request, res: Response) =>
    sendSuccess(res, await vehiclesService.lookups(auth(req), req.query)),
  details: async (req: Request, res: Response) =>
    sendSuccess(res, await vehiclesService.details(auth(req), req.params.vehicleId!)),
  create: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await vehiclesService.create(auth(req), req.body, context(req)),
      'Vehicle created.',
      201,
    ),
  update: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await vehiclesService.update(auth(req), req.params.vehicleId!, req.body, context(req)),
      'Vehicle updated.',
    ),
  status: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await vehiclesService.status(auth(req), req.params.vehicleId!, req.body.status, context(req)),
      'Vehicle status updated.',
    ),
  remove: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await vehiclesService.remove(auth(req), req.params.vehicleId!, context(req)),
      'Vehicle permanently deleted.',
    ),
  imageUpload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await vehiclesService.createImageUpload(auth(req), req.params.vehicleId!, req.body),
      'Vehicle image upload authorized.',
      201,
    ),
  imageConfirm: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await vehiclesService.confirmImage(auth(req), req.params.vehicleId!, context(req)),
      'Vehicle image confirmed.',
    ),
  imageDownload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await vehiclesService.imageDownload(
        auth(req),
        req.params.vehicleId!,
        req.query.imageId as string | undefined,
      ),
    ),
  imageDelete: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await vehiclesService.deleteImage(
        auth(req),
        req.params.vehicleId!,
        context(req),
        req.query.imageId as string | undefined,
      ),
      'Vehicle image deleted.',
    ),
  imageReorder: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await vehiclesService.reorderImages(
        auth(req),
        req.params.vehicleId!,
        req.body.imageIds,
        context(req),
      ),
    ),
};

export const sightseeingController = {
  list: async (req: Request, res: Response) =>
    sendSuccess(res, await sightseeingService.list(auth(req), req.query)),
  summary: async (req: Request, res: Response) =>
    sendSuccess(res, await sightseeingService.summary(auth(req), req.query)),
  lookups: async (req: Request, res: Response) =>
    sendSuccess(res, await sightseeingService.lookups(auth(req), req.query)),
  details: async (req: Request, res: Response) =>
    sendSuccess(res, await sightseeingService.details(auth(req), req.params.sightseeingId!)),
  create: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await sightseeingService.create(auth(req), req.body, context(req)),
      'Sightseeing created.',
      201,
    ),
  update: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await sightseeingService.update(auth(req), req.params.sightseeingId!, req.body, context(req)),
      'Sightseeing updated.',
    ),
  reorder: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await sightseeingService.reorder(
        auth(req),
        req.params.sightseeingId!,
        req.body.direction,
        context(req),
      ),
      'Sightseeing reordered.',
    ),
  status: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await sightseeingService.status(
        auth(req),
        req.params.sightseeingId!,
        req.body.status,
        context(req),
      ),
      'Sightseeing status updated.',
    ),
  remove: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await sightseeingService.remove(auth(req), req.params.sightseeingId!, context(req)),
      'Sightseeing permanently deleted.',
    ),
  imageUpload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await sightseeingService.createImageUpload(auth(req), req.params.sightseeingId!, req.body),
      'Sightseeing image upload authorized.',
      201,
    ),
  imageConfirm: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await sightseeingService.confirmImage(auth(req), req.params.sightseeingId!, context(req)),
      'Sightseeing image confirmed.',
    ),
  imageDownload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await sightseeingService.imageDownload(
        auth(req),
        req.params.sightseeingId!,
        req.query.imageId as string | undefined,
      ),
    ),
  presentations: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await sightseeingService.presentations(auth(req), (req.query.ids as string[]) ?? []),
    ),
  imageDelete: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await sightseeingService.deleteImage(
        auth(req),
        req.params.sightseeingId!,
        context(req),
        req.query.imageId as string | undefined,
      ),
      'Sightseeing image deleted.',
    ),
  imageReorder: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await sightseeingService.reorderImages(
        auth(req),
        req.params.sightseeingId!,
        req.body.imageIds,
        context(req),
      ),
    ),
  activities: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await sightseeingService.activities(
        auth(req),
        req.query.destination as string | undefined,
        req.query.city as string | undefined,
      ),
    ),
};

export const addOnServicesController = {
  list: async (req: Request, res: Response) =>
    sendSuccess(res, await addOnServicesService.list(auth(req), req.query)),
  lookups: async (req: Request, res: Response) =>
    sendSuccess(res, await addOnServicesService.lookups(auth(req), req.query)),
  details: async (req: Request, res: Response) =>
    sendSuccess(res, await addOnServicesService.details(auth(req), req.params.addOnServiceId!)),
  create: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await addOnServicesService.create(auth(req), req.body, context(req)),
      'Add-on service created.',
      201,
    ),
  update: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await addOnServicesService.update(
        auth(req),
        req.params.addOnServiceId!,
        req.body,
        context(req),
      ),
      'Add-on service updated.',
    ),
  status: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await addOnServicesService.status(
        auth(req),
        req.params.addOnServiceId!,
        req.body.status,
        context(req),
      ),
      'Add-on service status updated.',
    ),
  remove: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await addOnServicesService.remove(auth(req), req.params.addOnServiceId!, context(req)),
      'Add-on service permanently deleted.',
    ),
  imageUpload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await addOnServicesService.createImageUpload(auth(req), req.params.addOnServiceId!, req.body),
      'Add-on service image upload authorized.',
      201,
    ),
  imageConfirm: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await addOnServicesService.confirmImage(auth(req), req.params.addOnServiceId!, context(req)),
      'Add-on service image confirmed.',
    ),
  imageDownload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await addOnServicesService.imageDownload(
        auth(req),
        req.params.addOnServiceId!,
        req.query.imageId as string | undefined,
      ),
    ),
  imageDelete: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await addOnServicesService.deleteImage(
        auth(req),
        req.params.addOnServiceId!,
        context(req),
        req.query.imageId as string | undefined,
      ),
      'Add-on service image deleted.',
    ),
  imageReorder: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await addOnServicesService.reorderImages(
        auth(req),
        req.params.addOnServiceId!,
        req.body.imageIds,
        context(req),
      ),
    ),
};

export const visaTypesController = {
  list: async (req: Request, res: Response) =>
    sendSuccess(res, await visaTypesService.list(auth(req), req.query)),
  details: async (req: Request, res: Response) =>
    sendSuccess(res, await visaTypesService.details(auth(req), req.params.visaTypeId!)),
  create: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await visaTypesService.create(auth(req), req.body, context(req)),
      'Visa type created.',
      201,
    ),
  update: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await visaTypesService.update(auth(req), req.params.visaTypeId!, req.body, context(req)),
      'Visa type updated.',
    ),
  status: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await visaTypesService.status(
        auth(req),
        req.params.visaTypeId!,
        req.body.status,
        context(req),
      ),
      'Visa type status updated.',
    ),
  remove: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await visaTypesService.remove(auth(req), req.params.visaTypeId!, context(req)),
      'Visa type permanently deleted.',
    ),
};

export const testimonialsController = {
  list: async (req: Request, res: Response) =>
    sendSuccess(res, await testimonialsService.list(auth(req), req.query)),
  details: async (req: Request, res: Response) =>
    sendSuccess(res, await testimonialsService.details(auth(req), req.params.testimonialId!)),
  create: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await testimonialsService.create(auth(req), req.body, context(req)),
      'Testimonial created.',
      201,
    ),
  update: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await testimonialsService.update(
        auth(req),
        req.params.testimonialId!,
        req.body,
        context(req),
      ),
      'Testimonial updated.',
    ),
  status: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await testimonialsService.status(
        auth(req),
        req.params.testimonialId!,
        req.body.status,
        context(req),
      ),
      'Testimonial status updated.',
    ),
  remove: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await testimonialsService.remove(auth(req), req.params.testimonialId!, context(req)),
      'Testimonial permanently deleted.',
    ),
  imageUpload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await testimonialsService.createImageUpload(auth(req), req.params.testimonialId!, req.body),
      'Testimonial image upload authorized.',
      201,
    ),
  imageConfirm: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await testimonialsService.confirmImage(auth(req), req.params.testimonialId!, context(req)),
      'Testimonial image confirmed.',
    ),
  imageDownload: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await testimonialsService.imageDownload(
        auth(req),
        req.params.testimonialId!,
        req.query.imageId as string | undefined,
      ),
    ),
  imageDelete: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await testimonialsService.deleteImage(
        auth(req),
        req.params.testimonialId!,
        context(req),
        req.query.imageId as string | undefined,
      ),
      'Testimonial image deleted.',
    ),
  imageReorder: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await testimonialsService.reorderImages(
        auth(req),
        req.params.testimonialId!,
        req.body.imageIds,
        context(req),
      ),
    ),
};

export const faqsController = {
  list: async (req: Request, res: Response) =>
    sendSuccess(res, await faqsService.list(auth(req), req.query)),
  details: async (req: Request, res: Response) =>
    sendSuccess(res, await faqsService.details(auth(req), req.params.faqId!)),
  create: async (req: Request, res: Response) =>
    sendSuccess(res, await faqsService.create(auth(req), req.body, context(req)), 'FAQ created.', 201),
  update: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await faqsService.update(auth(req), req.params.faqId!, req.body, context(req)),
      'FAQ updated.',
    ),
  status: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await faqsService.status(auth(req), req.params.faqId!, req.body.status, context(req)),
      'FAQ status updated.',
    ),
  remove: async (req: Request, res: Response) =>
    sendSuccess(res, await faqsService.remove(auth(req), req.params.faqId!, context(req)), 'FAQ permanently deleted.'),
};
