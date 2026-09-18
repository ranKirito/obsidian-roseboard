import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
const paths = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .slice(1);
let text =
  '# Bundled dependency notices\n\nGenerated from the locked production dependency tree. Obsidian itself is supplied by the host application and is not bundled. React Flow attribution is retained.\n';
const seen = new Set();
for (const path of paths.sort()) {
  const pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const files = (await readdir(path)).filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
  text += `\n## ${key}\n\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)}.\n`;
  if (!files.length) throw new Error(`Missing license text for ${key}`);
  for (const name of files)
    text += `\n${name}\n\n\`\`\`text\n${await readFile(join(path, name), 'utf8')}\n\`\`\`\n`;
}
await writeFile('THIRD_PARTY_NOTICES.md', text);
console.log(`Preserved licenses for ${seen.size} production packages.`);
