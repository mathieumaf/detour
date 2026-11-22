// Loopback servers the browser actually talks to. The proxies do not forward:
// each one answers with its own `via=` line, and the target answers `via=direct`.
// A navigation's body is therefore proof of which path the browser took.
// Everything binds to 127.0.0.1, so the suite never touches the network.

import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

export const AUTH_USERNAME = 'detour';
export const AUTH_PASSWORD = 'e2e-secret';

export interface ObservedRequest {
  url: string;
  authorized: boolean;
}

export interface CountingServer {
  port: number;
  requests: ObservedRequest[];
  close(): Promise<void>;
}

export interface AuthProxyServer extends CountingServer {
  setCredentials(username: string, password: string): void;
}

export interface Servers {
  // What a direct connection reaches.
  target: CountingServer;
  // An open HTTP proxy.
  httpProxy: CountingServer;
  // An HTTP proxy that answers 407 until it gets the right Basic credentials.
  authProxy: AuthProxyServer;
  // An open SOCKS5 proxy.
  socks: CountingServer;
  // A SOCKS5 proxy that requires username / password (RFC 1929).
  socksAuth: CountingServer;
  close(): Promise<void>;
}

export async function startServers(): Promise<Servers> {
  const target = await startTarget();
  const httpProxy = await startHttpProxy({ label: 'http-proxy' });
  const authProxy = await startHttpProxy({
    label: 'auth-proxy',
    username: AUTH_USERNAME,
    password: AUTH_PASSWORD,
  });
  const socks = await startSocksProxy({ label: 'socks' });
  const socksAuth = await startSocksProxy({
    label: 'socks-auth',
    username: AUTH_USERNAME,
    password: AUTH_PASSWORD,
  });
  const servers: Servers = {
    target,
    httpProxy,
    authProxy,
    socks,
    socksAuth,
    close: async () => {
      await Promise.all(
        [target, httpProxy, authProxy, socks, socksAuth].map((server) => server.close()),
      );
    },
  };
  await selfCheck(servers);
  return servers;
}

function startTarget(): Promise<CountingServer> {
  const requests: ObservedRequest[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    requests.push({ url, authorized: false });
    writeText(res, 200, `via=direct\nurl=${url}\n`);
  });
  return listenHttp(server, requests);
}

function startHttpProxy(options: {
  label: 'http-proxy' | 'auth-proxy';
  username?: string;
  password?: string;
}): Promise<AuthProxyServer> {
  const requests: ObservedRequest[] = [];
  const creds = {
    username: options.username ?? '',
    password: options.password ?? '',
  };
  const requiresAuth = options.username !== undefined;

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const header = headerValue(req.headers['proxy-authorization']);
    const authorized = requiresAuth && authorizedBasic(header, creds.username, creds.password);
    requests.push({ url, authorized });

    if (requiresAuth && !authorized) {
      writeText(res, 407, 'proxy auth required\n', {
        'Proxy-Authenticate': 'Basic realm="detour-e2e"',
      });
      return;
    }
    writeText(res, 200, `via=${options.label}\nurl=${url}\n`);
  });

  server.on('connect', (req, socket) => {
    requests.push({ url: `CONNECT ${req.url ?? ''}`, authorized: false });
    socket.write('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n');
    socket.end();
  });

  return listenHttp(server, requests).then((listening) => ({
    ...listening,
    setCredentials(username: string, password: string) {
      creds.username = username;
      creds.password = password;
    },
  }));
}

