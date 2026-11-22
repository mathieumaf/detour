// Prove that the sources zip is enough to rebuild the Firefox package.
//
// Firefox Add-ons reviewers get the bundled extension and the sources zip, and
// rebuild one from the other. This does the same: unpack the sources into an
// empty directory, install with the lockfile, build, and compare the result
// with the package we are about to upload, file by file.
//
// Run after `bun run package`. Needs network access for `bun install`.

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };
import { readEntries } from './zip';

const outputDir = path.resolve(import.meta.dirname, '../.output');
const sourcesZip = path.join(outputDir, `${pkg.name}-${pkg.version}-sources.zip`);
const firefoxZip = path.join(outputDir, `${pkg.name}-${pkg.version}-firefox.zip`);

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: 'inherit', stderr: 'inherit' });
  const code = await child.exited;
  if (code !== 0) throw new Error(`\`${command.join(' ')}\` exited with ${code}.`);
}

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      found.push(...(await listFiles(path.join(dir, entry.name), `${name}/`)));
    else found.push(name);
  }
  return found.sort();
}

async function main(): Promise<void> {
  const sources = readEntries(await readFile(sourcesZip));
  const published = readEntries(await readFile(firefoxZip));
  const workdir = await mkdtemp(path.join(tmpdir(), 'detour-sources-'));

  try {
    for (const [name, bytes] of Object.entries(sources)) {
      if (name.endsWith('/')) continue;
      const target = path.join(workdir, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }

    await run(['bun', 'install', '--frozen-lockfile'], workdir);
    await run(['bun', 'run', 'build:firefox'], workdir);

    const rebuiltDir = path.join(workdir, '.output', 'firefox-mv3');
    const rebuilt = await listFiles(rebuiltDir);
    const expected = Object.keys(published)
      .filter((name) => !name.endsWith('/'))
      .sort();

    if (rebuilt.join('\n') !== expected.join('\n')) {
      const missing = expected.filter((name) => !rebuilt.includes(name));
      const extra = rebuilt.filter((name) => !expected.includes(name));
      throw new Error(
        'The rebuild produced a different set of files.\n' +
          `  only in the package: ${missing.join(', ') || 'none'}\n` +
          `  only in the rebuild: ${extra.join(', ') || 'none'}`,
      );
    }
    for (const name of expected) {
      const fresh = await readFile(path.join(rebuiltDir, name));
      if (Buffer.compare(fresh, published[name]!) !== 0) {
        throw new Error(`${name} differs between the package and the rebuild from sources.`);
      }
    }
    console.log(`✔ ${path.basename(sourcesZip)} rebuilds ${path.basename(firefoxZip)} exactly.`);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
