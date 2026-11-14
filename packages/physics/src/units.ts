// Published units to SI. A sheet keeps the units its sources print; resolve.ts converts once, with these.
import { PI } from './math';

/** kg per pound. */
export const LB = 0.45359237;
/** m per inch, per foot. */
export const IN = 0.0254;
export const FT = 0.3048;
/** m/s per mile an hour. */
export const MPH = 0.44704;
/** W per horsepower (the US mechanical horsepower makers quote). */
export const HP = 745.6998715822702;
/** N m per pound-foot. */
export const LBFT = 1.3558179483314004;
/** Pa per psi. */
export const PSI = 6894.757293168361;
/** N per pound-force. */
export const LBF = 4.4482216152605;
/** m^2 per square foot. */
export const SQFT = 0.09290304;
/** rad/s per rpm. */
export const RPM = PI / 30;
/** m^3 per litre. */
export const LITRE = 0.001;

export type TyreSize = {
  /** Section width, m. */
  width: number;
  /** Sidewall height over width. */
  aspect: number;
  /** Rim diameter, inches. */
  rimIn: number;
  /** Unloaded radius, m. */
  radius: number;
};

/**
 * Reads a tyre size as printed: "245/35ZR19", "P245/60R18", "LT285/70R17", "305/30ZR-20", or a flotation size
 * "33x12.50R17" (diameter and width in inches). Null when it is neither.
 */
export function parseTyreSize(size: string): TyreSize | null {
  const metric = /(\d{3})\s*\/\s*(\d{2})\s*[A-Z]{0,3}\s*-?\s*(\d{2}(?:\.\d)?)/i.exec(size);
  if (metric) {
    const width = Number(metric[1]) / 1000, aspect = Number(metric[2]) / 100, rimIn = Number(metric[3]);
    return { width, aspect, rimIn, radius: rimIn * IN / 2 + width * aspect };
  }
  const flotation = /(\d{2}(?:\.\d+)?)\s*x\s*(\d{1,2}(?:\.\d+)?)\s*[A-Z]{0,2}\s*-?\s*(\d{2}(?:\.\d)?)/i.exec(size);
  if (flotation) {
    const diameter = Number(flotation[1]) * IN, width = Number(flotation[2]) * IN, rimIn = Number(flotation[3]);
    const side = (diameter - rimIn * IN) / 2;
    return { width, aspect: side / width, rimIn, radius: diameter / 2 };
  }
  return null;
}
