import 'package:flutter/material.dart';

import '../api/models.dart';
import '../state/auth_controller.dart';
import 'approvals_screen.dart';

/// 策略中心：调整档位（A/B/C 选择）+「远程闸门」开关；提交时携带
/// `expected_version` 以触发乐观并发检查。doc/5 §3.3、§4.4。
class PolicyTab extends StatefulWidget {
  const PolicyTab({super.key, required this.auth});

  final AuthController auth;

  @override
  State<PolicyTab> createState() => _PolicyTabState();
}

class _PolicyTabState extends State<PolicyTab> {
  late Future<HouseholdPolicy> _future;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<HouseholdPolicy> _load() => widget.auth.client.getPolicy();

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  Future<void> _saveGate(HouseholdPolicy p, bool value) async {
    setState(() => _saving = true);
    try {
      final next = await widget.auth.client.patchPolicy(
        expectedVersion: p.version,
        remotePrintGate: value,
        tier: p.tier,
      );
      setState(() => _future = Future.value(next));
    } on ApiException catch (e) {
      if (e.code == 'POLICY_VERSION_CONFLICT') {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('策略已被其他设备修改，已刷新')),
        );
        await _refresh();
      } else {
        if (!mounted) return;
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('策略')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<HouseholdPolicy>(
          future: _future,
          builder: (ctx, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  const SizedBox(height: 96),
                  Center(child: Text('加载失败：${snap.error}')),
                ],
              );
            }
            final p = snap.data!;
            return ListView(
              padding: const EdgeInsets.all(16),
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                _tierCard(p, theme),
                const SizedBox(height: 16),
                Card(
                  child: SwitchListTile(
                    value: p.remotePrintGate,
                    onChanged:
                        _saving ? null : (v) => _saveGate(p, v),
                    title: const Text('远程批准闸门'),
                    subtitle: const Text(
                      '开启后，整机生成图像会暂锁打印，等待你在 App 中批准。',
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.task_alt),
                    title: const Text('远程批准列表'),
                    subtitle: const Text('查看 / 处理待批准与历史决定'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => ApprovalsScreen(auth: widget.auth),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: Text(
                    '当前策略版本：v${p.version}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _tierCard(HouseholdPolicy p, ThemeData theme) {
    const tiers = <(String, String, String)>[
      ('A', '机身自主', '孩子看图确认 + 本机家长锁即可打印；App 收摘要。'),
      ('B', '远程闸门', '生成后整机暂锁打印，由 App 端批准 / 拒绝。'),
      ('C', '信任时段', '家长设定时段内等同 A，其余时段等同 B。'),
    ];
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('打印档位', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            ...tiers.map((t) {
              final selected = p.tier == t.$1;
              return RadioListTile<String>(
                value: t.$1,
                groupValue: p.tier,
                onChanged: null, // bff stub 暂不支持 tier 变更
                title: Text('档位 ${t.$1} · ${t.$2}'),
                subtitle: Text(
                  t.$3,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: selected
                        ? theme.colorScheme.onSurface
                        : theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                dense: true,
                contentPadding: EdgeInsets.zero,
              );
            }),
            Padding(
              padding: const EdgeInsets.only(top: 4, bottom: 8),
              child: Text(
                'MVP 仅支持档位 A + 远程闸门开关；其余档位将随版本陆续开放。',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
