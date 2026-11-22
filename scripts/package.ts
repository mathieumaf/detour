// Finish and check the store packages that `wxt zip` wrote to .output/.
// Run through `bun run package`, which builds and zips both browsers first.
//
// Two jobs:
//
//   1. Give every zip entry a real timestamp. WXT's zip writer leaves the
//      MS-DOS date at zero, and Firefox Add-ons rejects such an upload as
//      "Unsupported file type".
//   2. Refuse to hand a store a package that is wrong: a version that does not
//      match package.json, a manifest that points at a missing file, a
//      permission nobody decided to add, or a stray file.
//
// CI runs this on every pull request, so a release never meets these checks
// for the first time.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };
import { hasValidDate, listEntries, readEntries, restamp } from './zip';

type Browser = 'chrome' | 'firefox';

// What each store listing was reviewed with. Changing a permission is a
// product decision: it re-triggers store review and a prompt for every user.
// Update this list together with wxt.config.ts and store/permissions.md.
const PERMISSIONS: Record<Browser, string[]> = {
  chrome: ['proxy', 'storage', 'alarms', 'webRequest', 'webRequestAuthProvider'],
  firefox: ['proxy', 'storage', 'alarms', 'webRequest', 'webRequestBlocking'],
};
const HOST_PERMISSIONS = ['<all_urls>'];

// Never belongs in something we upload.
const FORBIDDEN = [
  /(^|\/)node_modules\//,
  /(^|\/)\.env/,
  /\.map$/,
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.git\//,
];

// The sources zip has to be enough to rebuild the Firefox package.
const REQUIRED_SOURCES = [
  'package.json',
  'bun.lock',
  'tsconfig.json',
  'wxt.config.ts',
  'README.md',
  'LICENSE.md',
  'src/entrypoints/background/index.ts',
  'src/entrypoints/popup/index.html',
  'src/entrypoints/options/index.html',
  'public/icon/128.png',
];

interface Manifest {
  manifest_version: number;
  name: string;
  version: string;
  icons?: Record<string, string>;
  permissions?: string[];
  host_permissions?: string[];
  action?: { default_popup?: string };
  options_ui?: { page?: string };
  background?: { service_worker?: string; scripts?: string[] };
  browser_specific_settings?: {
    gecko?: { id?: string; data_collection_permissions?: { required?: string[] } };
  };
}

const outputDir = path.resolve(import.meta.dirname, '../.output');

function packagePath(kind: Browser | 'sources'): string {
  return path.join(outputDir, `${pkg.name}-${pkg.version}-${kind}.zip`);
}

function fail(file: string, problem: string): never {
  throw new Error(`${path.basename(file)}: ${problem}`);
}

function same(a: string[] | undefined, b: string[]): boolean {
  return JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
}

async function finish(file: string, stamp: Date): Promise<Record<string, Uint8Array>> {
  const original = await readFile(file).catch(() =>
    fail(file, 'not found. `bun run package` builds it.'),
  );
  const fixed = restamp(original, stamp);

  const before = readEntries(original);
  const after = readEntries(fixed);
  const names = Object.keys(before);
  if (names.length === 0) fail(file, 'is empty.');
  if (names.join('\n') !== Object.keys(after).join('\n')) {
    fail(file, 'entries changed while fixing timestamps.');
  }
  for (const name of names) {
    if (Buffer.compare(before[name]!, after[name]!) !== 0) {
      fail(file, `the contents of ${name} changed while fixing timestamps.`);
    }
  }

  const undated = listEntries(fixed).filter((entry) => !hasValidDate(entry));
  if (undated.length > 0) fail(file, `${undated.length} entries still have no valid date.`);

  const stray = names.find((name) => FORBIDDEN.some((pattern) => pattern.test(name)));
  if (stray) fail(file, `contains ${stray}, which must not be published.`);

  await writeFile(file, fixed);
  return after;
}

function checkExtension(file: string, browser: Browser, entries: Record<string, Uint8Array>): void {
  const raw = entries['manifest.json'];
  if (!raw) fail(file, 'has no manifest.json at its root.');
  const manifest = JSON.parse(new TextDecoder().decode(raw)) as Manifest;

  if (manifest.manifest_version !== 3) fail(file, 'is not a Manifest V3 extension.');
  if (manifest.name !== 'Detour') fail(file, `is named "${manifest.name}".`);
  if (manifest.version !== pkg.version) {
    fail(file, `manifest version ${manifest.version} is not package.json's ${pkg.version}.`);
  }

  if (!same(manifest.permissions, PERMISSIONS[browser])) {
    fail(
      file,
      `permissions are [${manifest.permissions?.join(', ')}], expected ` +
        `[${PERMISSIONS[browser].join(', ')}]. If the change is intended, update ` +
        'scripts/package.ts and store/permissions.md with it.',
    );
  }
  if (!same(manifest.host_permissions, HOST_PERMISSIONS)) {
    fail(file, `host permissions are [${manifest.host_permissions?.join(', ')}].`);
  }

  const gecko = manifest.browser_specific_settings?.gecko;
  if (browser === 'firefox') {
    if (gecko?.id !== 'detour@mafille.me') fail(file, 'has lost its Firefox add-on id.');
    if (!same(gecko.data_collection_permissions?.required, ['none'])) {
      fail(file, 'no longer declares that it collects no data.');
    }
  } else if (manifest.browser_specific_settings) {
    fail(file, 'carries Firefox-only settings.');
  }

  const referenced = [
    ...Object.values(manifest.icons ?? {}),
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    manifest.background?.service_worker,
    ...(manifest.background?.scripts ?? []),
  ].filter((name): name is string => typeof name === 'string');
  if (!manifest.background?.service_worker && !manifest.background?.scripts?.length) {
    fail(file, 'declares no background script.');
  }
  for (const name of referenced) {
    if (!entries[name]) fail(file, `the manifest points at ${name}, which is not in the package.`);
  }
}

function checkSources(file: string, entries: Record<string, Uint8Array>): void {
  for (const name of REQUIRED_SOURCES) {
    if (!entries[name]) fail(file, `is missing ${name}, which the build needs.`);
  }
  const leaked = Object.keys(entries).find((name) => name.startsWith('.output/'));
  if (leaked) fail(file, `contains build output (${leaked}).`);
}

function report(file: string, entries: Record<string, Uint8Array>, size: number): void {
  const count = Object.keys(entries).length;
  console.log(`✔ ${path.basename(file)}  ${count} files, ${(size / 1024).toFixed(1)} kB`);
}

async function main(): Promise<void> {
  const stamp = new Date();
  for (const browser of ['chrome', 'firefox'] as const) {
    const file = packagePath(browser);
    const entries = await finish(file, stamp);
    checkExtension(file, browser, entries);
    report(file, entries, (await readFile(file)).length);
  }

  const sources = packagePath('sources');
  const entries = await finish(sources, stamp);
  checkSources(sources, entries);
  report(sources, entries, (await readFile(sources)).length);
}

main().catch((error: unknown) => {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