function startSocksProxy(options: {
  label: 'socks' | 'socks-auth';
  username?: string;
  password?: string;
}): Promise<CountingServer> {
  const requests: ObservedRequest[] = [];
  const sockets = new Set<net.Socket>();
  const requiresAuth = options.username !== undefined;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);

    // greeting → (credentials) → CONNECT → the HTTP request the browser sends
    // through the tunnel.
    let stage: 'greeting' | 'credentials' | 'connect' | 'http' = 'greeting';
    let authorized = false;
    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        if (stage === 'greeting') {
          if (buffer.length < 2) return;
          const count = buffer[1] ?? 0;
          if (buffer.length < 2 + count) return;
          const offered = [...buffer.subarray(2, 2 + count)];
          buffer = buffer.subarray(2 + count);
          if (!requiresAuth) {
            socket.write(Buffer.from([0x05, 0x00]));
            stage = 'connect';
            continue;
          }
          if (!offered.includes(0x02)) {
            // The client did not offer username / password: refuse.
            requests.push({ url: 'SOCKS no credentials offered', authorized: false });
            socket.end(Buffer.from([0x05, 0xff]));
            return;
          }
          socket.write(Buffer.from([0x05, 0x02]));
          stage = 'credentials';
          continue;
        }

        if (stage === 'credentials') {
          if (buffer.length < 2) return;
          const userLength = buffer[1] ?? 0;
          if (buffer.length < 2 + userLength + 1) return;
          const passLength = buffer[2 + userLength] ?? 0;
          const total = 2 + userLength + 1 + passLength;
          if (buffer.length < total) return;
          const username = buffer.subarray(2, 2 + userLength).toString('utf8');
          const password = buffer.subarray(3 + userLength, total).toString('utf8');
          buffer = buffer.subarray(total);
          authorized = username === options.username && password === options.password;
          if (!authorized) {
            requests.push({ url: 'SOCKS wrong credentials', authorized: false });
            socket.end(Buffer.from([0x01, 0x01]));
            return;
          }
          socket.write(Buffer.from([0x01, 0x00]));
          stage = 'connect';
          continue;
        }

        if (stage === 'connect') {
          if (buffer.length < 4) return;
          const atyp = buffer[3];
          let length = 4;
          if (atyp === 0x01) length += 4 + 2;
          else if (atyp === 0x04) length += 16 + 2;
          else if (atyp === 0x03) {
            if (buffer.length < 5) return;
            length += 1 + (buffer[4] ?? 0) + 2;
          } else {
            socket.end();
            return;
          }
          if (buffer.length < length) return;
          buffer = buffer.subarray(length);
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          stage = 'http';
          continue;
        }

        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const head = buffer.subarray(0, headerEnd).toString('utf8');
        const requestLine = head.split('\r\n')[0] ?? '';
        const path = requestLine.split(' ')[1] ?? requestLine;
        requests.push({ url: path, authorized });
        const body = Buffer.from(`via=${options.label}\nurl=${path}\n`);
        const headers = Buffer.from(
          'HTTP/1.1 200 OK\r\n' +
            'Content-Type: text/plain; charset=utf-8\r\n' +
            'Cache-Control: no-store\r\n' +
            'Access-Control-Allow-Origin: *\r\n' +
            `Content-Length: ${body.length}\r\n` +
            'Connection: close\r\n\r\n',
        );
        socket.end(Buffer.concat([headers, body]));
        return;
      }
    });
  });

  return listenNet(server, sockets, requests);
}

// Each server is exercised once from Node before any browser starts, so a
// failing test points at the extension and not at the test servers.
async function selfCheck(harness: Servers): Promise<void> {
  const direct = await fetch(`http://127.0.0.1:${harness.target.port}/self-check`);
  const directBody = await direct.text();
  if (!direct.ok || !directBody.startsWith('via=direct')) {
    throw new Error(`target self-check failed: HTTP ${direct.status} ${directBody}`);
  }

  const open = await proxyGet(harness.httpProxy.port, harness.target.port, '/self-proxy');
  if (open.status !== 200 || !open.body.startsWith('via=http-proxy')) {
    throw new Error(`HTTP proxy self-check failed: HTTP ${open.status} ${open.body}`);
  }

  const denied = await proxyGet(harness.authProxy.port, harness.target.port, '/self-auth');
  if (denied.status !== 407) {
    throw new Error(`auth proxy should challenge, got HTTP ${denied.status} ${denied.body}`);
  }
  const token = Buffer.from(`${AUTH_USERNAME}:${AUTH_PASSWORD}`).toString('base64');
  const allowed = await proxyGet(harness.authProxy.port, harness.target.port, '/self-auth-ok', {
    'Proxy-Authorization': `Basic ${token}`,
  });
  if (allowed.status !== 200 || !allowed.body.startsWith('via=auth-proxy')) {
    throw new Error(`auth proxy self-check failed: HTTP ${allowed.status} ${allowed.body}`);
  }

  const socksBody = await socksRoundTrip(harness.socks.port, '/self-socks');
  if (!socksBody.includes('via=socks')) {
    throw new Error(`SOCKS5 self-check failed: ${socksBody}`);
  }

  const socksAuthBody = await socksRoundTrip(harness.socksAuth.port, '/self-socks-auth', {
    username: AUTH_USERNAME,
    password: AUTH_PASSWORD,
  });
  if (!socksAuthBody.includes('via=socks-auth')) {
    throw new Error(`authenticated SOCKS5 self-check failed: ${socksAuthBody}`);
  }
}

