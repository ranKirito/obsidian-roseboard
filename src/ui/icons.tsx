import { memo, useLayoutEffect, useRef } from 'react';
import { getIcon } from 'obsidian';
/**
 * Renders one of Obsidian's bundled Lucide icons. Using the host's icon set keeps the plugin
 * visually consistent with the rest of the app and adds nothing to the bundle.
 */
export const Icon = memo(function Icon({ name, className = '' }: { name: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const svg = getIcon(name);
    element.replaceChildren(...(svg ? [svg] : []));
  }, [name]);
  return <span className={`rb-icon${className ? ` ${className}` : ''}`} ref={ref} aria-hidden="true" />;
});
export const statusIcon: Record<string, string> = {
  backlog: 'circle-dashed',
  todo: 'circle',
  doing: 'circle-dot',
  done: 'circle-check',
};
export const statusLabel: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  doing: 'In progress',
  done: 'Done',
};
export const priorityIcon: Record<string, string> = {
  none: '',
  low: 'chevron-down',
  medium: 'equal',
  high: 'chevrons-up',
};
