/** Registre des voitures disponibles. */
import type { VehicleConfig } from './types';
import { car_1 } from './data/car_1';
import { car_2 } from './data/car_2';
import { car_3 } from './data/car_3';

export const CARS: VehicleConfig[] = [car_2, car_3, car_1];

export function getCarById(id: string): VehicleConfig {
  const car = CARS.find((c) => c.id === id);
  if (!car) throw new Error(`Voiture inconnue: ${id}`);
  return car;
}

export const DEFAULT_CAR_ID = CARS[0].id;
export type { VehicleConfig };
