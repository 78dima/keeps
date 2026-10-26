import 'dart:ui';
import 'package:flutter/material.dart';

const background = Color(0xfff8f9fa);
const foreground = Color(0xff1c1c1e);
const accent = Color(0xff2563eb);
const muted = Color(0xff71717a);

ThemeData monoTheme() => ThemeData(
  useMaterial3: true,
  brightness: Brightness.light,
  fontFamily: 'DM Sans',
  scaffoldBackgroundColor: background,
  colorScheme: ColorScheme.fromSeed(seedColor: accent, brightness: Brightness.light).copyWith(
    primary: accent, surface: Colors.white, onSurface: foreground,
  ),
  textTheme: const TextTheme(
    bodyMedium: TextStyle(fontSize: 15, color: foreground),
    bodyLarge: TextStyle(fontSize: 16, color: foreground),
  ),
  inputDecorationTheme: const InputDecorationTheme(
    border: InputBorder.none, enabledBorder: InputBorder.none, focusedBorder: InputBorder.none,
    hintStyle: TextStyle(color: Color(0x661c1c1e)),
    contentPadding: EdgeInsets.zero,
  ),
  textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(
    foregroundColor: foreground, shape: const StadiumBorder(),
    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
  )),
  filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(
    foregroundColor: background, backgroundColor: foreground,
    shape: const StadiumBorder(), padding: const EdgeInsets.symmetric(horizontal: 26, vertical: 12),
  )),
  snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
);

const heading = TextStyle(fontFamily: 'Outfit', fontWeight: FontWeight.w700, color: foreground, letterSpacing: -0.4);

Color noteColor(String? hex) => hex != null && RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(hex)
    ? Color(int.parse(hex.substring(1), radix: 16) + 0xff000000) : Colors.white;

String reminderLabel(DateTime value) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final local = value.toLocal();
  return '${months[local.month - 1]} ${local.day}, ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

class Glass extends StatelessWidget {
  const Glass({super.key, required this.child, this.opacity = 0.7});
  final Widget child;
  final double opacity;
  @override
  Widget build(BuildContext context) => ClipRect(child: BackdropFilter(
    filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
    child: ColoredBox(color: Colors.white.withValues(alpha: opacity), child: child),
  ));
}

class Surface extends StatelessWidget {
  const Surface({super.key, required this.child, this.color = Colors.white, this.radius = 32, this.pinned = false});
  final Widget child;
  final Color color;
  final double radius;
  final bool pinned;
  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: color, borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: pinned ? accent.withValues(alpha: 0.1) : Colors.black.withValues(alpha: 0.05), width: pinned ? 2 : 1),
      boxShadow: const [BoxShadow(color: Color(0x08000000), blurRadius: 4, offset: Offset(0, 2))],
    ),
    child: child,
  );
}
