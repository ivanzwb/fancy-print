/// Data models matching the parent-bff JSON responses (see
/// contracts/openapi/parent-v1-mvp.yaml and cloud/apps/parent-bff/src).
library;

import '../utils/error_helper.dart';

class TokenPair {
  final String accessToken;
  final String refreshToken;
  final String tokenType;
  final int expiresIn;

  TokenPair({
    required this.accessToken,
    required this.refreshToken,
    this.tokenType = 'Bearer',
    required this.expiresIn,
  });

  factory TokenPair.fromJson(Map<String, dynamic> j) => TokenPair(
        accessToken: j['access_token'] as String,
        refreshToken: j['refresh_token'] as String,
        tokenType: (j['token_type'] as String?) ?? 'Bearer',
        expiresIn: (j['expires_in'] as num).toInt(),
      );
}

class ParentProfile {
  final String parentId;
  final String email;
  final String defaultHouseholdId;

  ParentProfile({
    required this.parentId,
    required this.email,
    required this.defaultHouseholdId,
  });

  factory ParentProfile.fromJson(Map<String, dynamic> j) => ParentProfile(
        parentId: j['parent_id'] as String,
        email: j['email'] as String,
        defaultHouseholdId: j['default_household_id'] as String,
      );
}

class HouseholdDevice {
  final String deviceId;
  final bool online;
  final DateTime? lastSeen;

  HouseholdDevice({
    required this.deviceId,
    required this.online,
    required this.lastSeen,
  });

  factory HouseholdDevice.fromJson(Map<String, dynamic> j) => HouseholdDevice(
        deviceId: j['device_id'] as String,
        online: j['online'] as bool? ?? false,
        lastSeen: (j['last_seen'] is String)
            ? DateTime.tryParse(j['last_seen'] as String)
            : null,
      );
}

class HouseholdPolicy {
  final int version;
  final String tier; // A / B / C
  final bool remotePrintGate;

  HouseholdPolicy({
    required this.version,
    required this.tier,
    required this.remotePrintGate,
  });

  factory HouseholdPolicy.fromJson(Map<String, dynamic> j) => HouseholdPolicy(
        version: (j['version'] as num).toInt(),
        tier: (j['tier'] as String?) ?? 'A',
        remotePrintGate: j['remote_print_gate'] as bool? ?? false,
      );
}

class JobEntry {
  final String jobId;
  final String? deviceId;
  final String contentMode;
  final String state;
  final DateTime createdAt;

  JobEntry({
    required this.jobId,
    required this.deviceId,
    required this.contentMode,
    required this.state,
    required this.createdAt,
  });

  factory JobEntry.fromJson(Map<String, dynamic> j) => JobEntry(
        jobId: j['job_id'] as String,
        deviceId: j['device_id'] as String?,
        contentMode: (j['content_mode'] as String?) ?? 'unknown',
        state: (j['state'] as String?) ?? 'created',
        createdAt:
            DateTime.tryParse((j['created_at'] as String?) ?? '') ??
                DateTime.fromMillisecondsSinceEpoch(0),
      );
}

class JobList {
  final List<JobEntry> items;
  final String? nextCursor;

  JobList({required this.items, required this.nextCursor});

  factory JobList.fromJson(Map<String, dynamic> j) => JobList(
        items: ((j['items'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(JobEntry.fromJson)
            .toList(),
        nextCursor: j['next_cursor'] as String?,
      );
}

class ApprovalRecord {
  final String householdId;
  final String jobId;
  final String status; // approved | rejected
  final DateTime decidedAt;

  ApprovalRecord({
    required this.householdId,
    required this.jobId,
    required this.status,
    required this.decidedAt,
  });

  factory ApprovalRecord.fromJson(Map<String, dynamic> j) => ApprovalRecord(
        householdId: j['household_id'] as String,
        jobId: j['job_id'] as String,
        status: j['status'] as String,
        decidedAt:
            DateTime.tryParse((j['decided_at'] as String?) ?? '') ??
                DateTime.now(),
      );
}

class ApiException implements Exception, ExceptionWithMessage {
  final int statusCode;
  final String code;
  final String message;

  ApiException(this.statusCode, this.code, this.message);

  @override
  String toString() => '[$statusCode $code] $message';
}
