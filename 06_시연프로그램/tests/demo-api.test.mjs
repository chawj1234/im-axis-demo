import test from 'node:test';
import assert from 'node:assert/strict';
import {demoApiUrl} from '../lib/demo-api.mjs';

test('Studio nested API paths use the same configured backend without allowing arbitrary nesting', () => {
  for (const endpoint of ['state', 'intake', 'document']) {
    const path = `/api/studio/${endpoint}?session=studio-test`;
    assert.equal(demoApiUrl(path, ''), path);
    assert.equal(demoApiUrl(path, 'https://example.test'), 'https://example.test' + path);
  }
  for (const path of ['/api/studio/../state', '/api/studio/unknown', '/api/other/nested', '/api/studio/state/extra']) {
    assert.throws(() => demoApiUrl(path, ''), /API 경로/);
  }
});

const backend = 'https://demo-backend.example.ts.net';
const path = '/api/document?session=team-demo-01&id=abc&page=2';

test('local mode keeps API fetches and document links on the current origin', () => {
  assert.equal(demoApiUrl('/api/config', ''), '/api/config');
  assert.equal(demoApiUrl(path, ''), path);
});

test('hosted mode sends the same endpoint and query to the configured HTTPS backend', () => {
  assert.equal(demoApiUrl(path, backend), backend + path);
  assert.equal(demoApiUrl('/api/contracts?session=team-demo-01', backend + '/'), backend + '/api/contracts?session=team-demo-01');
  assert.equal(demoApiUrl('/api/reports?session=team-demo-01', '  ' + backend + '  '), backend + '/api/reports?session=team-demo-01');
});

test('public build setting selects the backend without requiring caller changes', () => {
  const previous = process.env.NEXT_PUBLIC_DEMO_API_BASE;
  try {
    process.env.NEXT_PUBLIC_DEMO_API_BASE = backend;
    assert.equal(demoApiUrl('/api/state?session=team-demo-01&role=admin'), backend + '/api/state?session=team-demo-01&role=admin');
    delete process.env.NEXT_PUBLIC_DEMO_API_BASE;
    assert.equal(demoApiUrl('/api/config'), '/api/config');
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_DEMO_API_BASE;
    else process.env.NEXT_PUBLIC_DEMO_API_BASE = previous;
  }
});

test('HTTP is restricted to explicit loopback development addresses', () => {
  for (const base of ['http://localhost:3100', 'http://127.0.0.1:3100', 'http://[::1]:3100']) {
    assert.equal(demoApiUrl('/api/config', base), base + '/api/config');
  }
  assert.throws(() => demoApiUrl('/api/config', 'http://remote.example'));
});

test('backend settings cannot embed credentials, alternate paths, queries or fragments', () => {
  for (const base of [
    'https://user:secret@example.com', 'https://example.com/backend',
    'https://example.com/api/..', 'https://example.com/?token=secret',
    'https://example.com?', 'https://example.com#fragment', 'https://example.com#',
    'https://example.com\\api', 'file:///tmp/demo', '//example.com',
  ]) assert.throws(() => demoApiUrl('/api/config', base), base);
});

test('API paths cannot escape the demo API or override the configured origin', () => {
  for (const invalid of [
    'https://other.example/api/state', '//other.example/api/state', '/banker',
    '/api/../admin', '/api/%2e%2e/admin', '/api/state#fragment',
    '/api/state?session=a\nvalue', '/api/state?session=a\u0000value',
    '/api/state?session=a\\value', '/api/',
  ]) {
    assert.throws(() => demoApiUrl(invalid, backend), invalid);
    assert.throws(() => demoApiUrl(invalid, ''), invalid);
  }
});
