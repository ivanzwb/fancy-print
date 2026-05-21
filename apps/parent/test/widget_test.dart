import 'package:flutter_test/flutter_test.dart';
import 'package:fancy_print_parent/main.dart';

void main() {
  testWidgets('home shows title', (tester) async {
    await tester.pumpWidget(const FancyPrintParentApp());
    expect(find.text('家长端'), findsOneWidget);
  });
}
