import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

export interface DevicePrincipal {
  device_id: string;
}

export const CurrentDevice = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): DevicePrincipal => {
    const req = ctx.switchToHttp().getRequest();
    const d = req.device as DevicePrincipal | undefined;
    if (!d?.device_id) {
      throw new UnauthorizedException({
        code: 'DEVICE_CONTEXT_MISSING',
        message: 'Internal error: device principal not set',
      });
    }
    return d;
  },
);
