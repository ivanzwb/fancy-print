import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api/models.dart';
import '../state/auth_controller.dart';

/// 首页：设备摘要 + 最近动态片段（对应 doc/5 §4.2、§5.1「首页」）。
class HomeTab extends StatefulWidget {
  const HomeTab({
    super.key,
    required this.auth,
    required this.onGoToDevices,
    required this.onGoToTimeline,
    required this.onGoToPolicy,
  });

  final AuthController auth;
  final VoidCallback onGoToDevices;
  final VoidCallback onGoToTimeline;
  final VoidCallback onGoToPolicy;

  @override
  State<HomeTab> createState() => HomeTabState();
}

class HomeTabState extends State<HomeTab> {
  late Future<_HomeSummary> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_HomeSummary> _load() async {
    final c = widget.auth.client;
    final results = await Future.wait([
      c.listDevices(),
      c.listJobs(limit: 5),
      c.getPolicy(),
    ]);
    return _HomeSummary(
      devices: results[0] as List<HouseholdDevice>,
      jobs: (results[1] as JobList).items,
      policy: results[2] as HouseholdPolicy,
    );
  }

  Future<void> refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('奇想印印'),
        actions: [
          IconButton(
            tooltip: '刷新',
            icon: const Icon(Icons.refresh),
            onPressed: refresh,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: refresh,
        child: FutureBuilder<_HomeSummary>(
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
                  const SizedBox(height: 8),
                  Center(
                    child: OutlinedButton(
                      onPressed: refresh,
                      child: const Text('重试'),
                    ),
                  ),
                ],
              );
            }
            final s = snap.data!;
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _greeting(theme),
                const SizedBox(height: 16),
                _devicesSummary(theme, s),
                const SizedBox(height: 16),
                _policySummary(theme, s.policy),
                const SizedBox(height: 16),
                _recentJobs(theme, s.jobs),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _greeting(ThemeData theme) {
    final email = widget.auth.profile?.email ?? widget.auth.email ?? '';
    final name = email.split('@').first;
    final hour = DateTime.now().hour;
    final hi = hour < 6
        ? '夜深了'
        : hour < 12
            ? '早上好'
            : hour < 18
                ? '下午好'
                : '晚上好';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$hi，$name',
              style: theme.textTheme.headlineSmall),
          const SizedBox(height: 4),
          Text(
            '一起守护孩子的小小创造',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }

  Widget _devicesSummary(ThemeData theme, _HomeSummary s) {
    final online = s.devices.where((d) => d.online).length;
    final total = s.devices.length;
    return Card(
      child: InkWell(
        onTap: widget.onGoToDevices,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor: theme.colorScheme.primaryContainer,
                child: Icon(Icons.devices,
                    color: theme.colorScheme.primary),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('设备',
                        style: theme.textTheme.titleMedium),
                    const SizedBox(height: 4),
                    Text(
                      total == 0
                          ? '尚未绑定整机，点击前往「设备」标签添加'
                          : '$online / $total 在线',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }

  Widget _policySummary(ThemeData theme, HouseholdPolicy p) {
    return Card(
      child: InkWell(
        onTap: widget.onGoToPolicy,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor: theme.colorScheme.secondaryContainer,
                child: Icon(Icons.shield_outlined,
                    color: theme.colorScheme.secondary),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('当前策略',
                        style: theme.textTheme.titleMedium),
                    const SizedBox(height: 4),
                    Text(
                      '档位 ${p.tier} · 远程闸门'
                      '${p.remotePrintGate ? "开启" : "关闭"} · v${p.version}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }

  Widget _recentJobs(ThemeData theme, List<JobEntry> jobs) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('最近创作', style: theme.textTheme.titleMedium),
                const Spacer(),
                TextButton(
                  onPressed: widget.onGoToTimeline,
                  child: const Text('全部'),
                ),
              ],
            ),
            if (jobs.isEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(0, 4, 8, 16),
                child: Text('暂无创作记录',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    )),
              )
            else
              ...jobs.take(5).map((j) => Padding(
                    padding:
                        const EdgeInsets.symmetric(vertical: 4, horizontal: 0),
                    child: Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: theme.colorScheme.primary
                                .withValues(alpha: 0.6),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            j.contentMode,
                            style: theme.textTheme.bodyMedium,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        Text(
                          DateFormat('MM-dd HH:mm')
                              .format(j.createdAt.toLocal()),
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(width: 8),
                      ],
                    ),
                  )),
          ],
        ),
      ),
    );
  }
}

class _HomeSummary {
  _HomeSummary({
    required this.devices,
    required this.jobs,
    required this.policy,
  });
  final List<HouseholdDevice> devices;
  final List<JobEntry> jobs;
  final HouseholdPolicy policy;
}
