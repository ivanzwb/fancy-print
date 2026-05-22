import { Test, TestingModule } from '@nestjs/testing';
import { MeController } from './me.controller';
import type { ParentPrincipal } from '../common/current-parent.decorator';

describe('MeController', () => {
  let controller: MeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeController],
    }).compile();
    controller = module.get(MeController);
  });

  it('returns parent info from token', () => {
    const parent: ParentPrincipal = {
      sub: 'parent:alice@test.com',
      email: 'alice@test.com',
      household_id: 'hh-alice',
    };
    const result = controller.me(parent);
    expect(result.parent_id).toBe('parent:alice@test.com');
    expect(result.email).toBe('alice@test.com');
    expect(result.default_household_id).toBe('hh-alice');
  });
});
