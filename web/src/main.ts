import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { VehicleType } from "../../src/gen/billing/v1/billing_pb";
import {
  ParkingService,
  SpotStatus,
  type ParkingSummary,
  type Receipt,
  type Spot,
} from "../../src/gen/parking/v1/parking_pb";

// =============================================================================
// FRONTEND · Cliente gRPC en el navegador
// Usa el MISMO contrato .proto que el backend: si el servidor cambia una
// firma, este archivo deja de compilar (tipado end-to-end).
// =============================================================================

// ---- Utilidades de DOM -------------------------------------------------------

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`No se encontró el elemento ${selector}`);
  return element;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const timeFormat = new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const toDate = (ts?: Timestamp) => (ts ? timestampDate(ts) : new Date());

function formatElapsed(since: Date): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - since.getTime()) / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}h ${pad(m)}m` : `${pad(m)}:${pad(s)}`;
}

const ERROR_LABELS: Partial<Record<Code, string>> = {
  [Code.InvalidArgument]: "Dato inválido",
  [Code.NotFound]: "No encontrado",
  [Code.AlreadyExists]: "Ya existe",
  [Code.ResourceExhausted]: "Parqueadero lleno",
  [Code.Unavailable]: "Servicio no disponible",
  [Code.Internal]: "Error interno",
};

// ---- Inspector gRPC: registra cada llamada en pantalla -----------------------

const rpcLog = $("#rpc-log");

function logRpc(method: string, status: string, kind: "ok" | "err" | "stream", detail?: string): void {
  const item = document.createElement("li");
  item.innerHTML = `
    <span class="t-time">${timeFormat.format(new Date())}</span>
    <span class="t-method">${escapeHtml(method)}</span>
    <span class="t-status ${kind}">${escapeHtml(status)}</span>
    ${detail ? `<span class="t-detail">${escapeHtml(detail)}</span>` : ""}`;
  rpcLog.prepend(item);
  while (rpcLog.children.length > 40) rpcLog.lastElementChild?.remove();
}

// Interceptor: mide cada RPC unary (como un middleware del lado cliente).
const inspector: Interceptor = (next) => async (request) => {
  const started = performance.now();
  const method = `${request.service.typeName.split(".").pop()}/${request.method.name}`;
  try {
    const response = await next(request);
    if (!response.stream) {
      logRpc(method, `OK · ${Math.round(performance.now() - started)} ms`, "ok");
    }
    return response;
  } catch (error) {
    const err = ConnectError.from(error);
    logRpc(method, Code[err.code], "err", err.rawMessage);
    throw error;
  }
};

// Transporte Connect con Protobuf BINARIO (no JSON) sobre fetch.
const transport = createConnectTransport({
  baseUrl: window.location.origin,
  useBinaryFormat: true,
  interceptors: [inspector],
});
const client = createClient(ParkingService, transport);

// ---- Ilustraciones de vehículos (SVG vista superior) -------------------------

const CAR_COLORS = ["#4cc9f0", "#ff5d73", "#9b8cff", "#3ddc97", "#f8f9fa", "#ff9f43", "#ffd23f", "#5c7cfa"];

function colorFor(plate: string): string {
  let hash = 0;
  for (const char of plate) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return CAR_COLORS[hash % CAR_COLORS.length]!;
}

function carSvg(color: string): string {
  return `
  <svg class="vehicle" viewBox="0 0 60 110" aria-hidden="true">
    <rect x="4" y="4" width="52" height="102" rx="18" fill="${color}"/>
    <rect x="4" y="4" width="52" height="102" rx="18" fill="url(#shine)" opacity=".35"/>
    <path d="M12 30 Q30 20 48 30 L45 44 Q30 40 15 44 Z" fill="#0b0d12" opacity=".85"/>
    <rect x="14" y="48" width="32" height="30" rx="6" fill="#000" opacity=".18"/>
    <path d="M15 84 Q30 88 45 84 L47 94 Q30 99 13 94 Z" fill="#0b0d12" opacity=".8"/>
    <rect x="9" y="8" width="10" height="5" rx="2" fill="#fff8d6"/>
    <rect x="41" y="8" width="10" height="5" rx="2" fill="#fff8d6"/>
    <rect x="9" y="97" width="10" height="4" rx="2" fill="#ff3b3b"/>
    <rect x="41" y="97" width="10" height="4" rx="2" fill="#ff3b3b"/>
    <defs><linearGradient id="shine" x1="0" x2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
  </svg>`;
}

function motoSvg(color: string): string {
  return `
  <svg class="vehicle" viewBox="0 0 30 80" aria-hidden="true">
    <rect x="11" y="2" width="8" height="16" rx="4" fill="#222"/>
    <rect x="11" y="62" width="8" height="16" rx="4" fill="#222"/>
    <rect x="1" y="20" width="28" height="4" rx="2" fill="#555"/>
    <rect x="7" y="16" width="16" height="48" rx="8" fill="${color}"/>
    <rect x="10" y="38" width="10" height="18" rx="5" fill="#0b0d12" opacity=".8"/>
    <circle cx="15" cy="14" r="3" fill="#fff8d6"/>
  </svg>`;
}

// ---- Render del mapa ----------------------------------------------------------

const zoneCarTop = $("#zone-car-top");
const zoneCarBottom = $("#zone-car-bottom");
const zoneMoto = $("#zone-moto");
let previousOccupancy = new Map<string, string>();

function renderStall(spot: Spot, isNew: boolean, isLeaving: boolean): string {
  const classes = ["stall", spot.status === SpotStatus.OCCUPIED ? "stall--busy" : "stall--free"];
  if (isNew) classes.push("is-new");
  if (isLeaving) classes.push("is-leaving");

  if (spot.status !== SpotStatus.OCCUPIED) {
    return `<div class="${classes.join(" ")}"><span class="stall__id">${spot.id}</span><span class="stall__free">LIBRE</span></div>`;
  }

  const color = colorFor(spot.plate);
  const art = spot.allowedType === VehicleType.MOTORCYCLE ? motoSvg(color) : carSvg(color);
  const since = toDate(spot.occupiedSince).getTime();
  return `
    <div class="${classes.join(" ")}" data-plate="${escapeHtml(spot.plate)}" title="Ticket ${escapeHtml(spot.ticketId)} · clic para registrar salida">
      <span class="stall__id">${spot.id}</span>
      ${art}
      <span class="stall__tag">${escapeHtml(spot.plate)}</span>
      <span class="stall__time" data-since="${since}">${formatElapsed(new Date(since))}</span>
    </div>`;
}

function renderSpots(spots: Spot[]): void {
  const current = new Map(spots.filter((s) => s.status === SpotStatus.OCCUPIED).map((s) => [s.id, s.plate]));
  const firstRender = previousOccupancy.size === 0 && zoneCarTop.childElementCount === 0;

  const html = (list: Spot[]) =>
    list
      .map((spot) => {
        const before = previousOccupancy.get(spot.id);
        const now = current.get(spot.id);
        const isNew = !firstRender && !!now && before !== now;
        const isLeaving = !firstRender && !!before && !now;
        return renderStall(spot, isNew, isLeaving);
      })
      .join("");

  const cars = spots.filter((s) => s.allowedType === VehicleType.CAR);
  const half = Math.ceil(cars.length / 2);
  zoneCarTop.innerHTML = html(cars.slice(0, half));
  zoneCarBottom.innerHTML = html(cars.slice(half));
  zoneMoto.innerHTML = html(spots.filter((s) => s.allowedType === VehicleType.MOTORCYCLE));
  previousOccupancy = current;
}

// ---- Render de indicadores ---------------------------------------------------

const RING_LENGTH = 2 * Math.PI * 50;

function setKpi(selector: string, value: string): void {
  const el = $(selector);
  if (el.textContent === value) return;
  el.textContent = value;
  el.classList.remove("bump");
  void el.offsetWidth; // reinicia la animación
  el.classList.add("bump");
}

function renderSummary(summary?: ParkingSummary): void {
  if (!summary) return;
  const occupancy = summary.totalSpots ? summary.occupiedSpots / summary.totalSpots : 0;
  const ring = $("#ring-bar");
  ring.style.strokeDashoffset = String(RING_LENGTH * (1 - occupancy));
  ring.style.stroke = occupancy > 0.85 ? "var(--red)" : occupancy > 0.6 ? "#ff9f43" : "var(--yellow)";

  $("#kpi-occupancy").textContent = `${Math.round(occupancy * 100)}%`;
  setKpi("#kpi-occupied", String(summary.occupiedSpots));
  $("#kpi-total").textContent = `de ${summary.totalSpots} celdas`;
  setKpi("#kpi-available", String(summary.availableSpots));
  $("#kpi-cars").textContent = String(summary.availableCarSpots);
  $("#kpi-motos").textContent = String(summary.availableMotorcycleSpots);
  setKpi("#kpi-revenue", cop.format(summary.revenue));
  setKpi("#kpi-exits", String(summary.completedExits));
}

// ---- Recibos -----------------------------------------------------------------

const receiptsList = $("#receipts");
let receiptsCache: Receipt[] = [];

function renderReceipts(receipts: Receipt[]): void {
  receiptsCache = receipts;
  if (receipts.length === 0) {
    receiptsList.innerHTML = `<li class="empty">Aún no hay salidas cobradas.</li>`;
    return;
  }
  receiptsList.innerHTML = receipts
    .map(
      (r, index) => `
      <li data-index="${index}">
        <span class="r-plate">${escapeHtml(r.plate)}</span>
        <span class="r-meta">${r.spotId} · ${r.totalMinutes} min<br/>${timeFormat.format(toDate(r.exitedAt))}</span>
        <span class="r-amount">${cop.format(r.totalAmount)}</span>
      </li>`,
    )
    .join("");
}

async function refreshReceipts(): Promise<void> {
  try {
    const response = await client.listReceipts({ limit: 8 });
    renderReceipts(response.receipts);
  } catch {
    /* el inspector ya registró el error */
  }
}

receiptsList.addEventListener("click", (event) => {
  const item = (event.target as HTMLElement).closest<HTMLElement>("li[data-index]");
  const receipt = item ? receiptsCache[Number(item.dataset.index)] : undefined;
  if (receipt) openReceipt(receipt);
});

// ---- Modal de recibo ---------------------------------------------------------

const modal = $("#receipt-modal");

function openReceipt(receipt: Receipt): void {
  const type = receipt.vehicleType === VehicleType.MOTORCYCLE ? "Moto" : "Carro";
  $("#receipt-ticket").textContent = `Ticket ${receipt.ticketId}`;
  $("#receipt-plate").textContent = receipt.plate;
  $("#receipt-rows").innerHTML = [
    ["Vehículo", type],
    ["Celda", receipt.spotId],
    ["Entrada", timeFormat.format(toDate(receipt.enteredAt))],
    ["Salida", timeFormat.format(toDate(receipt.exitedAt))],
    ["Tiempo total", `${receipt.totalMinutes} min`],
    ["Minutos cobrados", `${receipt.billableMinutes} min`],
    ["Valor minuto", cop.format(receipt.pricePerMinute)],
  ]
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value!)}</dd>`)
    .join("");
  $("#receipt-total").textContent = cop.format(receipt.totalAmount);
  $("#receipt-breakdown").textContent = receipt.breakdown;
  modal.hidden = false;
}

