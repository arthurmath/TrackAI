/** Registre des voitures disponibles. */
import type { VehicleConfig } from './types';
import { car_1 } from './data/car_1';
import { car_2 } from './data/car_2';

export const CARS: VehicleConfig[] = [car_1, car_2];

export function getCarById(id: string): VehicleConfig {
  const car = CARS.find((c) => c.id === id);
  if (!car) throw new Error(`Voiture inconnue: ${id}`);
  return car;
}

export const DEFAULT_CAR_ID = 'car_1';
export type { VehicleConfig };
