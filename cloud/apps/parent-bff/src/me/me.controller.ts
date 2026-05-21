import { Controller, Get, Req } from '@nestjs/common';

@Controller()
export class MeController {
  @Get('me')
  me(@Req() req: { parent?: { sub: string; email: string; household_id: string } }) {
    const p = req.parent!;
    return {
      parent_id: p.sub,
      email: p.email,
      default_household_id: p.household_id,
    };
  }
}
