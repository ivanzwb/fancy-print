import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api/models.dart';
import '../state/auth_controller.dart';
import 'bind_device_screen.dart';

/// 设备列表 + 绑定 / 解绑入口。对应 doc/5 §4.2、§5.2「首页 · 设备总览」。
class DevicesTab extends StatefulWidget {
  const DevicesTab({super.key, required this.auth});

  final AuthController auth;

  @override
  State<DevicesTab> createState() => DevicesTabState();
}

class DevicesTabState extends State<DevicesTab> {
  late Future<List<HouseholdDevice>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<HouseholdDevice>> _load() => widget.auth.client.listDevices();

  Future<void> refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  Future<void> _bind() async {
    final added = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => BindDeviceScreen(auth: widget.auth),
      ),
    );
    if (added == true) await refresh();
  }

  Future<void> _confirmUnbind(HouseholdDevice d) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('解绑设备'),
        content: Text(
          '将解绑设备 ${d.deviceId}。整机随后会进入需重新激活状态，且家庭相册仍会保留。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('取消'),
          ),
          FilledButton.tonal(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('确认解绑'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.auth.client.unbindDevice(d.deviceId);
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('解绑失败：${e.message}')),
      );
      return;
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('已解绑')),
    );
    await refresh();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('设备'),
        actions: [
          IconButton(
            tooltip: '添加设备',
            icon: const Icon(Icons.add),
            onPressed: _bind,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: refresh,
        child: FutureBuilder<List<HouseholdDevice>>(
          future: _future,
          builder: (ctx, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const _ListSkeleton();
            }
            if (snap.hasError) {
              return _ErrorState(
                message: '${snap.error}',
                onRetry: refresh,
              );
            }
            final devices = snap.data ?? const <HouseholdDevice>[];
            if (devices.isEmpty) {
              return _EmptyState(onBind: _bind);
            }
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: devices.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (_, i) => _DeviceCard(
                device: devices[i],
                onUnbind: () => _confirmUnbind(devices[i]),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({required this.device, required this.onUnbind});
  final HouseholdDevice device;
  final VoidCallback onUnbind;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dot = Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: device.online ? Colors.green : theme.disabledColor,
      ),
    );
    final lastSeen = device.lastSeen == null
        ? '从未上报'
        : DateFormat('yyyy-MM-dd HH:mm').format(device.lastSeen!.toLocal());
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            CircleAvatar(
              radius: 22,
              backgroundColor:
                  theme.colorScheme.primaryContainer.withValues(alpha: 0.6),
              child: Icon(
                Icons.print_outlined,
                color: theme.colorScheme.primary,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(device.deviceId,
                      style: theme.textTheme.titleMedium,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      dot,
                      const SizedBox(width: 6),
                      Text(device.online ? '在线' : '离线',
                          style: theme.textTheme.bodySmall),
                      const SizedBox(width: 12),
                      Text('最近：$lastSeen',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          )),
                    ],
                  ),
                ],
              ),
            ),
            PopupMenuButton<String>(
              onSelected: (v) {
                if (v == 'unbind') onUnbind();
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'unbind', child: Text('解绑设备')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onBind});
  final VoidCallback onBind;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      // Needed for RefreshIndicator pull-to-refresh on empty list.
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        const SizedBox(height: 96),
        Icon(Icons.devices_other,
            size: 64, color: theme.colorScheme.outline),
        const SizedBox(height: 16),
        Center(
          child: Text('还没有绑定整机',
              style: theme.textTheme.titleMedium),
        ),
        const SizedBox(height: 6),
        Center(
          child: Text('在整机「添加设备」界面获取短码或扫码绑定',
              style: theme.textTheme.bodySmall),
        ),
        const SizedBox(height: 24),
        Center(
          child: FilledButton.icon(
            onPressed: onBind,
            icon: const Icon(Icons.add),
            label: const Text('绑定设备'),
          ),
        ),
      ],
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final Future<void> Function() onRetry;
  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        const SizedBox(height: 96),
        const Center(child: Icon(Icons.error_outline, size: 56)),
        const SizedBox(height: 12),
        Center(child: Text(message)),
        const SizedBox(height: 16),
        Center(
          child: OutlinedButton(onPressed: onRetry, child: const Text('重试')),
        ),
      ],
    );
  }
}

class _ListSkeleton extends StatelessWidget {
  const _ListSkeleton();
  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: 3,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (_, __) => Container(
        height: 72,
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(16),
        ),
      ),
    );
  }
}
