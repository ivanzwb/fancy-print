import {
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

/** doc/4 §2.4.2 路径骨架（占位数据，后续接真实存储与 MQTT）。 */
@Controller('households/:householdId')
export class HouseholdsController {
  @Get('devices')
  devices(@Param('householdId') householdId: string) {
    return {
      household_id: householdId,
      devices: [{ device_id: 'fancy-print-dev', online: true, last_seen: null }],
    };
  }

  @Post('devices/bind')
  bind(
    @Param('householdId') householdId: string,
    @Body() _body: { bind_code?: string },
  ) {
    return { household_id: householdId, device_id: 'fancy-print-dev', status: 'bound' };
  }

  @Post('devices/:deviceId/unbind')
  unbind(
    @Param('householdId') householdId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return { household_id: householdId, device_id: deviceId, status: 'unbound' };
  }

  @Get('policy')
  getPolicy(@Param('householdId') householdId: string) {
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
    @Body() body: { expected_version?: number; remote_print_gate?: boolean },
  ) {
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
  pendingApprovals(@Param('householdId') householdId: string) {
    return { household_id: householdId, items: [] };
  }

  @Get('jobs')
  jobs(@Param('householdId') householdId: string) {
    return { household_id: householdId, items: [], page: { next_cursor: null } };
  }

  @Post('jobs/:jobId/approve')
  approve(
    @Param('householdId') householdId: string,
    @Param('jobId') jobId: string,
  ) {
    return { household_id: householdId, job_id: jobId, status: 'approved' };
  }

  @Post('jobs/:jobId/reject')
  reject(
    @Param('householdId') householdId: string,
    @Param('jobId') jobId: string,
  ) {
    return { household_id: householdId, job_id: jobId, status: 'rejected' };
  }
}