function proxyGet(
  proxyPort: number,
  targetPort: number,
  path: string,
  headers: http.OutgoingHttpHeaders = {},
): Promise<{ status: number; body: string }> {
  const origin = `self.detour.test:${targetPort}`;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        method: 'GET',
        path: `http://${origin}${path}`,
        headers: { Host: origin, ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function socksRoundTrip(
  port: number,
  path: string,
  credentials?: { username: string; password: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    // 0 greeting, 1 CONNECT reply, 2 HTTP response, 3 credentials reply.
    let stage = 0;
    let buffer = Buffer.alloc(0);
    const connect = () => {
      stage = 1;
      socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 1, 2, 3, 4, 0, 80]));
    };
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('SOCKS5 self-check timed out'));
    }, 3_000);
    const fail = (error: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };
    socket.on('error', fail);
    socket.on('connect', () => {
      socket.write(Buffer.from([0x05, 0x01, credentials ? 0x02 : 0x00]));
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 0) {
        if (buffer.length < 2) return;
        const method = credentials ? 0x02 : 0x00;
        if (buffer[0] !== 0x05 || buffer[1] !== method) {
          fail(new Error(`SOCKS5 greeting rejected: ${buffer.subarray(0, 2).toString('hex')}`));
          return;
        }
        buffer = buffer.subarray(2);
        if (credentials) {
          stage = 3;
          const username = Buffer.from(credentials.username);
          const password = Buffer.from(credentials.password);
          socket.write(
            Buffer.concat([
              Buffer.from([0x01, username.length]),
              username,
              Buffer.from([password.length]),
              password,
            ]),
          );
        } else {
          connect();
        }
      }
      if (stage === 3) {
        if (buffer.length < 2) return;
        if (buffer[1] !== 0x00) {
          fail(new Error('SOCKS5 credentials rejected'));
          return;
        }
        buffer = buffer.subarray(2);
        connect();
        return;
      }
      if (stage === 1) {
        if (buffer.length < 10) return;
        if (buffer[1] !== 0x00) {
          fail(new Error(`SOCKS5 CONNECT failed with status ${buffer[1]}`));
          return;
        }
        buffer = buffer.subarray(10);
        stage = 2;
        socket.write(
          `GET ${path} HTTP/1.1\r\nHost: socks.detour.test\r\nConnection: close\r\n\r\n`,
        );
        return;
      }
      if (stage === 2 && buffer.includes('via=socks')) {
        clearTimeout(timer);
        const text = buffer.toString('utf8');
        socket.end();
        resolve(text);
      }
    });
  });
}

function writeText(
  res: http.ServerResponse,
  status: number,
  body: string,
  headers: http.OutgoingHttpHeaders = {},
): void {
  const payload = Buffer.from(body);
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': payload.length,
    ...headers,
  });
  res.end(payload);
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function authorizedBasic(header: string, username: string, password: string): boolean {
  const match = /^Basic\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  if (!token) return false;
  return Buffer.from(token, 'base64').toString('utf8') === `${username}:${password}`;
}

function trackSockets(server: net.Server): Set<net.Socket> {
  const sockets = new Set<net.Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
  });
  return sockets;
}

function listenHttp(server: http.Server, requests: ObservedRequest[]): Promise<CountingServer> {
  const sockets = trackSockets(server);
  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  return listenNet(server, sockets, requests);
}

function listenNet(
  server: net.Server,
  sockets: Set<net.Socket>,
  requests: ObservedRequest[],
): Promise<CountingServer> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        reject(new Error('test server did not bind a port'));
        return;
      }
      resolve({
        port: address.port,
        requests,
        close: () => closeServer(server, sockets),
      });
    });
  });
}

function closeServer(server: net.Server, sockets: Set<net.Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING')
        reject(error);
      else resolve();
    });
  });
}
