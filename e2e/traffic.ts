// The one assertion every routing test makes: a navigation went through the
// expected server and through no other.

import { expect } from 'bun:test';
import type { Detour } from './detour';
import type { Servers } from './servers';

export type Via = 'direct' | 'http-proxy' | 'auth-proxy' | 'socks' | 'socks-auth';

let sequence = 0;

export async function expectTraffic(
  detour: Detour,
  servers: Servers,
  host: string,
  via: Via,
): Promise<void> {
  sequence += 1;
  // A path no other request uses, so each server's log can be searched for it.
  const path = `/e2e/${via}-${sequence}-${Math.random().toString(16).slice(2)}`;
  const url = `http://${host}:${servers.target.port}${path}`;

  const visited = await detour.visit(url).catch((error: unknown) => {
    throw new Error(`Navigation to ${url} failed.\n${observed(servers, path)}`, { cause: error });
  });
  const actual = visited.body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('via='))
    ?.slice('via='.length);

  if (visited.status !== 200 || actual !== via) {
    throw new Error(
      `Expected via=${via} HTTP 200 for ${url}, got via=${actual ?? 'missing'} HTTP ${visited.status}.\n` +
        `Body: ${visited.body.slice(0, 400)}\n${observed(servers, path)}`,
    );
  }

  // The body says who answered. The request logs say nobody else was asked.
  const hits = {
    direct: saw(servers.target.requests, path),
    'http-proxy': saw(servers.httpProxy.requests, path),
    'auth-proxy': servers.authProxy.requests.some(
      (request) => request.url.includes(path) && request.authorized,
    ),
    socks: saw(servers.socks.requests, path),
    'socks-auth': saw(servers.socksAuth.requests, path),
  } satisfies Record<Via, boolean>;
  for (const [server, hit] of Object.entries(hits)) {
    expect(hit, `${server} for a ${via} request\n${observed(servers, path)}`).toBe(server === via);
  }
}

function saw(requests: { url: string }[], path: string): boolean {
  return requests.some((request) => request.url.includes(path));
}

function observed(servers: Servers, path: string): string {
  const lines: string[] = [];
  for (const [name, server] of [
    ['target', servers.target],
    ['http-proxy', servers.httpProxy],
    ['auth-proxy', servers.authProxy],
    ['socks', servers.socks],
    ['socks-auth', servers.socksAuth],
  ] as const) {
    const hits = server.requests.filter((request) => request.url.includes(path));
    lines.push(
      `${name}: ${
        hits.map((request) => `${request.url} auth=${request.authorized}`).join(' | ') || 'none'
      }`,
    );
  }
  return lines.join('\n');
}
