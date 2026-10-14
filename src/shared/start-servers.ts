import http from "node:http";
import http2 from "node:http2";
import type { ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";

// Firma mínima común a las peticiones HTTP/1.1 y HTTP/2 de Node.
interface RequestLike {
  url?: string;
}
interface ResponseLike extends NodeJS.WritableStream {
  writeHead(statusCode: number, headers?: Record<string, string>): unknown;
}
export type RequestHandler = (req: RequestLike, res: ResponseLike) => void;

interface StartOptions {
  serviceName: string;
  routes: (router: ConnectRouter) => void;
  // Puerto HTTP/1.1: protocolos Connect y gRPC-Web (navegador y nube).
  port: number;
  // Puerto HTTP/2 sin TLS (h2c): gRPC nativo (grpcurl, Postman, otros servicios).
  grpcPort?: number;
  // Manejador para rutas que no son RPC (por ejemplo, archivos estáticos).
  fallback?: RequestHandler;
}

/**
 * Levanta el servicio en uno o dos puertos.
 *
 * ¿Por qué dos puertos? Los hostings gratuitos (como Render) terminan el TLS y
 * reenvían el tráfico a la app por HTTP/1.1. Con ConnectRPC, el mismo servicio
 * habla tres protocolos: gRPC, gRPC-Web y Connect. Por HTTP/1.1 funcionan
 * gRPC-Web y Connect (perfectos para el navegador, sin proxy Envoy). Por HTTP/2
 * se habla gRPC nativo, ideal para demostrar con grpcurl en local.
 */
export function startServers(options: StartOptions): void {
  const handler = connectNodeAdapter({
    routes: options.routes,
    fallback: options.fallback,
  });

  http.createServer(handler).listen(options.port, () => {
    console.log(
      `🚀 ${options.serviceName} escuchando en http://localhost:${options.port} (Connect + gRPC-Web)`,
    );
  });

  if (options.grpcPort) {
    http2.createServer(handler).listen(options.grpcPort, () => {
      console.log(
        `⚡ ${options.serviceName} escuchando gRPC nativo (HTTP/2) en localhost:${options.grpcPort}`,
      );
    });
  }
}
