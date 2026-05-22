import 'package:flutter/material.dart';

import '../state/auth_controller.dart';
import 'devices_tab.dart';
import 'home_tab.dart';
import 'me_tab.dart';
import 'policy_tab.dart';
import 'timeline_tab.dart';

/// 一级导航 Tab 容器：首页 / 动态 / 设备 / 策略 / 我的（相册留待路线图）。
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.auth});

  final AuthController auth;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final auth = widget.auth;
    final screens = <Widget>[
      HomeTab(
        auth: auth,
        onGoToDevices: () => setState(() => _index = 2),
        onGoToTimeline: () => setState(() => _index = 1),
        onGoToPolicy: () => setState(() => _index = 3),
      ),
      TimelineTab(auth: auth),
      DevicesTab(auth: auth),
      PolicyTab(auth: auth),
      MeTab(auth: auth),
    ];

    return Scaffold(
      body: IndexedStack(index: _index, children: screens),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: '首页',
          ),
          NavigationDestination(
            icon: Icon(Icons.timeline_outlined),
            selectedIcon: Icon(Icons.timeline),
            label: '动态',
          ),
          NavigationDestination(
            icon: Icon(Icons.devices_outlined),
            selectedIcon: Icon(Icons.devices),
            label: '设备',
          ),
          NavigationDestination(
            icon: Icon(Icons.shield_outlined),
            selectedIcon: Icon(Icons.shield),
            label: '策略',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: '我的',
          ),
        ],
      ),
    );
  }
}
