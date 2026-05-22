import 'package:flutter/material.dart';

import '../api/models.dart';
import '../state/auth_controller.dart';
import 'qr_scanner_screen.dart';

/// 绑定设备：输入 6 位短码或扫描设备二维码。doc/5 §3.2。
class BindDeviceScreen extends StatefulWidget {
  const BindDeviceScreen({super.key, required this.auth});

  final AuthController auth;

  @override
  State<BindDeviceScreen> createState() => _BindDeviceScreenState();
}

class _BindDeviceScreenState extends State<BindDeviceScreen> {
  final _codeCtrl = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _codeCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final code = _codeCtrl.text.trim();
      await widget.auth.client.bindDevice(code);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('绑定设备')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Icon(Icons.qr_code_2,
                            color: theme.colorScheme.primary, size: 36),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            '在整机「添加设备」界面获取 6 位短码，'
                            '或扫描设备二维码。',
                            style: theme.textTheme.bodyMedium,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                TextFormField(
                  controller: _codeCtrl,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.headlineSmall?.copyWith(
                    letterSpacing: 8,
                  ),
                  decoration: const InputDecoration(
                    labelText: '设备短码',
                    hintText: 'ABC123',
                  ),
                  textCapitalization: TextCapitalization.characters,
                  maxLength: 16,
                  validator: (v) {
                    final t = v?.trim() ?? '';
                    if (t.length < 4) return '请输入至少 4 个字符';
                    return null;
                  },
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(_error!,
                      style: TextStyle(color: theme.colorScheme.error)),
                ],
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _submitting
                      ? null
                      : () async {
                          final code = await Navigator.of(context).push<String>(
                            MaterialPageRoute(
                              builder: (_) => const QrScannerScreen(),
                            ),
                          );
                          if (code != null && code.isNotEmpty) {
                            _codeCtrl.text = code;
                            _submit();
                          }
                        },
                  icon: const Icon(Icons.qr_code_scanner),
                  label: const Text('扫码绑定'),
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: _submitting ? null : _submit,
                  icon: _submitting
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.4,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.link),
                  label: const Text('绑定'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
