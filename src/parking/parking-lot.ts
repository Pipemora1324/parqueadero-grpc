import { EventEmitter } from "node:events";
import { VehicleType } from "../gen/billing/v1/billing_pb";

// -----------------------------------------------------------------------------
// ESTADO DEL PARQUEADERO (en memoria).
// Mantiene las celdas, los tickets activos y los recibos. Cada cambio emite un
// evento "change" que el stream gRPC (WatchSpots) reenvía a los clientes.
// Nota: al estar en memoria, los datos se reinician si el servicio se reinicia.
// -----------------------------------------------------------------------------

export interface SpotState {
  id: string;
  allowedType: VehicleType;
  occupant?: ActiveTicket;
}

export interface ActiveTicket {
  id: string;
  plate: string;
  vehicleType: VehicleType;
  spotId: string;
  enteredAt: Date;
}

export interface ReceiptRecord {
  ticketId: string;
  plate: string;
  vehicleType: VehicleType;
  spotId: string;
  enteredAt: Date;
  exitedAt: Date;
  totalMinutes: number;
  billableMinutes: number;
  pricePerMinute: number;
  totalAmount: number;
  breakdown: string;
}

export interface FeeQuote {
  totalMinutes: number;
  billableMinutes: number;
  pricePerMinute: number;
  totalAmount: number;
  breakdown: string;
}

export class DomainError extends Error {
  constructor(
    message: string,
    readonly kind: "already_exists" | "not_found" | "full",
  ) {
    super(message);
  }
}

const CAR_SPOTS = 12;
const MOTORCYCLE_SPOTS = 6;
const MAX_RECEIPTS = 50;

export class ParkingLot extends EventEmitter {
  private readonly spots: SpotState[] = [];
  private readonly receipts: ReceiptRecord[] = [];
  private ticketSequence = 1000;
  private revenue = 0;

  constructor() {
    super();
    this.setMaxListeners(0); // Muchos navegadores pueden observar a la vez.
    for (let i = 1; i <= CAR_SPOTS; i++) {
      this.spots.push({ id: `A-${String(i).padStart(2, "0")}`, allowedType: VehicleType.CAR });
    }
    for (let i = 1; i <= MOTORCYCLE_SPOTS; i++) {
      this.spots.push({ id: `M-${String(i).padStart(2, "0")}`, allowedType: VehicleType.MOTORCYCLE });
    }
  }

  getSpots(): ReadonlyArray<SpotState> {
    return this.spots;
  }

  getReceipts(limit: number): ReadonlyArray<ReceiptRecord> {
    return this.receipts.slice(0, limit);
  }

  getSummary() {
    const available = this.spots.filter((s) => !s.occupant);
    return {
      totalSpots: this.spots.length,
      availableSpots: available.length,
      occupiedSpots: this.spots.length - available.length,
      availableCarSpots: available.filter((s) => s.allowedType === VehicleType.CAR).length,
      availableMotorcycleSpots: available.filter((s) => s.allowedType === VehicleType.MOTORCYCLE).length,
      revenue: this.revenue,
      completedExits: this.receipts.length,
    };
  }

  findActiveTicket(plate: string): ActiveTicket | undefined {
    return this.spots.find((s) => s.occupant?.plate === plate)?.occupant;
  }

  /** Asigna la primera celda libre compatible con el tipo de vehículo. */
  registerEntry(plate: string, vehicleType: VehicleType, enteredAt = new Date()): ActiveTicket {
    if (this.findActiveTicket(plate)) {
      throw new DomainError(`El vehículo ${plate} ya se encuentra dentro del parqueadero`, "already_exists");
    }

    const spot = this.spots.find((s) => s.allowedType === vehicleType && !s.occupant);
    if (!spot) {
      const label = vehicleType === VehicleType.CAR ? "carros" : "motos";
      throw new DomainError(`No hay celdas disponibles para ${label}`, "full");
    }

    const ticket: ActiveTicket = {
      id: `T-${++this.ticketSequence}`,
      plate,
      vehicleType,
      spotId: spot.id,
      enteredAt,
    };
    spot.occupant = ticket;
    this.notify(`Ingresó ${plate} a la celda ${spot.id}`);
    return ticket;
  }

  /**
   * Cierra el ticket y libera la celda. Recibe la tarifa ya calculada por el
   * microservicio de facturación, así el estado solo cambia si el cobro fue exitoso.
   */
  completeExit(ticket: ActiveTicket, exitedAt: Date, fee: FeeQuote): ReceiptRecord {
    const spot = this.spots.find((s) => s.id === ticket.spotId);
    if (!spot || spot.occupant?.id !== ticket.id) {
      throw new DomainError(`El vehículo ${ticket.plate} ya no está en el parqueadero`, "not_found");
    }

    spot.occupant = undefined;
    const receipt: ReceiptRecord = {
      ticketId: ticket.id,
      plate: ticket.plate,
      vehicleType: ticket.vehicleType,
      spotId: ticket.spotId,
      enteredAt: ticket.enteredAt,
      exitedAt,
      ...fee,
    };
    this.receipts.unshift(receipt);
    this.receipts.length = Math.min(this.receipts.length, MAX_RECEIPTS);
    this.revenue += fee.totalAmount;
    this.notify(`Salió ${ticket.plate} de la celda ${spot.id}`);
    return receipt;
  }

  /** Precarga vehículos con horas de entrada en el pasado para la demostración. */
  seedDemoData(): void {
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    const demo: Array<[string, VehicleType, number]> = [
      ["KLM482", VehicleType.CAR, 187],
      ["HTR915", VehicleType.CAR, 94],
      ["BCD207", VehicleType.CAR, 41],
      ["XYZ730", VehicleType.CAR, 12],
      ["QWE34F", VehicleType.MOTORCYCLE, 66],
      ["PLM08K", VehicleType.MOTORCYCLE, 23],
    ];
    for (const [plate, type, minutes] of demo) {
      this.registerEntry(plate, type, minutesAgo(minutes));
    }
  }

  private notify(event: string): void {
    this.emit("change", event);
  }
}
