import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
function luminance(hex: string) {
  const rgb = hex.match(/[a-f\d]{2}/gi)!.map((v) => {
    const n = parseInt(v, 16) / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
describe('release artifacts and visual isolation', () => {
  it('normal text, chips and action text meet 4.5:1 contrast on their surfaces', () => {
    for (const [fg, bg] of [
      ['#F5F5F7', '#19191D'], // primary text on card
      ['#AAAAB7', '#111113'], // muted text on canvas
      ['#AAAAB7', '#19191D'], // muted text on card
      ['#8A8A9C', '#19191D'], // faint text on card
      ['#8A8A9C', '#111113'], // faint text on canvas
      ['#171017', '#F472B6'], // dark text on pink action
      ['#F472B6', '#23232A'], // pink text on raised surface
      ['#FDA4AF', '#19191D'], // overdue / high priority
      ['#FDA4AF', '#2A1A20'], // blocked chip
      ['#9FDCBF', '#19191D'], // done chip
      ['#F6C76B', '#19191D'], // medium priority chip
      ['#8FC8F5', '#19191D'], // low priority chip
      ['#C4C4CF', '#19191D'], // neutral chip
      ['#FFAFD8', '#31232D'], // active control
      ['#C4A8F5', '#241F2A'], // overlap bar heading
      ['#AAAAB7', '#241F2A'], // overlap bar text
      ['#D9C9DE', '#111113'], // frame label
    ])
      expect(contrast(fg!, bg!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
  it('every emitted CSS rule and animation name is scoped', () => {
    const tree = postcss.parse(readFileSync('styles.css', 'utf8'));
    tree.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && /keyframes/.test((rule.parent as postcss.AtRule).name)) return;
      for (const selector of rule.selectors) expect(selector.trim()).toMatch(/^\.roseboard-[a-z-]+\b/);
    });
    tree.walkAtRules('keyframes', (rule) => expect(rule.params).toMatch(/^rb-/));
  });
  it('ships an installable manifest and local browser bundle', () => {
    const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
    expect(manifest.id).toBe('roseboard');
    expect(manifest.version).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version);
    expect(JSON.parse(readFileSync('versions.json', 'utf8'))[manifest.version]).toBe(manifest.minAppVersion);
    expect(manifest.isDesktopOnly).toBe(false);
    const source = readFileSync('main.js', 'utf8');
    expect(source.length).toBeGreaterThan(10000);
    expect(source).not.toMatch(/require\(["'](?:node:|fs["']|electron["']|child_process["'])/);
    const css = readFileSync('styles.css', 'utf8');
    expect(css).not.toMatch(/@import|url\(["']?https?:/);
  });
  it('publishes the JSON Schema with backward-compatible optional fields', () => {
    const schema = JSON.parse(readFileSync('schema/roseboard-v1.schema.json', 'utf8'));
    const task = schema.properties.tasks.additionalProperties ?? schema.properties.tasks.propertyNames;
    expect(JSON.stringify(schema)).toContain('updatedAt');
    expect(JSON.stringify(schema)).toContain('"color"');
    expect(JSON.stringify(schema)).toContain('"assignee"');
    expect(task).toBeDefined();
  });
});
