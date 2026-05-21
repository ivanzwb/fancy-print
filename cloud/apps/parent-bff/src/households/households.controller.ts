import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CurrentParent,
  type ParentPrincipal,
} from '../common/current-parent.decorator';
import { HouseholdsStubService } from './households.stub.service';

/** doc/4 §2.4.2 路径骨架（占位数据，后续接真实存储与 MQTT）。 */
@Controller('households/:householdId')
export class HouseholdsController {
  constructor(private readonly stub: HouseholdsStubService) {}

  private assertHousehold(householdId: string, parent: ParentPrincipal) {
    if (householdId !== parent.household_id) {
      throw new ForbiddenException({
        code: 'HOUSEHOLD_FORBIDDEN',
        message: 'Token is not authorized for this household',
      });
    }
  }

  @Get('devices')
  devices(
    @Param('householdId') householdId: string,
    @CurrentParent() parent: ParentPrincipal,
  ) {
    this.assertHousehold(householdId, parent);
    return {
      household_id: householdId,
      devices: [{ device_id: 'fancy-print-dev', online: true, last_seen: null }],
    };
  }

  @Post('devices/bind')
  bind(
    @Param('householdId') householdId: string,
    @CurrentParent() parent: ParentPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: { bind_code?: string },
  ) {
    this.assertHousehold(householdId, parent);
    return this.stub.bind(householdId, idempotencyKey, body);
  }

  @Post('devices/:deviceId/unbind')
  unbind(
    @Param('householdId') householdId: string,
    @Param('deviceId') deviceId: string,
    @CurrentParent() parent: ParentPrincipal,
  ) {
    this.assertHousehold(householdId, parent);
    return { household_id: householdId, device_id: deviceId, status: 'unbound' };
  }

  @Get('policy')
  getPolicy(
    @Param('householdId') householdId: string,
    @CurrentParent() parent: ParentPrincipal,
  ) {
    this.assertHousehold(householdId, parent);
    return {
      household_id: householdId,
      version: 1,
      tier: 'A',
      remote_print_gate: false,
    };
  }

  @Patch('policy')
  patchPolicy(
    @Param('householdId') householdId: string,
    @CurrentParent() parent: ParentPrincipal,
    @Body() body: { expected_version?: number; remote_print_gate?: boolean },
  ) {
    this.assertHousehold(householdId, parent);
    if (body.expected_version !== undefined && body.expected_version !== 1) {
      throw new ConflictException({
        code: 'POLICY_VERSION_CONFLICT',
        message: 'Policy version mismatch; refresh and retry',
      });
    }
    return {
      household_id: householdId,
      version: 2,
      remote_print_gate: body.remote_print_gate ?? false,
      applied: true,
    };
  }

  @Get('jobs/pending-approvals')
  pendingApprovals(
    @Param('householdId') householdId: string,
    @CurrentParent() parent: ParentPrincipal,
  ) {
    this.assertHousehold(householdId, parent);
    return { household_id: householdId, items: [] };
  }

  @Get('jobs')
  jobs(
    @Param('householdId') householdId: string,
    @CurrentParent() parent: ParentPrincipal,
  ) {
    this.assertHousehold(householdId, parent);
    return { household_id: householdId, items: [], page: { next_cursor: null } };
  }

  @Post('jobs/:jobId/approve')
  approve(
    @Param('householdId') householdId: string,
    @Param('jobId') jobId: string,
    @CurrentParent() parent: ParentPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    this.assertHousehold(householdId, parent);
    return this.stub.approve(householdId, jobId, idempotencyKey);
  }

  @Post('jobs/:jobId/reject')
  reject(
    @Param('householdId') householdId: string,
    @Param('jobId') jobId: string,
    @CurrentParent() parent: ParentPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    this.assertHousehold(householdId, parent);
    return this.stub.reject(householdId, jobId, idempotencyKey);
  }
}