modal.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("[data-close]")) modal.hidden = true;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") modal.hidden = true;
});

// ---- Notificaciones ----------------------------------------------------------

function toast(title: string, message: string, options: { error?: boolean; code?: string } = {}): void {
  const el = document.createElement("div");
  el.className = `toast${options.error ? " toast--error" : ""}`;
  el.innerHTML = `
    <span class="toast__icon">${options.error ? "⛔" : "✅"}</span>
    <div>
      <div class="toast__title">${escapeHtml(title)}</div>
      <div class="toast__msg">${escapeHtml(message)}</div>
      ${options.code ? `<div class="toast__code">gRPC status: ${escapeHtml(options.code)}</div>` : ""}
    </div>`;
  $("#toasts").append(el);
  setTimeout(() => {
    el.classList.add("is-out");
    el.addEventListener("animationend", () => el.remove());
  }, 4500);
}

function showError(error: unknown): void {
  const err = ConnectError.from(error);
  toast(ERROR_LABELS[err.code] ?? "Error", err.rawMessage, { error: true, code: Code[err.code] });
}

// ---- Formularios -------------------------------------------------------------

async function withLoading(form: HTMLFormElement, action: () => Promise<void>): Promise<void> {
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  button.disabled = true;
  button.classList.add("is-loading");
  try {
    await action();
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
  }
}

