// Static web server for the Docker image (Render). No dependencies.
// config.js is generated from environment variables when the server starts, so the image itself holds no keys and
// can be public on Docker Hub. buildConfig() refuses service_role / secret keys, and the server then refuses to start.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfig } from './write-config.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' };

export function makeHandler({ root, configJs }) {
  const base = normalize(root + sep);
  return async (req, res) => {
    const send = (status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
      res.writeHead(status, { ...HEADERS, 'Content-Type': type, 'Cache-Control': 'no-cache', ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed', undefined, { Allow: 'GET, HEAD' });
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(400, 'bad request'); }
    if (path === '/healthz') return send(200, 'ok');
    if (path === '/config.js') return send(200, configJs, MIME['.js'], { 'Cache-Control': 'no-store' });
    if (path === '/') path = '/index.html';
    // no dotfiles, no tests, and nothing outside web/
    if (path.split('/').some((p) => p.startsWith('.')) || path.startsWith('/tests/')) return send(404, 'not found');
    const file = normalize(join(base, path));
    if (!file.startsWith(base)) return send(404, 'not found');
    try {
      const body = await readFile(file);
      return send(200, body, MIME[extname(file)] || 'application/octet-stream');
    } catch { return send(404, 'not found'); }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let configJs;
  try { configJs = buildConfig(process.env); }
  catch (e) { console.error('config error: ' + e.message); process.exit(1); }
  const root = fileURLToPath(new URL('../web', import.meta.url));
  const port = Number(process.env.PORT) || 10000;   // Render sets PORT
  const server = createServer(makeHandler({ root, configJs })).listen(port, '0.0.0.0', () => console.log(`serving web/ on :${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
