import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    device?: { device_id: string };
  }
}