const entryForm = $<HTMLFormElement>("#entry-form");
const entryPlate = $<HTMLInputElement>("#entry-plate");
const exitForm = $<HTMLFormElement>("#exit-form");
const exitPlate = $<HTMLInputElement>("#exit-plate");

for (const input of [entryPlate, exitPlate]) {
  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
}

// Cambia el ejemplo de placa según el tipo de vehículo.
entryForm.addEventListener("change", () => {
  const isMoto = new FormData(entryForm).get("vehicle") === "motorcycle";
  entryPlate.placeholder = isMoto ? "ABC12D" : "ABC123";
});

entryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void withLoading(entryForm, async () => {
    const vehicleType =
      new FormData(entryForm).get("vehicle") === "motorcycle" ? VehicleType.MOTORCYCLE : VehicleType.CAR;
    const { ticket } = await client.registerEntry({ plate: entryPlate.value, vehicleType });
    if (!ticket) return;
    toast(`Ingreso registrado · ${ticket.spotId}`, `${ticket.plate} recibió el ticket ${ticket.id}.`);
    entryPlate.value = "";
  });
});

exitForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void withLoading(exitForm, async () => {
    const { receipt } = await client.registerExit({ plate: exitPlate.value });
    if (!receipt) return;
    openReceipt(receipt);
    exitPlate.value = "";
    await refreshReceipts();
  });
});

