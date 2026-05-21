import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/public.decorator';
import { ParentAuthService } from './parent-auth.service';

@Injectable()
export class ParentJwtAuthGuard implements CanActivate {
  constructor(
    private readonly auth: ParentAuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    try {
      const p = this.auth.verifyAccess(req.headers?.authorization as string);
      req.parent = p;
      return true;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }
  }
}
