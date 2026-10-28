import 'dart:math' as math;
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

/// The website uses CSS columns: retain top-to-bottom order and balanced heights.
class BalancedColumns extends MultiChildRenderObjectWidget {
  const BalancedColumns({super.key, required super.children, required this.columns});
  final int columns;
  @override
  RenderObject createRenderObject(BuildContext context) => _Columns(columns);
  @override
  void updateRenderObject(BuildContext context, covariant _Columns renderObject) => renderObject.columns = columns;
}

class _ColumnData extends ContainerBoxParentData<RenderBox> {}

class _Columns extends RenderBox with ContainerRenderObjectMixin<RenderBox, _ColumnData>, RenderBoxContainerDefaultsMixin<RenderBox, _ColumnData> {
  _Columns(this._columns);
  int _columns;
  set columns(int value) { if (value != _columns) { _columns = value; markNeedsLayout(); } }
  @override
  void setupParentData(RenderBox child) { if (child.parentData is! _ColumnData) child.parentData = _ColumnData(); }
  @override
  void performLayout() {
    const gap = 16.0;
    final width = constraints.maxWidth;
    final count = math.max(1, math.min(_columns, childCount));
    final columnWidth = (width - gap * (count - 1)) / count;
    final children = getChildrenAsList();
    var lower = 0.0, upper = 0.0;
    for (final child in children) {
      child.layout(BoxConstraints.tightFor(width: columnWidth), parentUsesSize: true);
      lower = math.max(lower, child.size.height);
      upper += child.size.height + gap;
    }
    bool fits(double target) {
      var columns = 1;
      var height = 0.0;
      for (final child in children) {
        if (height > 0 && height + gap + child.size.height > target) { columns++; height = 0; }
        height += (height > 0 ? gap : 0) + child.size.height;
      }
      return columns <= count;
    }
    for (var i = 0; count > 1 && i < 30 && upper - lower > 0.1; i++) {
      final middle = (lower + upper) / 2;
      if (fits(middle)) { upper = middle; } else { lower = middle; }
    }
    var column = 0, y = 0.0, maxHeight = 0.0;
    for (final child in children) {
      if (y > 0 && y + gap + child.size.height > upper + 0.01 && column < count - 1) { column++; y = 0; }
      if (y > 0) y += gap;
      (child.parentData! as _ColumnData).offset = Offset(column * (columnWidth + gap), y);
      y += child.size.height;
      maxHeight = math.max(maxHeight, y);
    }
    size = constraints.constrain(Size(width, maxHeight));
  }
  @override
  void paint(PaintingContext context, Offset offset) => defaultPaint(context, offset);
  @override
  void applyPaintTransform(RenderBox child, Matrix4 transform) {
    final offset = (child.parentData! as _ColumnData).offset;
    transform.translate(offset.dx, offset.dy);
  }
  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) => defaultHitTestChildren(result, position: position);
}
