import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CurrentParent,
  type ParentPrincipal,
} from '../common/current-parent.decorator';
import { HouseholdsService } from './households.service';

/** doc/4 §2.4.2 家庭与设备管理。 */
@Controller('households/:householdId')
export class HouseholdsController {
  constructor(private readonly service: HouseholdsService) {}

  private assertHousehold(householdId: string, parent: ParentPrincipal) {
    if (householdId !== parent.household_id) {
      throw new ForbiddenException({
        code: 'HOUSEHOLD_FORBIDDEN',
        message: 'Token is not authorized for this household',
      });
    }
  }

  @Get('devices')
  async devices(
    @Param('householdId') householdId: string,
    @CurrentParent() parent: ParentPrincipal,
  ) {
    this.assertHousehold(householdId, parent);
    const devices = await this.service.getDevices(householdId);
    return { household_id: householdId, devices };
  }

  @Post('devices/bind')
  async bind(
    @Param('householdId') householdId: string,
    @CurrentParent() parent: ParentPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: { bind_code?: string },
  ) {
    this.assertHousehold(householdId, parent);
    const deviceId = body.bind_code ?? 'fancy-print-dev';
    return this.service.bindDevice(householdId, deviceId, idempotencyKey);
  }

  @Post('devices/:deviceId/unbind')
  async unbind(
    @Param('householdId') householdId: string,
    @Param('deviceId') deviceId: string,
    @CurrentParent() parent: ParentPrincipal,
  ) {
    this.assertHousehold(householdId, parent);
    return this.service.unbindDevice(householdId, deviceId);
  }

  @Get('policy')
  async getPolicy(
    @Param('householdId') householdId: string,
    @CurrentParent() parent: ParentPrincipal,
  ) {
    this.assertHousehold(householdId, parent);
    const policy = await this.service.getPolicy(householdId);
    return { household_id: householdId, ...policy };
  }

  @Patch('policy')
  async patchPolicy(
    @Param('householdId') householdId: string,
    @CurrentParent() parent: ParentPrincipal,
    @Body() body: { expected_version?: number; remote_print_gate?: boolean },
  ) {
    this.assertHousehold(householdId, parent);
    return this.service.patchPolicy(
      householdId,
      body.expected_version,
      body.remote_print_gate,
    );
  }

  @Get('jobs/pending-approvals')
  async pendingApprovals(
    @Param('householdId') householdId: string,
    @CurrentParent() parent: ParentPrincipal,
  ) {
    this.assertHousehold(householdId, parent);
    const items = await this.service.getPendingApprovals(householdId);
    return { household_id: householdId, items };
  }

  @Get('jobs')
  async jobs(
    @Param('householdId') householdId: string,
    @CurrentParent() parent: ParentPrincipal,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    this.assertHousehold(householdId, parent);
    return this.service.getJobs(
      householdId,
      cursor,
      limit ? Math.min(Number(limit), 100) : 20,
    );
  }

  @Post('jobs/:jobId/approve')
  async approve(
    @Param('householdId') householdId: string,
    @Param('jobId') jobId: string,
    @CurrentParent() parent: ParentPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: { device_id?: string },
  ) {
    this.assertHousehold(householdId, parent);
    return this.service.approve(householdId, jobId, idempotencyKey, body.device_id);
  }

  @Post('jobs/:jobId/reject')
  async reject(
    @Param('householdId') householdId: string,
    @Param('jobId') jobId: string,
    @CurrentParent() parent: ParentPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: { device_id?: string },
  ) {
    this.assertHousehold(householdId, parent);
    return this.service.reject(householdId, jobId, idempotencyKey, body.device_id);
  }
}
