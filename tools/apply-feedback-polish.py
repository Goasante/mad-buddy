from pathlib import Path


def edit(path: str, replacements: list[tuple[str, str]]) -> None:
    p = Path(path)
    text = p.read_text()
    for old, new in replacements:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:100]!r}")
        text = text.replace(old, new, 1)
    p.write_text(text)


edit("components/ui/long-press-actions.tsx", [
    (
        'import { haptic } from "@/lib/device/haptics";',
        'import { feedback } from "@/lib/feedback/feedback";'
    ),
    (
        '      haptic("tick");\n      setOpen(true);',
        '      feedback.longPress();\n      setOpen(true);'
    ),
])

edit("components/messaging/message-actions-menu.tsx", [
    (
        'import { haptic } from "@/lib/device/haptics";',
        'import { feedback } from "@/lib/feedback/feedback";'
    ),
    (
        '      haptic("tick");\n      setOpen(true);',
        '      feedback.longPress();\n      setOpen(true);'
    ),
    (
        '''    onSelect: () => {
      haptic("select");
      onAction(action);
    }''',
        '''    onSelect: () => {
      if (isDestructiveMessageAction(action)) feedback.warning();
      else feedback.selection();
      onAction(action);
    }'''
    ),
])

edit("components/app-shell/quick-actions-launcher.tsx", [
    (
        'import { haptic } from "@/lib/device/haptics";\n',
        'import { haptic } from "@/lib/device/haptics";\nimport { feedback } from "@/lib/feedback/feedback";\n'
    ),
    (
        '''    saveQuickActionsPosition({ edge: nextEdge, verticalFraction: fraction });
    haptic("tick");
    setDragging(false);''',
        '''    saveQuickActionsPosition({ edge: nextEdge, verticalFraction: fraction });
    feedback.snap();
    setDragging(false);'''
    ),
])

edit("lib/navigation/contextual-actions.test.ts", [
    (
        '    expect(shared).toContain(\'haptic("tick")\');',
        '    expect(shared).toContain("feedback.longPress()");'
    ),
])

edit("lib/messaging/message-actions.test.ts", [
    (
        '''  it("uses the canonical menu and haptics", () => {
    expect(menu).toContain('from "@/components/ui/app-dropdown"');
    expect(menu).toContain('from "@/lib/device/haptics"');
    expect(menu).not.toContain("navigator.vibrate");
  });''',
        '''  it("uses the canonical menu and semantic feedback", () => {
    expect(menu).toContain('from "@/components/ui/app-dropdown"');
    expect(menu).toContain('from "@/lib/feedback/feedback"');
    expect(menu).toContain("feedback.longPress()");
    expect(menu).toContain("feedback.warning()");
    expect(menu).toContain("feedback.selection()");
    expect(menu).not.toContain("navigator.vibrate");
  });'''
    ),
])

edit("lib/navigation/quick-actions.test.ts", [
    (
        '''  it("snaps to the nearer edge on release", () => {
    expect(component).toContain('nextEdge: QuickActionsEdge');
    expect(component).toContain("settleIntoBounds(nextEdge");
  });''',
        '''  it("snaps to the nearer edge on release with semantic feedback", () => {
    expect(component).toContain('nextEdge: QuickActionsEdge');
    expect(component).toContain("settleIntoBounds(nextEdge");
    expect(component).toContain("feedback.snap()");
  });'''
    ),
])
