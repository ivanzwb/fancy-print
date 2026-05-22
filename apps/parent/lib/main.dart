import 'package:flutter/material.dart';

import 'api/api_client.dart';
import 'auth/oidc_service.dart';
import 'screens/home_shell.dart';
import 'screens/login_screen.dart';
import 'state/auth_controller.dart';
import 'theme.dart';

/// Resolves the parent-bff base URL. Override via `--dart-define=PARENT_BFF_URL=...`
/// at run / build time; defaults to the dev-direct port from
/// `contracts/openapi/parent-v1-mvp.yaml`.
const _baseUrl = String.fromEnvironment(
  'PARENT_BFF_URL',
  defaultValue: ParentApiClient.defaultBaseUrl,
);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final auth = AuthController(
    makeClient: (store) =>
        ParentApiClient(baseUrl: _baseUrl, tokens: store),
  );
  final oidc = OidcAuthService(baseUrl: _baseUrl, auth: auth);
  runApp(FancyPrintParentApp(auth: auth, oidc: oidc));
  // Fire-and-forget bootstrap; the AuthGate listens for state changes.
  auth.bootstrap();
}

class FancyPrintParentApp extends StatelessWidget {
  const FancyPrintParentApp({super.key, required this.auth, required this.oidc});

  final AuthController auth;
  final OidcAuthService oidc;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '奇想印印',
      theme: ParentTheme.light(),
      home: _AuthGate(auth: auth, oidc: oidc),
      debugShowCheckedModeBanner: false,
    );
  }
}

class _AuthGate extends StatelessWidget {
  const _AuthGate({required this.auth, required this.oidc});

  final AuthController auth;
  final OidcAuthService oidc;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: auth,
      builder: (_, __) {
        if (auth.loading) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        return auth.isLoggedIn
            ? HomeShell(auth: auth)
            : LoginScreen(auth: auth, oidc: oidc);
      },
    );
  }
}
