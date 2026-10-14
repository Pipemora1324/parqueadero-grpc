import { on } from "node:events";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient, type ConnectRouter } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { BillingService } from "../gen/billing/v1/billing_pb";
import {
  ListReceiptsResponseSchema,
  ListSpotsResponseSchema,
  ParkingService,
  ParkingSummarySchema,
  ReceiptSchema,
  RegisterEntryResponseSchema,
  RegisterExitResponseSchema,
  SpotSchema,
  SpotStatus,
  TicketSchema,
  WatchSpotsResponseSchema,
  type Receipt,
  type Spot,
} from "../gen/parking/v1/parking_pb";
import { loadParkingEnv } from "../shared/env";
import { startServers } from "../shared/start-servers";
import { DomainError, ParkingLot, type ReceiptRecord } from "./parking-lot";
import { serveStatic } from "./static-files";
import { firstIssueMessage, registerEntrySchema, registerExitSchema } from "./validation";

// =============================================================================
// MICROSERVICIO DE PARQUEADERO
// - Expone ParkingService (unary + server streaming) al navegador.
// - Es CLIENTE gRPC de BillingService: microservicio → microservicio.
// =============================================================================

const env = loadParkingEnv();
const lot = new ParkingLot();
if (env.SEED_DEMO_DATA) lot.seedDemoData();

// Cliente tipado del microservicio de facturación, generado desde el .proto.
const billingClient = createClient(
  BillingService,
  createConnectTransport({ baseUrl: env.BILLING_URL, httpVersion: "1.1" }),
);

// ---- Conversión del modelo interno a mensajes Protobuf ----------------------

function toSpotMessages(): Spot[] {
  return lot.getSpots().map((spot) =>
    create(SpotSchema, {
      id: spot.id,
      allowedType: spot.allowedType,
      status: spot.occupant ? SpotStatus.OCCUPIED : SpotStatus.AVAILABLE,
      plate: spot.occupant?.plate ?? "",
      ticketId: spot.occupant?.id ?? "",
      occupiedSince: spot.occupant ? timestampFromDate(spot.occupant.enteredAt) : undefined,
    }),
  );
}

function toReceiptMessage(record: ReceiptRecord): Receipt {
  return create(ReceiptSchema, {
    ...record,
    enteredAt: timestampFromDate(record.enteredAt),
    exitedAt: timestampFromDate(record.exitedAt),
  });
}

function toConnectError(error: unknown): ConnectError {
  if (error instanceof ConnectError) return error;
  if (error instanceof DomainError) {
    const codes = {
      already_exists: Code.AlreadyExists,
      not_found: Code.NotFound,
      full: Code.ResourceExhausted,
    } as const;
    return new ConnectError(error.message, codes[error.kind]);
  }
  console.error(error);
  return new ConnectError("Error interno del parqueadero", Code.Internal);
}

// ---- Implementación del contrato ParkingService -----------------------------

function routes(router: ConnectRouter): void {
  router.service(ParkingService, {
    registerEntry(request) {
      const parsed = registerEntrySchema.safeParse(request);
      if (!parsed.success) {
        throw new ConnectError(firstIssueMessage(parsed.error), Code.InvalidArgument);
      }
      try {
        const ticket = lot.registerEntry(parsed.data.plate, parsed.data.vehicleType);
        return create(RegisterEntryResponseSchema, {
          ticket: create(TicketSchema, { ...ticket, enteredAt: timestampFromDate(ticket.enteredAt) }),
        });
      } catch (error) {
        throw toConnectError(error);
      }
    },

    async registerExit(request) {
      const parsed = registerExitSchema.safeParse(request);
      if (!parsed.success) {
        throw new ConnectError(firstIssueMessage(parsed.error), Code.InvalidArgument);
      }

      const ticket = lot.findActiveTicket(parsed.data.plate);
      if (!ticket) {
        throw new ConnectError(`El vehículo ${parsed.data.plate} no está en el parqueadero`, Code.NotFound);
      }

      // 1) Se le pide la tarifa al microservicio de facturación (llamada gRPC).
      const exitedAt = new Date();
      let fee;
      try {
        fee = await billingClient.calculateFee({
          vehicleType: ticket.vehicleType,
          enteredAt: timestampFromDate(ticket.enteredAt),
          exitedAt: timestampFromDate(exitedAt),
        });
      } catch (error) {
        console.error("Fallo al contactar billing-service:", error);
        throw new ConnectError(
          "El servicio de facturación no está disponible. Intente de nuevo en unos segundos.",
          Code.Unavailable,
        );
      }

      // 2) Solo si el cobro se calculó bien, se cierra el ticket y se libera la celda.
      try {
        const receipt = lot.completeExit(ticket, exitedAt, fee);
        return create(RegisterExitResponseSchema, { receipt: toReceiptMessage(receipt) });
      } catch (error) {
        throw toConnectError(error);
      }
    },

    listSpots() {
      return create(ListSpotsResponseSchema, {
        spots: toSpotMessages(),
        summary: create(ParkingSummarySchema, lot.getSummary()),
      });
    },

    listReceipts(request) {
      const limit = request.limit > 0 ? Math.min(request.limit, 50) : 10;
      return create(ListReceiptsResponseSchema, {
        receipts: lot.getReceipts(limit).map(toReceiptMessage),
      });
    },

    // Server streaming: primero envía el estado actual y luego cada cambio.
    async *watchSpots(_request, context) {
      const snapshot = (event: string) =>
        create(WatchSpotsResponseSchema, {
          spots: toSpotMessages(),
          summary: create(ParkingSummarySchema, lot.getSummary()),
          event,
        });

      yield snapshot("connected");
      try {
        for await (const [event] of on(lot, "change", { signal: context.signal })) {
          yield snapshot(String(event));
        }
      } catch (error) {
        // El cliente cerró la conexión: se termina el stream sin ruido.
        if ((error as Error).name !== "AbortError") throw error;
      }
    },
  });
}

// Latido cada 20 s para que los proxies de la nube no corten el stream por inactividad.
setInterval(() => lot.emit("change", "heartbeat"), 20_000).unref();

startServers({
  serviceName: "parking-service",
  routes,
  port: env.PORT,
  grpcPort: env.GRPC_PORT,
  fallback: serveStatic,
});
console.log(`🔗 Facturación configurada en ${env.BILLING_URL}`);
