import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'package:http/http.dart' as http;

import '../api/api_client.dart';
import '../api/models.dart';
import '../state/auth_controller.dart';
import '../utils/error_helper.dart';

/// Handles the OIDC/SSO authentication flow for the parent Flutter app.
///
/// Flow:
/// 1. Call the backend login endpoint to get the IdP authorization URL.
/// 2. Open a system browser (via `flutter_web_auth_2`) for the user to
///    authenticate with the OIDC provider.
/// 3. The IdP redirects to the backend callback; after processing, the
///    backend redirects to a custom scheme URL (`zhizhifamily://`) with
///    tokens.
/// 4. `flutter_web_auth_2` captures the redirect and returns the token URL.
/// 5. Parse tokens and complete the login via [AuthController].
class OidcAuthService {
  OidcAuthService({
    required this.baseUrl,
    required this.auth,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  final String baseUrl;
  final AuthController auth;
  final http.Client _http;

  static const _callbackScheme = 'zhizhifamily';

  /// Whether OIDC is supported (backend has `OIDC_ISSUER` set).
  Future<bool> isAvailable() async {
    try {
      final res = await _http.get(
        Uri.parse('$baseUrl/v1/parent/auth/oidc/login'),
        headers: const {'accept': 'application/json'},
      );
      // 200 = configured, 500 = OIDC_NOT_CONFIGURED
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Initiate the OIDC login flow via system browser.
  ///
  /// Throws [OidcException] on failure.
  Future<void> login() async {
    // Step 1: Get the IdP authorization URL from the backend,
    // passing our redirect URI so the backend redirects back to us.
    final redirectUri = '$_callbackScheme://oidc/callback';
    final loginRes = await _http.get(
      Uri.parse(
        '$baseUrl/v1/parent/auth/oidc/login'
        '?redirect_uri=${Uri.encodeQueryComponent(redirectUri)}',
      ),
      headers: const {'accept': 'application/json'},
    );

    if (loginRes.statusCode != 200) {
      Map<String, dynamic> body;
      try {
        body = jsonDecode(loginRes.body) as Map<String, dynamic>;
      } catch (_) {
        body = <String, dynamic>{};
      }
      throw OidcException(
        body['code']?.toString() ?? 'OIDC_LOGIN_FAILED',
        body['message']?.toString() ?? 'Failed to start OIDC login',
      );
    }

    final body = jsonDecode(loginRes.body) as Map<String, dynamic>;
    final redirectUrl = body['redirect_url'] as String?;
    if (redirectUrl == null) {
      throw OidcException(
        'OIDC_NO_REDIRECT',
        'No redirect URL returned from backend',
      );
    }

    // Step 2: Open the IdP authorization URL in a system browser.
    // flutter_web_auth_2 will capture the redirect to the callback scheme.
    final resultUrl = await FlutterWebAuth2.authenticate(
      url: redirectUrl,
      callbackUrlScheme: _callbackScheme,
    );

    // Step 3: Parse tokens from the redirect URL query params.
    final uri = Uri.parse(resultUrl);
    final accessToken = uri.queryParameters['access_token'];
    final refreshToken = uri.queryParameters['refresh_token'];
    final error = uri.queryParameters['error'];

    if (error != null) {
      throw OidcException('OIDC_PROVIDER_ERROR', 'SSO 登录失败：$error');
    }

    if (accessToken == null || refreshToken == null) {
      throw OidcException(
        'OIDC_NO_TOKENS',
        '未能获取登录凭证，请重试',
      );
    }

    // Step 4: Update auth state with the received tokens.
    await auth.update(TokenPair(
      accessToken: accessToken,
      refreshToken: refreshToken,
      tokenType: 'Bearer',
      expiresIn: 3600,
    ));

    // Step 5: Fetch user profile to learn the household ID.
    try {
      final me = await auth.client.getMe();
      await auth.setProfile(me);
      if (me.defaultHouseholdId != null) {
        await auth.setHousehold(me.defaultHouseholdId!);
      }
      if (me.email != null) {
        await auth.setEmail(me.email!);
      }
    } catch (_) {
      // Profile fetch is best-effort; the user can still navigate
      // but some features may be limited.
    }
  }
}

/// Exception thrown by [OidcAuthService].
class OidcException implements Exception, ExceptionWithMessage {
  OidcException(this.code, this.message);
  final String code;
  final String message;

  @override
  String toString() => 'OidcException($code): $message';
}
