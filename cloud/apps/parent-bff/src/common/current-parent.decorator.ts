import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type ParentPrincipal = {
  sub: string;
  email: string;
  household_id: string;
};

export const CurrentParent = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ParentPrincipal => {
    const req = ctx.switchToHttp().getRequest<{ parent?: ParentPrincipal }>();
    return req.parent!;
  },
);
