import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

import 'models.dart';

/// Thin wrapper around the parent-bff HTTP API.
///
/// Reads / writes tokens through the [TokenStore] callbacks; auto-refreshes
/// the access token on `401` using the refresh token and replays the request
/// once. All household paths assert against the [TokenStore.householdId].
class ParentApiClient {
  ParentApiClient({
    required this.baseUrl,
    required this.tokens,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  /// Default dev base URL (parent-bff direct). Override via [baseUrl].
  static const String defaultBaseUrl = 'http://127.0.0.1:3002';

  final String baseUrl;
  final TokenStore tokens;
  final http.Client _http;

  static final _rand = Random.secure();

  /// Generates a UUIDv4-ish opaque key for `Idempotency-Key`.
  static String newIdempotencyKey() {
    final bytes = List<int>.generate(16, (_) => _rand.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-'
        '${hex.substring(20)}';
  }

  void dispose() => _http.close();

  Uri _u(String path) => Uri.parse('$baseUrl$path');

  // ── Auth ──────────────────────────────────────────────────────────

  Future<TokenPair> login(String email, String password) async {
    final res = await _http.post(
      _u('/v1/parent/auth/login'),
      headers: const {'content-type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    final body = _decode(res);
    if (res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        body['code']?.toString() ?? 'LOGIN_FAILED',
        body['message']?.toString() ?? 'Login failed',
      );
    }
    return TokenPair.fromJson(body);
  }

  Future<TokenPair> refresh(String refreshToken) async {
    final res = await _http.post(
      _u('/v1/parent/auth/token'),
      headers: const {'content-type': 'application/json'},
      body: jsonEncode({'refresh_token': refreshToken}),
    );
    final body = _decode(res);
    if (res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        body['code']?.toString() ?? 'REFRESH_FAILED',
        body['message']?.toString() ?? 'Refresh failed',
      );
    }
    return TokenPair.fromJson(body);
  }

  // ── Profile ───────────────────────────────────────────────────────

  Future<ParentProfile> getMe() async {
    final body = await _authed('GET', '/v1/parent/me');
    return ParentProfile.fromJson(body);
  }

  // ── Devices ───────────────────────────────────────────────────────

  Future<List<HouseholdDevice>> listDevices() async {
    final hh = tokens.householdId!;
    final body = await _authed('GET', '/v1/parent/households/$hh/devices');
    final list = (body['devices'] as List?) ?? const [];
    return list
        .whereType<Map<String, dynamic>>()
        .map(HouseholdDevice.fromJson)
        .toList();
  }

  Future<HouseholdDevice> bindDevice(String bindCode) async {
    final hh = tokens.householdId!;
    final body = await _authed(
      'POST',
      '/v1/parent/households/$hh/devices/bind',
      body: {'bind_code': bindCode},
      extraHeaders: {'Idempotency-Key': newIdempotencyKey()},
    );
    return HouseholdDevice(
      deviceId: body['device_id']?.toString() ?? bindCode,
      online: true,
      lastSeen: DateTime.now(),
    );
  }

  Future<void> unbindDevice(String deviceId) async {
    final hh = tokens.householdId!;
    await _authed(
      'POST',
      '/v1/parent/households/$hh/devices/$deviceId/unbind',
    );
  }

  // ── Policy ────────────────────────────────────────────────────────

  Future<HouseholdPolicy> getPolicy() async {
    final hh = tokens.householdId!;
    final body = await _authed('GET', '/v1/parent/households/$hh/policy');
    return HouseholdPolicy.fromJson(body);
  }

  /// Returns the updated policy. The bff response only carries the new
  /// `version` + `remote_print_gate` and `applied:true`; we fold those into
  /// the previous tier value.
  Future<HouseholdPolicy> patchPolicy({
    required int expectedVersion,
    bool? remotePrintGate,
    required String tier,
  }) async {
    final hh = tokens.householdId!;
    final reqBody = <String, dynamic>{
      'expected_version': expectedVersion,
      if (remotePrintGate != null) 'remote_print_gate': remotePrintGate,
    };
    final body = await _authed(
      'PATCH',
      '/v1/parent/households/$hh/policy',
      body: reqBody,
    );
    return HouseholdPolicy(
      version: (body['version'] as num?)?.toInt() ?? expectedVersion + 1,
      tier: tier,
      remotePrintGate:
          body['remote_print_gate'] as bool? ?? (remotePrintGate ?? false),
    );
  }

  // ── Jobs ──────────────────────────────────────────────────────────

  Future<JobList> listJobs({String? cursor, int limit = 20}) async {
    final hh = tokens.householdId!;
    final qp = <String, String>{
      if (cursor != null) 'cursor': cursor,
      'limit': '$limit',
    };
    final body = await _authed(
      'GET',
      '/v1/parent/households/$hh/jobs',
      query: qp,
    );
    return JobList.fromJson(body);
  }

  Future<List<ApprovalRecord>> listPendingApprovals() async {
    final hh = tokens.householdId!;
    final body = await _authed(
      'GET',
      '/v1/parent/households/$hh/jobs/pending-approvals',
    );
    final list = (body['items'] as List?) ?? const [];
    return list
        .whereType<Map<String, dynamic>>()
        .map(ApprovalRecord.fromJson)
        .toList();
  }

  Future<ApprovalRecord> approveJob(String jobId, {String? deviceId}) async {
    final hh = tokens.householdId!;
    final body = await _authed(
      'POST',
      '/v1/parent/households/$hh/jobs/$jobId/approve',
      body: {if (deviceId != null) 'device_id': deviceId},
      extraHeaders: {'Idempotency-Key': newIdempotencyKey()},
    );
    return ApprovalRecord.fromJson(body);
  }

  Future<ApprovalRecord> rejectJob(String jobId, {String? deviceId}) async {
    final hh = tokens.householdId!;
    final body = await _authed(
      'POST',
      '/v1/parent/households/$hh/jobs/$jobId/reject',
      body: {if (deviceId != null) 'device_id': deviceId},
      extraHeaders: {'Idempotency-Key': newIdempotencyKey()},
    );
    return ApprovalRecord.fromJson(body);
  }

  // ── Internal ──────────────────────────────────────────────────────

  Map<String, dynamic> _decode(http.Response res) {
    if (res.body.isEmpty) return const <String, dynamic>{};
    try {
      final decoded = jsonDecode(res.body);
      if (decoded is Map<String, dynamic>) return decoded;
      return {'_raw': decoded};
    } catch (_) {
      return const <String, dynamic>{};
    }
  }

  Future<Map<String, dynamic>> _authed(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? query,
    Map<String, String>? extraHeaders,
  }) async {
    Future<http.Response> send(String accessToken) {
      final uri = query == null
          ? _u(path)
          : _u(path).replace(queryParameters: query);
      final headers = <String, String>{
        'authorization': 'Bearer $accessToken',
        if (body != null) 'content-type': 'application/json',
        ...?extraHeaders,
      };
      final bodyStr = body == null ? null : jsonEncode(body);
      switch (method) {
        case 'GET':
          return _http.get(uri, headers: headers);
        case 'POST':
          return _http.post(uri, headers: headers, body: bodyStr);
        case 'PATCH':
          return _http.patch(uri, headers: headers, body: bodyStr);
        case 'DELETE':
          return _http.delete(uri, headers: headers, body: bodyStr);
        default:
          throw ArgumentError('Unsupported method $method');
      }
    }

    final access = tokens.accessToken;
    if (access == null) {
      throw ApiException(401, 'NO_SESSION', 'Not logged in');
    }
    var res = await send(access);

    if (res.statusCode == 401 && tokens.refreshToken != null) {
      try {
        final pair = await refresh(tokens.refreshToken!);
        await tokens.update(pair);
      } catch (e) {
        await tokens.clear();
        rethrow;
      }
      res = await send(tokens.accessToken!);
    }

    final decoded = _decode(res);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return decoded;
    }
    throw ApiException(
      res.statusCode,
      decoded['code']?.toString() ?? 'REQUEST_FAILED',
      decoded['message']?.toString() ?? 'Request failed',
    );
  }
}

/// Token storage abstraction. Implementations persist tokens between launches
/// and expose the parent's default household ID extracted from the access
/// token (or recorded after `/v1/parent/me`).
abstract class TokenStore {
  String? get accessToken;
  String? get refreshToken;
  String? get householdId;

  Future<void> update(TokenPair pair);
  Future<void> setHousehold(String householdId);
  Future<void> clear();
}
