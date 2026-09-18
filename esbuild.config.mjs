import esbuild from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import postcss from 'postcss';
import prefixer from 'postcss-prefix-selector';
const watch = process.argv.includes('--watch');
async function css() {
  const base = (await readFile('node_modules/@xyflow/react/dist/style.css', 'utf8')).replace(
    /\bdashdraw\b/g,
    'rb-flow-dashdraw',
  );
  const scoped = await postcss([prefixer({ prefix: '.roseboard-root' })]).process(base, { from: undefined });
  await writeFile('styles.css', scoped.css + '\n' + (await readFile('src/styles.css', 'utf8')));
}
const context = await esbuild.context({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  outfile: 'main.js',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  legalComments: 'eof',
  plugins: [
    {
      name: 'styles',
      setup(build) {
        build.onEnd(css);
      },
    },
  ],
});
if (watch) await context.watch();
else {
  await context.rebuild();
  await context.dispose();
}
