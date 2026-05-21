import { Controller, Get } from '@nestjs/common';
import {
  CurrentParent,
  type ParentPrincipal,
} from '../common/current-parent.decorator';

@Controller()
export class MeController {
  @Get('me')
  me(@CurrentParent() p: ParentPrincipal) {
    return {
      parent_id: p.sub,
      email: p.email,
      default_household_id: p.household_id,
    };
  }
}
