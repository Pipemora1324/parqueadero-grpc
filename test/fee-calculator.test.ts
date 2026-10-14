import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VehicleType } from "../src/gen/billing/v1/billing_pb";
import { calculateFee } from "../src/billing/fee-calculator";

// Pruebas de la regla de negocio principal: el cálculo de la tarifa.
const start = new Date("2026-10-13T10:00:00Z");
const after = (minutes: number, seconds = 0) => new Date(start.getTime() + minutes * 60_000 + seconds * 1000);

describe("calculateFee", () => {
  it("no cobra dentro de los minutos de cortesía", () => {
    const fee = calculateFee(VehicleType.CAR, start, after(4, 30));
    assert.equal(fee.totalMinutes, 5);
    assert.equal(fee.totalAmount, 0);
  });

  it("cobra cada minuto iniciado después de la cortesía (carro)", () => {
    const fee = calculateFee(VehicleType.CAR, start, after(60));
    assert.equal(fee.billableMinutes, 55);
    assert.equal(fee.totalAmount, 5500);
  });

  it("redondea hacia arriba los minutos incompletos", () => {
    const fee = calculateFee(VehicleType.CAR, start, after(30, 1));
    assert.equal(fee.totalMinutes, 31);
    assert.equal(fee.totalAmount, 2600);
  });

  it("aplica el cobro mínimo cuando el valor calculado es menor", () => {
    const fee = calculateFee(VehicleType.MOTORCYCLE, start, after(7));
    assert.equal(fee.billableMinutes, 2);
    assert.equal(fee.totalAmount, 500);
  });

  it("usa la tarifa de moto", () => {
    const fee = calculateFee(VehicleType.MOTORCYCLE, start, after(125));
    assert.equal(fee.totalAmount, 120 * 50);
  });

  it("rechaza una salida anterior a la entrada", () => {
    assert.throws(() => calculateFee(VehicleType.CAR, after(10), start), RangeError);
  });
});
