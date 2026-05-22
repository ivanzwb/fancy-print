import 'package:fancy_print_parent/api/api_client.dart';
import 'package:fancy_print_parent/api/models.dart';
import 'package:fancy_print_parent/main.dart';
import 'package:fancy_print_parent/state/auth_controller.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('login screen renders when no session', (tester) async {
    final auth = AuthController(
      makeClient: (store) =>
          ParentApiClient(baseUrl: 'http://127.0.0.1:0', tokens: store),
    );
    await tester.pumpWidget(FancyPrintParentApp(auth: auth));
    await auth.bootstrap();
    await tester.pumpAndSettle();
    expect(find.text('奇想印印 · 家长端'), findsOneWidget);
  });

  test('idempotency key is uuid-shaped', () {
    final k = ParentApiClient.newIdempotencyKey();
    expect(k.length, 36);
    expect(k[8], '-');
    expect(k[13], '-');
    expect(k[18], '-');
    expect(k[23], '-');
  });

  test('models parse parent-bff shapes', () {
    final policy = HouseholdPolicy.fromJson(const {
      'version': 3,
      'tier': 'A',
      'remote_print_gate': true,
    });
    expect(policy.version, 3);
    expect(policy.remotePrintGate, isTrue);

    final dev = HouseholdDevice.fromJson(const {
      'device_id': 'd1',
      'online': true,
      'last_seen': '2026-05-22T10:00:00Z',
    });
    expect(dev.deviceId, 'd1');
    expect(dev.online, isTrue);
    expect(dev.lastSeen, isNotNull);

    final job = JobEntry.fromJson(const {
      'job_id': 'j1',
      'device_id': 'd1',
      'content_mode': 'coloring_quiet_book',
      'state': 'printed',
      'created_at': '2026-05-22T10:00:00Z',
    });
    expect(job.jobId, 'j1');
    expect(job.state, 'printed');
  });
}
