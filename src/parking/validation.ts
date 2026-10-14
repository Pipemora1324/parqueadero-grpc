import { z } from "zod";
import { VehicleType } from "../gen/billing/v1/billing_pb";

// -----------------------------------------------------------------------------
// Validación en RUNTIME de los datos que llegan del cliente.
// Protobuf garantiza la FORMA del mensaje (que `plate` sea string), pero no su
// CONTENIDO (que sea una placa colombiana real). Eso lo resuelve Zod.
// -----------------------------------------------------------------------------

// Normaliza la placa: mayúsculas, sin espacios ni guiones ("abc-123" → "ABC123").
const normalizedPlate = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase().replace(/[\s-]/g, ""));

// Carros: 3 letras + 3 números (ej. ABC123).
const CAR_PLATE = /^[A-Z]{3}\d{3}$/;
// Motos: 3 letras + 2 números + 1 letra opcional (ej. ABC12D o ABC12).
const MOTORCYCLE_PLATE = /^[A-Z]{3}\d{2}[A-Z]?$/;

export const plateSchema = normalizedPlate.pipe(
  z.string().min(1, "La placa es obligatoria").max(7, "La placa es demasiado larga"),
);

export const registerEntrySchema = z
  .object({
    plate: plateSchema,
    vehicleType: z.enum(VehicleType).refine((type) => type !== VehicleType.UNSPECIFIED, {
      message: "Debe seleccionar el tipo de vehículo",
    }),
  })
  .superRefine((data, ctx) => {
    const isCar = data.vehicleType === VehicleType.CAR;
    const pattern = isCar ? CAR_PLATE : MOTORCYCLE_PLATE;
    if (!pattern.test(data.plate)) {
      ctx.addIssue({
        code: "custom",
        path: ["plate"],
        message: isCar
          ? `La placa "${data.plate}" no es válida para carro (formato ABC123)`
          : `La placa "${data.plate}" no es válida para moto (formato ABC12D)`,
      });
    }
  });

export const registerExitSchema = z.object({ plate: plateSchema });

export type RegisterEntryInput = z.infer<typeof registerEntrySchema>;

/** Devuelve el primer mensaje de error legible de un fallo de Zod. */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos";
}
