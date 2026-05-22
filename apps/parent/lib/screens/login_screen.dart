import 'package:flutter/material.dart';

import '../api/models.dart';
import '../auth/oidc_service.dart';
import '../state/auth_controller.dart';

/// Email + password login, plus OIDC/SSO entry point.
///
/// See `doc/5. 家长端应用设计.md` §6 for the OIDC flow design.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.auth, this.oidc});

  final AuthController auth;

  /// When provided, renders an "SSO 登录" button.
  final OidcAuthService? oidc;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailCtrl = TextEditingController(text: 'demo@fancy-print.local');
  final _passCtrl = TextEditingController(text: 'dev');
  final _formKey = GlobalKey<FormState>();
  bool _submitting = false;
  bool _oidcLoading = false;
  String? _error;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.auth.login(_emailCtrl.text, _passCtrl.text);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = '登录失败：$e');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _oidcLogin() async {
    final oidc = widget.oidc;
    if (oidc == null) return;
    setState(() {
      _oidcLoading = true;
      _error = null;
    });
    try {
      await oidc.login();
      // On success, the auth controller state change will navigate away.
    } on OidcException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = 'SSO 登录失败：$e');
    } finally {
      if (mounted) setState(() => _oidcLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 8),
                    Icon(Icons.local_printshop,
                        size: 56, color: theme.colorScheme.primary),
                    const SizedBox(height: 16),
                    Text(
                      '奇想印印 · 家长端',
                      style: theme.textTheme.headlineSmall,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '陪伴孩子的创作，安心可控',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 32),
                    TextFormField(
                      controller: _emailCtrl,
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                      decoration: const InputDecoration(
                        labelText: '邮箱',
                        prefixIcon: Icon(Icons.mail_outline),
                      ),
                      validator: (v) => (v == null || v.trim().isEmpty)
                          ? '请输入邮箱'
                          : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _passCtrl,
                      obscureText: true,
                      decoration: const InputDecoration(
                        labelText: '密码',
                        prefixIcon: Icon(Icons.lock_outline),
                      ),
                      validator: (v) =>
                          (v == null || v.isEmpty) ? '请输入密码' : null,
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Text(
                        _error!,
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                    ],
                    const SizedBox(height: 24),
                    FilledButton(
                      onPressed: _submitting ? null : _submit,
                      child: _submitting
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.4,
                                color: Colors.white,
                              ),
                            )
                          : const Text('登录'),
                    ),
                    if (widget.oidc != null) ...[
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: _oidcLoading ? null : _oidcLogin,
                        icon: _oidcLoading
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.4,
                                ),
                              )
                            : const Icon(Icons.login),
                        label: const Text('SSO 登录'),
                      ),
                    ],
                    const SizedBox(height: 12),
                    Text(
                      '开发环境默认密码为 PARENT_DEV_PASSWORD（缺省 dev）',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
