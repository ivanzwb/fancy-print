import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api/models.dart';
import '../state/auth_controller.dart';

/// 远程批准（档位 B）。doc/5 §3.3、§4.3。
///
/// 当前 parent-bff stub 只暴露「已决定」的审批记录，无原始 prompt 详情，
/// 因此此页主要承担「查看最近决定」与「触发 approve/reject」两类操作。
class ApprovalsScreen extends StatefulWidget {
  const ApprovalsScreen({super.key, required this.auth});

  final AuthController auth;

  @override
  State<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _ApprovalsScreenState extends State<ApprovalsScreen> {
  late Future<List<ApprovalRecord>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<ApprovalRecord>> _load() =>
      widget.auth.client.listPendingApprovals();

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  Future<void> _decide({required bool approve}) async {
    final jobIdCtrl = TextEditingController();
    final deviceCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(approve ? '批准任务' : '拒绝任务'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: jobIdCtrl,
              decoration: const InputDecoration(labelText: '任务 Job ID'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: deviceCtrl,
              decoration: const InputDecoration(
                labelText: '设备 ID（可选）',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(approve ? '批准' : '拒绝'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final jobId = jobIdCtrl.text.trim();
    if (jobId.isEmpty) return;
    final device =
        deviceCtrl.text.trim().isEmpty ? null : deviceCtrl.text.trim();
    try {
      if (approve) {
        await widget.auth.client.approveJob(jobId, deviceId: device);
      } else {
        await widget.auth.client.rejectJob(jobId, deviceId: device);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('操作失败：${e.message}')),
      );
      return;
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(approve ? '已批准 $jobId' : '已拒绝 $jobId')),
    );
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('远程批准'),
        actions: [
          IconButton(
            tooltip: '批准',
            icon: const Icon(Icons.check),
            onPressed: () => _decide(approve: true),
          ),
          IconButton(
            tooltip: '拒绝',
            icon: const Icon(Icons.close),
            onPressed: () => _decide(approve: false),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<ApprovalRecord>>(
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
            final items = snap.data ?? const <ApprovalRecord>[];
            if (items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 120),
                  Center(
                    child: Icon(Icons.task_alt,
                        size: 56, color: Colors.black26),
                  ),
                  SizedBox(height: 12),
                  Center(child: Text('暂无待处理 / 历史决定')),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _row(context, items[i]),
            );
          },
        ),
      ),
    );
  }

  Widget _row(BuildContext context, ApprovalRecord r) {
    final theme = Theme.of(context);
    final approved = r.status == 'approved';
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: (approved ? Colors.green : theme.colorScheme.error)
              .withValues(alpha: 0.12),
          child: Icon(
            approved ? Icons.check : Icons.close,
            color: approved ? Colors.green : theme.colorScheme.error,
          ),
        ),
        title: Text(r.jobId),
        subtitle: Text(
          '${approved ? '已批准' : '已拒绝'} · '
          '${DateFormat('MM-dd HH:mm').format(r.decidedAt.toLocal())}',
        ),
      ),
    );
  }
}
