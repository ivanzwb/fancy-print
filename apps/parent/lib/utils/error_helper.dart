import 'package:flutter/material.dart';

/// Shows a consistent error [SnackBar] on the given [BuildContext].
///
/// Use in catch blocks instead of ad-hoc `showSnackBar` calls:
/// ```dart
/// try { ... } catch (e) {
///   if (context.mounted) showError(context, e);
/// }
/// ```
void showError(BuildContext context, Object error,
    {String? fallbackMessage}) {
  final message = _messageOf(error, fallback: fallbackMessage);
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message),
      behavior: SnackBarBehavior.floating,
      action: SnackBarAction(
        label: '关闭',
        onPressed: () =>
            ScaffoldMessenger.of(context).hideCurrentSnackBar(),
      ),
    ),
  );
}

/// Shows a success [SnackBar].
void showSuccess(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message),
      behavior: SnackBarBehavior.floating,
      backgroundColor: Theme.of(context).colorScheme.primaryContainer,
    ),
  );
}

String _messageOf(Object error, {String? fallback}) {
  // Handle ApiException pattern used across the app
  if (error is ExceptionWithMessage) return error.message;
  final s = error.toString();
  // Remove common noise prefixes
  final cleaned = s
      .replaceFirst('Exception: ', '')
      .replaceFirst('ApiException: ', '')
      .replaceFirst('OidcException: ', '');
  return cleaned;
}

/// Interface duck-typed by [ApiException] and [OidcException].
abstract class ExceptionWithMessage implements Exception {
  String get message;
}
