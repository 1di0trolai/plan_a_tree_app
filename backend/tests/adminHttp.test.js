/** Kiểm thử HTTP quản trị: tài nguyên tĩnh, CSP, cookie, nguồn truy cập, CSRF và giới hạn dữ liệu; không gửi thư thật. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createAdminHandler } from '../adminHttp.js';
import { adminCsrfToken } from '../adminAuth.js';

const token = 'a'.repeat(43), csrfToken = adminCsrfToken(token);
async function fixture(work) {
  const calls = [];
  const service = {
    async login() { return { admin: { id: 'admin', username: 'owner' }, token, csrfToken, expiresAt: new Date(Date.now() + 3600000).toISOString() }; },
    async me(value) { calls.push(['me', value]); return { admin: { id: 'admin', username: 'owner' }, csrfToken }; },
    async publish(value, body) { calls.push(['publish', value, body]); return { recipientCount: 1 }; },
    async listUsers() { return { users: [] }; },
    async history() { return { publications: [] }; },
    async logout() { return { ok: true }; },
    async changePassword() { return { ok: true }; },
  };
  let handler;
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createAdminHandler({ service, origins: [origin, 'https://private.example.ts.net'] });
  function request(path, options) {
    if (!options?.headers?.host) return fetch(`${origin}${path}`, options);
    // Browser fetch intentionally prevents overriding Host; exercise raw HTTP too.
    return new Promise((resolve, reject) => {
      const req = httpRequest(`${origin}${path}`, options, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
      });
      req.on('error', reject); req.end(options.body);
    });
  }
  try { await work({ origin, calls, request }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('admin shell is buildless with CSP and only explicit static assets', async () => fixture(async ({ request }) => {
  const response = await request('/admin');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const html = await response.text();
  assert.match(html, /lang="vi"/);
  assert.match(html, /src="\/admin\/admin.js"/);
  assert.equal((html.match(/src="\/admin\/assets\/pat-logo\.png"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Thiết lập lần đầu/);
  assert.match(html, /<label for="gift-gold">Vàng<\/label>/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.equal((await request('/admin/.env')).status, 401);
}));
test('admin artwork serves only exact shipped PNGs with same-origin security headers', async () => fixture(async ({ request }) => {
  const files = [
    ['pat-logo', 'logo'], ['gold-coin', 'money'],
    ['berry-bites', 'food'], ['rice-bowl', 'food'], ['honey-cake', 'food'],
    ['forest-milk', 'food'], ['ramen-bowl', 'food'], ['star-snack', 'food'],
  ];
  for (const [name, folder] of files) {
    const response = await request(`/admin/assets/${name}.png`);
    assert.equal(response.status, 200, name);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /img-src 'self' data:/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.deepEqual(bytes, await readFile(new URL(`../../mobile/assets/${folder}/${name}.png`, import.meta.url)));
  }
  const headers = { cookie: `pat_admin_local=${token}` };
  for (const path of ['/admin/assets/unknown.png', '/admin/assets/index.ts', '/admin/assets/../../.env']) {
    assert.equal((await request(path, { headers })).status, 404, path);
  }
  assert.equal((await request('/admin/assets/pat-logo.png', { headers: { host: 'evil.example' } })).status, 403);
}));
test('login requires same Origin and sets only HttpOnly SameSite local cookie', async () => fixture(async ({ origin, request }) => {
  const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'password' }) };
  assert.equal((await request('/api/admin/login', options)).status, 403);
  const response = await request('/api/admin/login', { ...options, headers: { ...options.headers, origin } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /pat_admin_local=.+; Path=\/; HttpOnly; SameSite=Strict/);
  assert.equal((await response.json()).token, undefined);
}));
test('HTTPS reverse proxy origin uses __Host Secure cookie without trusting forwarded headers', async () => fixture(async ({ request }) => {
  const response = await request('/api/admin/login', { method: 'POST', headers: { host: 'private.example.ts.net', origin: 'https://private.example.ts.net', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /__Host-pat_admin=/);
  assert.match(response.headers.get('set-cookie'), /; Secure/);
}));
test('missing cookie, wrong Host, wrong Origin and CSRF do not publish mail', async () => fixture(async ({ origin, request, calls }) => {
  const path = '/api/admin/publications';
  const headers = { origin, 'content-type': 'application/json', cookie: `pat_admin_local=${token}`, 'x-csrf-token': csrfToken };
  assert.equal((await request(path, { method: 'POST', headers: { ...headers, host: 'evil.example' }, body: '{}' })).status, 403);
  assert.equal((await request(path, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: '{}' })).status, 403);
  assert.equal((await request(path, { method: 'POST', headers: { ...headers, 'x-csrf-token': 'x'.repeat(43) }, body: '{}' })).status, 403);
  assert.equal((await request(path, { method: 'POST', headers: { origin, 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{}' })).status, 401);
  assert.equal(calls.length, 0);
  const response = await request(path, { method: 'POST', headers, body: '{"title":"Chào"}' });
  assert.equal(response.status, 201);
  assert.equal(calls[0][0], 'publish');
}));
test('admin bodies require JSON, bound size, and reject malformed payloads', async () => fixture(async ({ origin, request }) => {
  const headers = { origin, cookie: `pat_admin_local=${token}`, 'x-csrf-token': csrfToken };
  assert.equal((await request('/api/admin/password', { method: 'POST', headers, body: '{}' })).status, 415);
  assert.equal((await request('/api/admin/password', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '[]' })).status, 400);
  assert.equal((await request('/api/admin/password', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ body: 'a'.repeat(33000) }) })).status, 413);
}));
test('web client never stores bearer credentials or injects content as markup', async () => {
  const source = await readFile(new URL('../admin-web/admin.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|innerHTML|insertAdjacentHTML|document\.write/);
  assert.match(source, /credentials: 'same-origin'/);
  assert.match(source, /textContent/);
});
