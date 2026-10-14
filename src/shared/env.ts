import { z } from "zod";

// -----------------------------------------------------------------------------
// Variables de entorno validadas en RUNTIME con Zod.
// TypeScript borra los tipos al compilar (type erasure): `process.env.PORT`
// podría venir vacío o con basura. Zod "parsea" el valor desconocido y lo
// convierte en un tipo conocido y seguro, o detiene el arranque con un error.
// -----------------------------------------------------------------------------

const portSchema = z.coerce.number().int().min(1).max(65535);

const billingEnvSchema = z.object({
  // Se usa BILLING_PORT (y no PORT) para que ambos microservicios puedan
  // convivir en el mismo contenedor de la nube sin chocar de puerto.
  BILLING_PORT: portSchema.default(8081),
  // Puerto opcional para gRPC nativo sobre HTTP/2 (h2c). Útil en local.
  BILLING_GRPC_PORT: portSchema.optional(),
});

const parkingEnvSchema = z.object({
  // La nube (Render) inyecta PORT automáticamente.
  PORT: portSchema.default(8080),
  GRPC_PORT: portSchema.optional(),
  // URL pública o interna del microservicio de facturación.
  BILLING_URL: z.string().url().default("http://localhost:8081"),
  // Si es "true", se precargan vehículos de ejemplo para la demostración.
  SEED_DEMO_DATA: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

export type BillingEnv = z.infer<typeof billingEnvSchema>;
export type ParkingEnv = z.infer<typeof parkingEnvSchema>;

function parseEnv<T extends z.ZodType>(schema: T, serviceName: string): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    console.error(`❌ Variables de entorno inválidas para ${serviceName}:`);
    console.error(z.prettifyError(result.error));
    process.exit(1);
  }
  return result.data;
}

export const loadBillingEnv = (): BillingEnv => parseEnv(billingEnvSchema, "billing-service");
export const loadParkingEnv = (): ParkingEnv => parseEnv(parkingEnvSchema, "parking-service");
