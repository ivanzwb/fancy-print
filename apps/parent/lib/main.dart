import 'package:flutter/material.dart';

void main() {
  runApp(const FancyPrintParentApp());
}

class FancyPrintParentApp extends StatelessWidget {
  const FancyPrintParentApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '奇想印印',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal),
        useMaterial3: true,
      ),
      home: const HomePage(),
    );
  }
}

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('家长端')),
      body: const Center(child: Text('fancy-print 家长端占位')),
    );
  }
}
