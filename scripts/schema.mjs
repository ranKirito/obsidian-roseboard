import { build } from 'esbuild';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'roseboard-schema-'));
try {
  await build({
    stdin: {
      contents:
        "import {z} from 'zod'; import {boardSchema} from './src/domain/model'; export default z.toJSONSchema(boardSchema, {target:'draft-2020-12',io:'input'});",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(dir, 'schema.mjs'),
  });
  const { default: schema } = await import(join(dir, 'schema.mjs'));
  schema.$id = 'https://roseboard.local/schema/v1.json';
  schema.title = 'Roseboard v1';
  delete schema.properties.timeZone.default;
  schema.properties.timeZone.description =
    'IANA timezone; when absent defaults to the current device timezone, then is stored explicitly on the next edit.';
  schema.$comment =
    'Runtime validation additionally enforces real calendar dates, IANA time zones, safe vault paths, reserved IDs, references, unique placements, checklist IDs, frame depth, and an acyclic dependency graph.';
  await writeFile('schema/roseboard-v1.schema.json', JSON.stringify(schema, null, 2) + '\n');
} finally {
  await rm(dir, { recursive: true, force: true });
}
