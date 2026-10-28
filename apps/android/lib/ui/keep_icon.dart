import 'package:flutter/material.dart';

enum KeepGlyph { menu, search, plus, close, pin, trash, restore, bulb, upload, download, bell, calendar, archive, share, check, checks }

// Lucide-style 24px stroked geometry, matching the web UI without an icon font dependency.
class KeepIcon extends StatelessWidget {
  const KeepIcon(this.glyph, {super.key, this.size = 20, this.color = mutedIcon, this.filled = false});
  static const mutedIcon = Color(0xff71717a);
  final KeepGlyph glyph;
  final double size;
  final Color color;
  final bool filled;
  @override
  Widget build(BuildContext context) => SizedBox.square(dimension: size,
    child: CustomPaint(painter: _IconPainter(glyph, color, filled)));
}

class _IconPainter extends CustomPainter {
  _IconPainter(this.glyph, this.color, this.filled);
  final KeepGlyph glyph;
  final Color color;
  final bool filled;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 24);
    final paint = Paint()..color = color..style = PaintingStyle.stroke..strokeWidth = 2..strokeCap = StrokeCap.round..strokeJoin = StrokeJoin.round;
    void lines(List<Offset> points) {
      final path = Path()..moveTo(points[0].dx, points[0].dy);
      for (final point in points.skip(1)) { path.lineTo(point.dx, point.dy); }
      canvas.drawPath(path, paint);
    }
    void line(double x, double y, double x2, double y2) => lines([Offset(x, y), Offset(x2, y2)]);
    void circle(double x, double y, double radius) => canvas.drawCircle(Offset(x, y), radius, paint);
    void rect(double l, double t, double r, double b, [double radius = 1]) =>
        canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTRB(l, t, r, b), Radius.circular(radius)), paint);
    switch (glyph) {
      case KeepGlyph.menu:
        line(4, 6, 20, 6); line(4, 12, 20, 12); line(4, 18, 20, 18);
      case KeepGlyph.search:
        circle(10.5, 10.5, 7.5); line(16, 16, 21, 21);
      case KeepGlyph.plus:
        line(12, 5, 12, 19); line(5, 12, 19, 12);
      case KeepGlyph.close:
        line(6, 6, 18, 18); line(18, 6, 6, 18);
      case KeepGlyph.pin:
        final path = Path()..moveTo(9, 3)..lineTo(15, 3)..lineTo(15, 9)..lineTo(18, 12)..lineTo(18, 15)..lineTo(6, 15)..lineTo(6, 12)..lineTo(9, 9)..close();
        if (filled) canvas.drawPath(path, Paint()..color = color);
        canvas.drawPath(path, paint); line(12, 15, 12, 22);
      case KeepGlyph.trash:
        line(3, 6, 21, 6); line(9, 3, 15, 3);
        lines(const [Offset(5, 6), Offset(6, 21), Offset(18, 21), Offset(19, 6)]);
        line(10, 10, 10, 17); line(14, 10, 14, 17);
      case KeepGlyph.restore:
        canvas.drawArc(const Rect.fromLTRB(4, 4, 20, 20), -2.5, 5.5, false, paint);
        lines(const [Offset(3, 3), Offset(3, 9), Offset(9, 9)]);
      case KeepGlyph.bulb:
        final path = Path()..moveTo(9, 18)..lineTo(9, 16)..cubicTo(1, 10, 6, 3, 12, 3)..cubicTo(18, 3, 23, 10, 15, 16)..lineTo(15, 18)..close();
        canvas.drawPath(path, paint); line(9, 22, 15, 22);
      case KeepGlyph.upload:
        lines(const [Offset(21, 15), Offset(21, 21), Offset(3, 21), Offset(3, 15)]);
        line(12, 3, 12, 15); lines(const [Offset(7, 8), Offset(12, 3), Offset(17, 8)]);
      case KeepGlyph.download:
        lines(const [Offset(21, 15), Offset(21, 21), Offset(3, 21), Offset(3, 15)]);
        line(12, 3, 12, 15); lines(const [Offset(7, 10), Offset(12, 15), Offset(17, 10)]);
      case KeepGlyph.bell:
        final path = Path()..moveTo(18, 8)..cubicTo(18, 0, 6, 0, 6, 8)..lineTo(6, 14)..lineTo(3, 17)..lineTo(21, 17)..lineTo(18, 14)..close();
        canvas.drawPath(path, paint); canvas.drawArc(const Rect.fromLTRB(9, 17, 15, 23), 0.3, 2.5, false, paint);
      case KeepGlyph.calendar:
        rect(3, 5, 21, 21, 2); line(16, 3, 16, 7); line(8, 3, 8, 7); line(3, 11, 21, 11);
      case KeepGlyph.archive:
        rect(3, 3, 21, 7); rect(5, 7, 19, 21); line(10, 12, 14, 12);
      case KeepGlyph.share:
        circle(18, 5, 3); circle(6, 12, 3); circle(18, 19, 3); line(8.6, 10.5, 15.4, 6.5); line(8.6, 13.5, 15.4, 17.5);
      case KeepGlyph.check:
        lines(const [Offset(5, 12), Offset(9, 16), Offset(19, 6)]);
      case KeepGlyph.checks:
        lines(const [Offset(2, 12), Offset(6, 16), Offset(16, 6)]);
        lines(const [Offset(12, 16), Offset(22, 6)]);
    }
  }

  @override
  bool shouldRepaint(_IconPainter oldDelegate) => oldDelegate.glyph != glyph || oldDelegate.color != color || oldDelegate.filled != filled;
}

class IconAction extends StatelessWidget {
  const IconAction({super.key, required this.glyph, required this.label, required this.onPressed, this.color, this.filled = false, this.size = 40, this.tooltip = true});
  final KeepGlyph glyph;
  final String label;
  final VoidCallback? onPressed;
  final Color? color;
  final bool filled;
  final double size;
  /// Note lists omit the Tooltip overlay per button; the label remains for accessibility.
  final bool tooltip;
  @override
  Widget build(BuildContext context) {
    final icon = KeepIcon(glyph, size: size <= 36 ? 16 : 20, color: color ?? KeepIcon.mutedIcon, filled: filled);
    return IconButton(
      tooltip: tooltip ? label : null, onPressed: onPressed,
      constraints: BoxConstraints.tightFor(width: size, height: size),
      padding: const EdgeInsets.all(8),
      icon: tooltip ? icon : Semantics(label: label, child: icon),
    );
  }
}
