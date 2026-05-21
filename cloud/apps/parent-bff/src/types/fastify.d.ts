import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    parent?: {
      sub: string;
      email: string;
      household_id: string;
    };
  }
}
