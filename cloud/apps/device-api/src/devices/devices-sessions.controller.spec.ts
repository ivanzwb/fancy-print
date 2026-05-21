import { Test, TestingModule } from '@nestjs/testing';
import { DevicesSessionsController } from './devices-sessions.controller';
import { AuthService } from '../auth/auth.service';

describe('DevicesSessionsController', () => {
  let controller: DevicesSessionsController;
  let auth: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DevicesSessionsController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            exchangeDeviceCredentials: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(DevicesSessionsController);
    auth = module.get(AuthService) as jest.Mocked<AuthService>;
  });

  // ---------------------------------------------------------------------------
  // POST /v1/devices/sessions — alternate auth path (doc §2.4.1)
  // ---------------------------------------------------------------------------
  describe('sessions', () => {
    it('should delegate to auth.exchangeDeviceCredentials', async () => {
      auth.exchangeDeviceCredentials.mockResolvedValue({
        access_token: 'at',
        refresh_token: 'rt',
        token_type: 'Bearer',
        expires_in: 900,
      });

      const result = await controller.sessions({
        device_id: 'dev-1',
        device_secret: 's3cret',
      });

      expect(auth.exchangeDeviceCredentials).toHaveBeenCalledWith(
        'dev-1',
        's3cret',
      );
      expect(result.access_token).toBe('at');
    });

    it('should pass empty strings when body fields are missing', async () => {
      auth.exchangeDeviceCredentials.mockRejectedValue(new Error('never'));

      await expect(controller.sessions({})).rejects.toThrow();
      expect(auth.exchangeDeviceCredentials).toHaveBeenCalledWith('', '');
    });
  });
});
