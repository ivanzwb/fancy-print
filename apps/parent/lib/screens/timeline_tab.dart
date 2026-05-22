import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api/models.dart';
import '../state/auth_controller.dart';

/// 动态时间线：展示已通过审核的 Job（缩略元数据）。doc/5 §4.3、§5.2。
class TimelineTab extends StatefulWidget {
  const TimelineTab({super.key, required this.auth});

  final AuthController auth;

  @override
  State<TimelineTab> createState() => TimelineTabState();
}

class TimelineTabState extends State<TimelineTab> {
  late Future<JobList> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<JobList> _load() => widget.auth.client.listJobs(limit: 30);

  Future<void> refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('动态')),
      body: RefreshIndicator(
        onRefresh: refresh,
        child: FutureBuilder<JobList>(
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
            final items = snap.data?.items ?? const <JobEntry>[];
            if (items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 120),
                  Center(
                    child: Icon(Icons.auto_stories_outlined,
                        size: 56, color: Colors.black26),
                  ),
                  SizedBox(height: 12),
                  Center(child: Text('暂无创作记录')),
                  SizedBox(height: 6),
                  Center(
                    child: Text(
                      '孩子在整机说一句故事提示，就会出现在这里',
                      style: TextStyle(color: Colors.black54),
                    ),
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (_, i) => _JobCard(item: items[i]),
            );
          },
        ),
      ),
    );
  }
}

class _JobCard extends StatelessWidget {
  const _JobCard({required this.item});
  final JobEntry item;

  static const _modeLabels = <String, String>{
    'coloring_quiet_book': '涂色安静本',
    'storytime_quick': '故事时光',
    'animal_card': '动物卡片',
  };

  static const _stateLabels = <String, String>{
    'created': '已生成',
    'pending_approval': '待批准',
    'approved': '已批准',
    'rejected': '已拒绝',
    'printed': '已打印',
    'failed': '失败',
  };

  Color _stateColor(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    switch (item.state) {
      case 'printed':
        return cs.primary;
      case 'pending_approval':
        return Colors.orange;
      case 'rejected':
      case 'failed':
        return cs.error;
      default:
        return cs.outline;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final mode = _modeLabels[item.contentMode] ?? item.contentMode;
    final state = _stateLabels[item.state] ?? item.state;
    final ts = DateFormat('MM-dd HH:mm').format(item.createdAt.toLocal());
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Container(
              width: 56,
              height: 72,
              decoration: BoxDecoration(
                color: theme.colorScheme.primaryContainer
                    .withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(Icons.image_outlined,
                  color: theme.colorScheme.primary),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(mode, style: theme.textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(
                    item.deviceId == null
                        ? '$ts · 任务 ${item.jobId}'
                        : '$ts · ${item.deviceId} · ${item.jobId}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: _stateColor(context).withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      state,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: _stateColor(context),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