// Clic en un vehículo del mapa → precarga la placa en el formulario de salida.
$(".lot").addEventListener("click", (event) => {
  const stall = (event.target as HTMLElement).closest<HTMLElement>(".stall--busy");
  if (!stall?.dataset.plate) return;
  exitPlate.value = stall.dataset.plate;
  $("#exit-card").scrollIntoView({ behavior: "smooth", block: "center" });
  exitPlate.focus();
});

// ---- Stream en tiempo real (server streaming) --------------------------------

const live = $("#live-status");

function setLive(state: "connecting" | "online" | "offline", text: string): void {
  live.dataset.state = state;
  live.querySelector(".live__text")!.textContent = text;
}

async function watchSpots(): Promise<void> {
  let retryDelay = 1000;
  for (;;) {
    try {
      setLive("connecting", "Conectando stream…");
      for await (const update of client.watchSpots({})) {
        retryDelay = 1000;
        setLive("online", "Stream gRPC en vivo");
        renderSpots(update.spots);
        renderSummary(update.summary);
        if (update.event !== "heartbeat") {
          logRpc("ParkingService/WatchSpots", "▸ evento", "stream", update.event === "connected" ? "Stream abierto: estado inicial recibido" : update.event);
        }
      }
    } catch (error) {
      const err = ConnectError.from(error);
      logRpc("ParkingService/WatchSpots", Code[err.code], "err", "Stream interrumpido, reintentando…");
    }
    setLive("offline", "Reconectando…");
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
    retryDelay = Math.min(retryDelay * 2, 15000);
  }
}

// ---- Reloj y temporizadores --------------------------------------------------

function tick(): void {
  $("#clock").textContent = timeFormat.format(new Date());
  document.querySelectorAll<HTMLElement>(".stall__time[data-since]").forEach((el) => {
    el.textContent = formatElapsed(new Date(Number(el.dataset.since)));
  });
}
setInterval(tick, 1000);
tick();

// ---- Arranque ----------------------------------------------------------------

void watchSpots();
void refreshReceipts();
