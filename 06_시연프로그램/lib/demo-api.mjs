/**
 * Resolve only demo API endpoints. An empty base keeps the local same-origin API.
 * NEXT_PUBLIC_ is intentionally public: it contains a backend address, never a key.
 * @param {string} path
 * @param {string} [base]
 */
export function demoApiUrl(path, base = process.env.NEXT_PUBLIC_DEMO_API_BASE || '') {
  if (!/^\/api\/(?:[a-z][a-z0-9-]*|studio\/(?:state|intake|document))(?:\?[^#\s\\\u0000-\u001f\u007f]*)?$/i.test(path)) {
    throw new Error('올바른 데모 API 경로가 필요합니다.');
  }
  const configured = base.trim();
  if (!configured) return path;

  const url = new URL(configured);
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!/^https?:\/\/[^/?#\\]+\/?$/i.test(configured) || (url.protocol !== 'https:' && !localHttp) || url.username || url.password
    || url.pathname !== '/' || configured.includes('?') || configured.includes('#')) {
    throw new Error('데모 API 주소는 경로·인증정보가 없는 HTTPS 주소여야 합니다.');
  }
  return url.origin + path;
}
