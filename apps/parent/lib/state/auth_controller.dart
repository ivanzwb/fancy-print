import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../api/models.dart';

/// Persists parent tokens + household via [SharedPreferences] and exposes
/// reactive auth state to the UI.
class AuthController extends ChangeNotifier implements TokenStore {
  AuthController({required this.makeClient});

  /// Factory injected from main so tests can swap the http client.
  final ParentApiClient Function(TokenStore tokens) makeClient;

  static const _kAccess = 'parent.access_token';
  static const _kRefresh = 'parent.refresh_token';
  static const _kHousehold = 'parent.household_id';
  static const _kEmail = 'parent.email';

  String? _access;
  String? _refresh;
  String? _household;
  String? _email;
  bool _loading = true;
  ParentProfile? _profile;

  late ParentApiClient _client = makeClient(this);

  // TokenStore impl
  @override
  String? get accessToken => _access;
  @override
  String? get refreshToken => _refresh;
  @override
  String? get householdId => _household;

  bool get loading => _loading;
  bool get isLoggedIn => _access != null && _household != null;
  String? get email => _email;
  ParentProfile? get profile => _profile;
  ParentApiClient get client => _client;

  Future<void> bootstrap() async {
    final sp = await SharedPreferences.getInstance();
    _access = sp.getString(_kAccess);
    _refresh = sp.getString(_kRefresh);
    _household = sp.getString(_kHousehold);
    _email = sp.getString(_kEmail);
    _loading = false;
    notifyListeners();

    if (isLoggedIn) {
      // Best-effort refresh of profile; swallow auth errors so the user sees
      // the login screen rather than a hang.
      try {
        final me = await _client.getMe();
        _profile = me;
        if (me.defaultHouseholdId != _household) {
          await setHousehold(me.defaultHouseholdId);
        }
        if (me.email != _email) {
          _email = me.email;
          await sp.setString(_kEmail, me.email);
        }
        notifyListeners();
      } catch (_) {
        await clear();
      }
    }
  }

  Future<void> login(String email, String password) async {
    final pair = await _client.login(email.trim(), password);
    await update(pair);
    _email = email.trim();
    final sp = await SharedPreferences.getInstance();
    await sp.setString(_kEmail, _email!);
    // Pull /me to learn the household id.
    final me = await _client.getMe();
    _profile = me;
    await setHousehold(me.defaultHouseholdId);
  }

  Future<void> logout() async => clear();

  @override
  Future<void> update(TokenPair pair) async {
    _access = pair.accessToken;
    _refresh = pair.refreshToken;
    final sp = await SharedPreferences.getInstance();
    await sp.setString(_kAccess, pair.accessToken);
    await sp.setString(_kRefresh, pair.refreshToken);
    notifyListeners();
  }

  @override
  Future<void> setHousehold(String householdId) async {
    _household = householdId;
    final sp = await SharedPreferences.getInstance();
    await sp.setString(_kHousehold, householdId);
    notifyListeners();
  }

  @override
  Future<void> clear() async {
    _access = null;
    _refresh = null;
    _household = null;
    _email = null;
    _profile = null;
    final sp = await SharedPreferences.getInstance();
    await sp.remove(_kAccess);
    await sp.remove(_kRefresh);
    await sp.remove(_kHousehold);
    await sp.remove(_kEmail);
    notifyListeners();
  }

  /// Convenience: peek at the access token payload (no signature check) to
  /// surface email / household before /me returns. Currently unused but kept
  /// for future offline-friendly UX.
  Map<String, dynamic>? decodeAccessClaims() {
    final t = _access;
    if (t == null) return null;
    final parts = t.split('.');
    if (parts.length < 2) return null;
    try {
      var s = parts[1].replaceAll('-', '+').replaceAll('_', '/');
      while (s.length % 4 != 0) {
        s += '=';
      }
      return jsonDecode(utf8.decode(base64.decode(s)))
          as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }
}
