/**
 * Hidden text that names a region through `aria-labelledby`. Obsidian shows every `aria-label` as a
 * hover tooltip, which is noise on large containers such as panels, lists and toolbars; buttons and
 * fields keep `aria-label`.
 */
export function Name({ id, children }: { id: string; children: string }) {
  return (
    <span id={id} hidden>
      {children}
    </span>
  );
}
