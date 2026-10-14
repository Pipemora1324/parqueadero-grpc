import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { BillingService, VehicleType } from "../src/gen/billing/v1/billing_pb";
import { ParkingService } from "../src/gen/parking/v1/parking_pb";

// -----------------------------------------------------------------------------
// Cliente de consola que habla gRPC NATIVO (HTTP/2 + Protobuf binario).
// Uso (con `npm run dev` corriendo):  npm run grpc:demo
// -----------------------------------------------------------------------------

const parking = createClient(ParkingService, createGrpcTransport({ baseUrl: "http://localhost:50052" }));
const billing = createClient(BillingService, createGrpcTransport({ baseUrl: "http://localhost:50051" }));

const { rates } = await billing.getRates({});
console.log("📋 Tarifas (BillingService/GetRates):");
console.table(rates.map((r) => ({ tipo: VehicleType[r.vehicleType], valorMinuto: r.pricePerMinute, cortesia: r.graceMinutes })));

const { summary } = await parking.listSpots({});
console.log(`🅿️  ParkingService/ListSpots → ${summary?.occupiedSpots} ocupadas de ${summary?.totalSpots}`);

console.log("📡 Escuchando ParkingService/WatchSpots durante 10 s (registre un ingreso en la web)...");
const controller = new AbortController();
setTimeout(() => controller.abort(), 10_000);
try {
  for await (const update of parking.watchSpots({}, { signal: controller.signal })) {
    console.log(`   ▸ evento: ${update.event} · libres: ${update.summary?.availableSpots}`);
  }
} catch {
  console.log("✅ Stream cerrado.");
}
