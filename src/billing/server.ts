import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import {
  BillingService,
  CalculateFeeResponseSchema,
  GetRatesResponseSchema,
  RateSchema,
  VehicleType,
} from "../gen/billing/v1/billing_pb";
import { loadBillingEnv } from "../shared/env";
import { startServers } from "../shared/start-servers";
import { calculateFee, RATES } from "./fee-calculator";

// =============================================================================
// MICROSERVICIO DE FACTURACIÓN
// Implementa las funciones declaradas en proto/billing/v1/billing.proto.
// Si una firma no coincide con el contrato, TypeScript no compila.
// =============================================================================

function routes(router: ConnectRouter): void {
  router.service(BillingService, {
    calculateFee(request) {
      if (request.vehicleType === VehicleType.UNSPECIFIED) {
        throw new ConnectError("Debe indicar el tipo de vehículo", Code.InvalidArgument);
      }
      if (!request.enteredAt || !request.exitedAt) {
        throw new ConnectError("Debe enviar la hora de entrada y de salida", Code.InvalidArgument);
      }

      try {
        const fee = calculateFee(
          request.vehicleType,
          timestampDate(request.enteredAt),
          timestampDate(request.exitedAt),
        );
        console.log(`💰 Tarifa calculada: ${fee.breakdown} → $${fee.totalAmount}`);
        return create(CalculateFeeResponseSchema, fee);
      } catch (error) {
        throw new ConnectError((error as Error).message, Code.InvalidArgument);
      }
    },

    getRates() {
      return create(GetRatesResponseSchema, {
        rates: RATES.map((rate) => create(RateSchema, rate)),
      });
    },
  });
}

const env = loadBillingEnv();

startServers({
  serviceName: "billing-service",
  routes,
  port: env.BILLING_PORT,
  grpcPort: env.BILLING_GRPC_PORT,
  fallback: (_req, res) => {
    // Respuesta simple para el health check de la nube.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "billing-service", status: "ok" }));
  },
});
