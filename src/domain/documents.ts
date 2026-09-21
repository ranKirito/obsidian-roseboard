import { vaultPath } from './model';

/** Resolve explicit Markdown-relative links without permitting traversal outside visible vault files. */
export function documentLink(href: string, sourcePath?: string): string | undefined {
  const hash = href.indexOf('#');
  const fragment = hash < 0 ? '' : href.slice(hash);
  const path = hash < 0 ? href : href.slice(0, hash);
  if (vaultPath.safeParse(path).success) return path + fragment;
  if (!sourcePath || !vaultPath.safeParse(sourcePath).success) return undefined;
  if (!path) return sourcePath + fragment;
  if (!path.startsWith('./') && !path.startsWith('../')) return undefined;
  const parts = sourcePath.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '.') continue;
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  const resolved = parts.join('/');
  return vaultPath.safeParse(resolved).success ? resolved + fragment : undefined;
}
