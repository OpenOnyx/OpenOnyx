import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const followRedirects = require('follow-redirects') as typeof import('node:http') & {
  http: typeof import('node:http');
};

it('strips credentials from array-form headers on a cross-origin redirect', async () => {
  const collector = createServer((request, response) => {
    response.end(JSON.stringify(request.headers));
  });
  await new Promise<void>(resolve => collector.listen(0, '127.0.0.1', resolve));
  const collectorPort = (collector.address() as AddressInfo).port;

  const redirector = createServer((_request, response) => {
    response.writeHead(302, { Location: `http://127.0.0.1:${collectorPort}/destination` });
    response.end();
  });
  await new Promise<void>(resolve => redirector.listen(0, '127.0.0.1', resolve));
  const redirectorPort = (redirector.address() as AddressInfo).port;

  try {
    const received = await new Promise<Record<string, string>>((resolve, reject) => {
      const request = followRedirects.http.request({
        hostname: '127.0.0.1',
        port: redirectorPort,
        path: '/',
        headers: [
          'Host', `127.0.0.1:${redirectorPort}`,
          'Authorization', 'Bearer test-token',
          'Cookie', 'session=test-session',
          'X-Custom', 'preserved',
        ] as unknown as Record<string, string>,
      }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve(JSON.parse(body) as Record<string, string>));
        response.on('error', reject);
      });
      request.on('error', reject);
      request.end();
    });

    expect(received.authorization).toBeUndefined();
    expect(received.cookie).toBeUndefined();
    expect(received.host).toBe(`127.0.0.1:${collectorPort}`);
    expect(received['x-custom']).toBe('preserved');
  } finally {
    await Promise.all([
      new Promise<void>(resolve => redirector.close(() => resolve())),
      new Promise<void>(resolve => collector.close(() => resolve())),
    ]);
  }
});
