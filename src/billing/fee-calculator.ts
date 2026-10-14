import { VehicleType } from "../gen/billing/v1/billing_pb";

// -----------------------------------------------------------------------------
// REGLA DE NEGOCIO PRINCIPAL: cálculo de la tarifa.
// Es una función pura (sin red ni base de datos), así se prueba fácilmente.
// -----------------------------------------------------------------------------

export interface RateConfig {
  vehicleType: VehicleType;
  pricePerMinute: number;
  graceMinutes: number;
  minimumCharge: number;
}

// Tabla de tarifas en pesos colombianos (COP). Cámbiela aquí si lo necesita.
export const RATES: ReadonlyArray<RateConfig> = [
  { vehicleType: VehicleType.CAR, pricePerMinute: 100, graceMinutes: 5, minimumCharge: 1000 },
  { vehicleType: VehicleType.MOTORCYCLE, pricePerMinute: 50, graceMinutes: 5, minimumCharge: 500 },
];

export interface FeeResult {
  totalMinutes: number;
  billableMinutes: number;
  pricePerMinute: number;
  totalAmount: number;
  breakdown: string;
}

const MS_PER_MINUTE = 60_000;

export function findRate(vehicleType: VehicleType): RateConfig {
  const rate = RATES.find((r) => r.vehicleType === vehicleType);
  if (!rate) {
    throw new Error(`No existe tarifa para el tipo de vehículo ${vehicleType}`);
  }
  return rate;
}

export function formatCop(amount: number): string {
  return `$${amount.toLocaleString("es-CO")}`;
}

/**
 * Calcula el valor a pagar:
 * 1. Se cuentan los minutos transcurridos; todo minuto iniciado se cobra completo.
 * 2. Si no se supera la cortesía, el parqueo es gratis.
 * 3. Si se supera, se cobran los minutos restantes con un valor mínimo.
 */
export function calculateFee(vehicleType: VehicleType, enteredAt: Date, exitedAt: Date): FeeResult {
  const elapsedMs = exitedAt.getTime() - enteredAt.getTime();
  if (elapsedMs < 0) {
    throw new RangeError("La hora de salida no puede ser anterior a la de entrada");
  }

  const rate = findRate(vehicleType);
  const totalMinutes = Math.max(1, Math.ceil(elapsedMs / MS_PER_MINUTE));

  if (totalMinutes <= rate.graceMinutes) {
    return {
      totalMinutes,
      billableMinutes: 0,
      pricePerMinute: rate.pricePerMinute,
      totalAmount: 0,
      breakdown: `${totalMinutes} min dentro de la cortesía de ${rate.graceMinutes} min: sin costo`,
    };
  }

  const billableMinutes = totalMinutes - rate.graceMinutes;
  const rawAmount = billableMinutes * rate.pricePerMinute;
  const totalAmount = Math.max(rawAmount, rate.minimumCharge);
  const minimumApplied = totalAmount > rawAmount ? ` (se aplica cobro mínimo de ${formatCop(rate.minimumCharge)})` : "";

  return {
    totalMinutes,
    billableMinutes,
    pricePerMinute: rate.pricePerMinute,
    totalAmount,
    breakdown:
      `${totalMinutes} min − ${rate.graceMinutes} min de cortesía = ${billableMinutes} min × ` +
      `${formatCop(rate.pricePerMinute)}${minimumApplied}`,
  };
}
