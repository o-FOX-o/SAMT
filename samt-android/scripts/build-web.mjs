import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = resolve(projectDirectory, 'web');
const outputDirectory = resolve(projectDirectory, 'app/build/generated/samt-web');
const [compatibility, sourceIndex] = await Promise.all([
  readFile(resolve(sourceDirectory, 'runtime-compat.js'), 'utf8'),
  readFile(resolve(sourceDirectory, 'index.html'), 'utf8'),
]);
const moduleScript = '<script type="module" src="./app.js"></script>';
if (sourceIndex.split(moduleScript).length !== 2) {
  throw new Error('Expected one app.js module script in web/index.html.');
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [resolve(sourceDirectory, 'app.js')],
  outfile: resolve(outputDirectory, 'app.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome58',
  charset: 'utf8',
  legalComments: 'none',
  banner: { js: compatibility },
});
await Promise.all([
  copyFile(resolve(sourceDirectory, 'styles.css'), resolve(outputDirectory, 'styles.css')),
  writeFile(resolve(outputDirectory, 'index.html'), sourceIndex.replace(moduleScript, '<script src="./app.js"></script>')),
]);
console.log('Bundled Android interface for Chromium 58+ in app/build/generated/samt-web.');
