import 'package:flutter/material.dart';

import '../state/auth_controller.dart';

/// 我的：账号、家庭、隐私入口、帮助与登出。doc/5 §4.7、§4.8、§5.2。
class MeTab extends StatelessWidget {
  const MeTab({super.key, required this.auth});

  final AuthController auth;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final profile = auth.profile;
    final email = profile?.email ?? auth.email ?? '未登录';
    final household = profile?.defaultHouseholdId ?? auth.householdId ?? '-';

    return Scaffold(
      appBar: AppBar(title: const Text('我的')),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 16),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 28,
                      backgroundColor:
                          theme.colorScheme.primaryContainer,
                      child: Icon(Icons.person,
                          color: theme.colorScheme.primary),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(email,
                              style: theme.textTheme.titleMedium,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis),
                          const SizedBox(height: 4),
                          Text('家庭：$household',
                              style: theme.textTheme.bodySmall?.copyWith(
                                color:
                                    theme.colorScheme.onSurfaceVariant,
                              )),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          _section(context, '家庭与设备', [
            _tile(context, Icons.home_outlined, '家庭管理',
                subtitle: '邀请共管人 / 移交主账号（即将上线）',
                onTap: () => _comingSoon(context)),
          ]),
          _section(context, '隐私与合规', [
            _tile(context, Icons.privacy_tip_outlined, '隐私政策',
                onTap: () => _staticInfo(context, '隐私政策',
                    '完整隐私政策见 doc/5 §7 与产品上线版本，此处为占位。')),
            _tile(context, Icons.delete_outline, '删除家庭数据',
                onTap: () => _comingSoon(context)),
            _tile(context, Icons.no_accounts, '账号注销',
                onTap: () => _comingSoon(context)),
          ]),
          _section(context, '帮助', [
            _tile(context, Icons.help_outline, '常见问题',
                onTap: () => _staticInfo(context, 'FAQ',
                    '• 整机离线如何排查？\n• 怎么购买 ZINK 纸（非「相纸」心智）？\n• 远程批准超时怎么办？\n（占位文案，正式版会替换。）')),
            _tile(context, Icons.shopping_bag_outlined, '购买 ZINK 纸',
                subtitle: '电商跳转将在正式版接入',
                onTap: () => _comingSoon(context)),
            _tile(context, Icons.support_agent, '联系客服',
                onTap: () => _comingSoon(context)),
          ]),
          const SizedBox(height: 12),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: OutlinedButton.icon(
              onPressed: () => _confirmLogout(context),
              icon: const Icon(Icons.logout),
              label: const Text('退出登录'),
              style: OutlinedButton.styleFrom(
                foregroundColor: theme.colorScheme.error,
                minimumSize: const Size.fromHeight(48),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _section(BuildContext context, String title,
      List<Widget> children) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 8, 4, 8),
            child: Text(title,
                style: theme.textTheme.titleSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                )),
          ),
          Card(
            child: Column(children: children),
          ),
        ],
      ),
    );
  }

  Widget _tile(BuildContext context, IconData icon, String title,
      {String? subtitle, required VoidCallback onTap}) {
    return ListTile(
      leading: Icon(icon),
      title: Text(title),
      subtitle: subtitle == null ? null : Text(subtitle),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    );
  }

  void _comingSoon(BuildContext ctx) {
    ScaffoldMessenger.of(ctx).showSnackBar(
      const SnackBar(content: Text('即将上线')),
    );
  }

  void _staticInfo(BuildContext ctx, String title, String body) {
    showDialog<void>(
      context: ctx,
      builder: (_) => AlertDialog(
        title: Text(title),
        content: SingleChildScrollView(child: Text(body)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('好的'),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmLogout(BuildContext ctx) async {
    final ok = await showDialog<bool>(
      context: ctx,
      builder: (c) => AlertDialog(
        title: const Text('退出登录？'),
        content: const Text('本地的登录态会被清除，重新登录后可继续访问。'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: const Text('取消')),
          FilledButton(
              onPressed: () => Navigator.pop(c, true),
              child: const Text('退出')),
        ],
      ),
    );
    if (ok == true) await auth.logout();
  }
}
