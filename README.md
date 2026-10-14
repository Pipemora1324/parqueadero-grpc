# 🅿️ ParkGrid · Plataforma de Gestión de Parqueadero con gRPC

Taller gRPC · **Programación Orientada a la Web** · Universidad Cooperativa de Colombia

ParkGrid registra el ingreso y la salida de vehículos y asigna automáticamente una celda libre. Al salir, calcula la tarifa exacta según los minutos transcurridos y libera la celda. Todo el tablero se actualiza **en tiempo real** mediante un *stream* gRPC.

---

## 🧱 Arquitectura

```
                        Navegador (HTML + TypeScript + ConnectRPC)
                                   │  Protocolo Connect · Protobuf BINARIO
                                   │  (gRPC-Web compatible, sin proxy Envoy)
                                   ▼
┌──────────────────────── parking-service ────────────────────────┐
│  RegisterEntry · RegisterExit · ListSpots · ListReceipts         │
│  WatchSpots (server streaming)  ·  sirve el frontend (web/public)│
└───────────────────────────────┬─────────────────────────────────┘
                                │  llamada gRPC microservicio → microservicio
                                ▼
┌──────────────────────── billing-service ────────────────────────┐
│  CalculateFee · GetRates   (regla de negocio de tarifas)         │
└──────────────────────────────────────────────────────────────────┘
```

| Concepto de clase | Dónde está en el código |
|---|---|
| **Contract-First** | `proto/billing/v1/billing.proto` y `proto/parking/v1/parking.proto` se escriben primero; `npm run generate` crea `src/gen/` |
| **Protocol Buffers** | El frontend usa `useBinaryFormat: true` → los mensajes viajan en binario, no en JSON |
| **HTTP/2** | Cada servicio abre un puerto HTTP/2 (h2c) para gRPC nativo (`npm run grpc:demo`) |
| **Microservicios** | `parking-service` llama a `billing-service` con un cliente gRPC tipado (`src/parking/server.ts`) |
| **Funciones en vez de recursos** | No hay `GET /spots/:id`; hay `RegisterEntry()`, `RegisterExit()`, etc. |
| **Tipado end-to-end** | Backend y frontend importan los MISMOS tipos generados del `.proto` |
| **Falsa seguridad de TypeScript** | Zod valida en *runtime* las variables de entorno (`src/shared/env.ts`) y las placas (`src/parking/validation.ts`) |
| **Tipos de RPC** | Unary (ingreso/salida/consultas) y **Server Streaming** (`WatchSpots`) |
| **Errores gRPC** | `INVALID_ARGUMENT`, `ALREADY_EXISTS`, `NOT_FOUND`, `RESOURCE_EXHAUSTED`, `UNAVAILABLE` |

## 💵 Regla de negocio

- Carro: **$100/min** · Moto: **$50/min**
- **5 minutos de cortesía** gratis
- Todo minuto iniciado se cobra completo
- Cobro mínimo: $1.000 carro / $500 moto
- La celda solo se libera si el cálculo de la tarifa fue exitoso

Tarifas configurables en `src/billing/fee-calculator.ts`.

## 📁 Estructura

```
proto/                    → Contratos .proto (fuente única de verdad)
src/gen/                  → Código generado por Buf (no editar)
src/billing/              → Microservicio de facturación
src/parking/              → Microservicio de parqueadero + estado en memoria
src/shared/               → Validación de entorno (Zod) y arranque HTTP/1.1 + HTTP/2
web/public/               → HTML y CSS del frontend
web/src/main.ts           → Cliente gRPC del navegador
scripts/                  → Cliente de consola con gRPC nativo
test/                     → Pruebas de la regla de negocio
render.yaml               → Despliegue en la nube (Render, plan gratuito)
```

## ▶️ Ejecutar en local

Requisitos: **Node.js 20 o superior**.

```bash
npm install
npm run dev          # levanta billing-service + parking-service
```

Abra **http://localhost:8080**.

Otros comandos:

```bash
npm test             # pruebas del cálculo de tarifas
npm run grpc:demo    # cliente gRPC nativo (HTTP/2) por consola, con npm run dev corriendo
npm run generate     # regenera el código desde los .proto
npm run typecheck    # verificación de tipos
```

## ☁️ Desplegar en la nube (Render · gratis)

1. Suba este proyecto a un repositorio de **GitHub** (público o privado).
2. Entre a **https://render.com** → *Sign in with GitHub*.
3. Clic en **New +** → **Blueprint**.
4. Seleccione el repositorio. Render detecta `render.yaml` automáticamente.
5. Clic en **Apply** / **Deploy Blueprint** y espere de 3 a 5 minutos.
6. Abra la URL que entrega Render (`https://parkgrid-xxxx.onrender.com`).

> En el plan gratuito, el servicio "se duerme" tras 15 minutos sin visitas. La primera visita después puede tardar cerca de un minuto. Los datos viven en memoria y se reinician cuando el servicio se reinicia.

**Alternativa sin Blueprint:** *New + → Web Service*, elija el repo y configure:
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Instance Type: **Free**

## 🧪 Probar los RPC "a mano"

Protocolo Connect con JSON (útil para Postman o curl):

```bash
curl -X POST https://SU-URL.onrender.com/parking.v1.ParkingService/RegisterEntry \
  -H "Content-Type: application/json" \
  -d '{"plate":"ABC123","vehicleType":"VEHICLE_TYPE_CAR"}'

curl -X POST https://SU-URL.onrender.com/parking.v1.ParkingService/RegisterExit \
  -H "Content-Type: application/json" \
  -d '{"plate":"ABC123"}'
```

gRPC nativo en local con **grpcurl**:

```bash
grpcurl -plaintext -import-path proto -proto parking/v1/parking.proto \
  -d '{"plate":"XYZ123","vehicle_type":"VEHICLE_TYPE_CAR"}' \
  localhost:50052 parking.v1.ParkingService/RegisterEntry
```

## 🛠️ Tecnologías

TypeScript · ConnectRPC (gRPC / gRPC-Web / Connect) · Protocol Buffers · Buf · Zod · Node.js · esbuild · Render
