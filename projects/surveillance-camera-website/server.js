#!/usr/bin/env node
'use strict';

/*
 * HASNET demo server — zero npm dependencies, only Node's built-in modules.
 *
 * Serves the static site from public/ and a small REST API for the product
 * catalog, backed by a JSON file (data/products.json). This is what makes
 * admin edits visible to every visitor hitting this server, not just the
 * browser that made them (unlike the old localStorage-only version).
 *
 * Run:   node server.js        (or: npm start)
 * Then:  http://localhost:3000
 *
 * Change the admin PIN either by editing ADMIN_PIN below, or without
 * touching the code:   ADMIN_PIN=1234 node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '2580';
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const MAX_BODY_BYTES = 1e6; // 1 MB is plenty for a product form

const CAM_TYPES = ['dome', 'bullet', 'ptz', 'mini'];

const DEFAULT_PRODUCTS = [
  { id: 1, price: 125000, camType: 'dome', badge: { ar: 'الأكثر مبيعاً', en: 'Best Seller' },
    name: { ar: 'VE-Dome 200', en: 'VE-Dome 200' },
    desc: { ar: 'كاميرا قبة داخلية أنيقة بدقة فائقة، مثالية للمنازل والمكاتب.', en: 'An elegant indoor dome camera with ultra-fine detail, perfect for homes and offices.' },
    specs: { resolution: '4MP', night: { ar: '15 متر', en: '15 m' }, connect: 'Wi-Fi / PoE', protection: 'IP20' } },
  { id: 2, price: 165000, camType: 'bullet', badge: null,
    name: { ar: 'VE-Bullet X7', en: 'VE-Bullet X7' },
    desc: { ar: 'كاميرا خارجية مقاومة للماء والغبار، مصممة لتحمل كل الظروف الجوية.', en: 'A weatherproof outdoor bullet camera engineered to withstand every condition.' },
    specs: { resolution: '5MP', night: { ar: '30 متر', en: '30 m' }, connect: 'PoE', protection: 'IP66' } },
  { id: 3, price: 465000, camType: 'ptz', badge: { ar: 'احترافي', en: 'Pro' },
    name: { ar: 'VE-PTZ Pro', en: 'VE-PTZ Pro' },
    desc: { ar: 'كاميرا متحركة بزاوية تغطية 360° وتتبع تلقائي للحركة.', en: 'A pan-tilt-zoom camera with full 360° coverage and automatic motion tracking.' },
    specs: { resolution: '8MP', night: { ar: '50 متر', en: '50 m' }, connect: 'Wi-Fi / 4G', protection: 'IP67' } },
  { id: 4, price: 95000, camType: 'mini', badge: null,
    name: { ar: 'VE-Mini Cube', en: 'VE-Mini Cube' },
    desc: { ar: 'كاميرا صغيرة الحجم للمنزل الذكي، سهلة التركيب والتشغيل.', en: 'A compact smart-home camera, easy to install and set up in minutes.' },
    specs: { resolution: '2MP', night: { ar: '10 متر', en: '10 m' }, connect: 'Wi-Fi', protection: 'IP20' } },
  { id: 5, price: 215000, camType: 'bullet', badge: { ar: 'جديد', en: 'New' },
    name: { ar: 'VE-NightVision Ultra', en: 'VE-NightVision Ultra' },
    desc: { ar: 'رؤية ليلية فائقة الوضوح حتى في الظلام الدامس.', en: 'Ultra-clear night vision performance even in complete darkness.' },
    specs: { resolution: '5MP', night: { ar: '40 متر', en: '40 m' }, connect: 'PoE', protection: 'IP66' } },
  { id: 6, price: 270000, camType: 'dome', badge: null,
    name: { ar: 'VE-Solar Guard', en: 'VE-Solar Guard' },
    desc: { ar: 'تعمل بالطاقة الشمسية بالكامل، مثالية للمواقع البعيدة عن الكهرباء.', en: 'Fully solar-powered, ideal for remote sites without power access.' },
    specs: { resolution: '4MP', night: { ar: '20 متر', en: '20 m' }, connect: '4G / Wi-Fi', protection: 'IP66' } },
  { id: 7, price: 145000, camType: 'mini', badge: null,
    name: { ar: 'VE-Doorbell Cam', en: 'VE-Doorbell Cam' },
    desc: { ar: 'جرس باب ذكي بكاميرا مدمجة واتصال ثنائي الاتجاه.', en: 'A smart video doorbell with built-in camera and two-way audio.' },
    specs: { resolution: '3MP', night: { ar: '8 أمتار', en: '8 m' }, connect: 'Wi-Fi', protection: 'IP65' } },
  { id: 8, price: 575000, camType: 'ptz', badge: { ar: 'موصى به', en: 'Recommended' },
    name: { ar: 'VE-4K Enterprise', en: 'VE-4K Enterprise' },
    desc: { ar: 'كاميرا احترافية بدقة 4K للمنشآت والمشاريع الكبرى.', en: 'A professional-grade 4K camera built for enterprises and large-scale sites.' },
    specs: { resolution: '4K / 8MP', night: { ar: '60 متر', en: '60 m' }, connect: 'PoE / Fiber', protection: 'IP67' } }
];

// In-memory session tokens. Fine for a single-process demo server — restarting
// the server signs everyone out, which is an acceptable trade-off here.
const sessions = new Set();

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PRODUCTS_FILE)) {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(DEFAULT_PRODUCTS, null, 2));
  }
}

function readProducts() {
  ensureDataFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : DEFAULT_PRODUCTS;
  } catch (e) {
    return DEFAULT_PRODUCTS;
  }
}

function writeProducts(products) {
  ensureDataFile();
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  header.split(';').forEach(function (pair) {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function isAuthed(req) {
  const cookies = parseCookies(req);
  return !!(cookies.ve_token && sessions.has(cookies.ve_token));
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJSONBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? '/index.html' : pathname;
  const full = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(full, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(full);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function sanitizeText(value, fallback) {
  return typeof value === 'string' ? value.trim() : (fallback || '');
}

function sanitizeBilingual(value) {
  if (!value || typeof value !== 'object') return { ar: '', en: '' };
  return { ar: sanitizeText(value.ar), en: sanitizeText(value.en) };
}

function validateAndNormalizeProduct(body) {
  if (!body || typeof body !== 'object') return { error: 'invalid body' };

  const name = sanitizeBilingual(body.name);
  const desc = sanitizeBilingual(body.desc);
  if (!name.ar || !name.en) return { error: 'name (ar/en) is required' };
  if (!desc.ar || !desc.en) return { error: 'description (ar/en) is required' };

  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0) return { error: 'a valid non-negative price is required' };

  const camType = CAM_TYPES.indexOf(body.camType) !== -1 ? body.camType : 'dome';

  let badge = null;
  if (body.badge && typeof body.badge === 'object') {
    const b = sanitizeBilingual(body.badge);
    if (b.ar || b.en) badge = { ar: b.ar || b.en, en: b.en || b.ar };
  }

  const specsIn = body.specs && typeof body.specs === 'object' ? body.specs : {};
  const specs = {
    resolution: sanitizeText(specsIn.resolution),
    night: sanitizeBilingual(specsIn.night),
    connect: sanitizeText(specsIn.connect),
    protection: sanitizeText(specsIn.protection)
  };

  return { product: { price: Math.round(price), camType: camType, badge: badge, name: name, desc: desc, specs: specs } };
}

const server = http.createServer(function (req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (e) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  const pathname = url.pathname;

  if (pathname === '/api/admin/login' && req.method === 'POST') {
    readJSONBody(req).then(function (body) {
      if (!body || body.pin !== ADMIN_PIN) return sendJSON(res, 401, { error: 'wrong pin' });
      const token = crypto.randomBytes(24).toString('hex');
      sessions.add(token);
      res.setHeader('Set-Cookie', 've_token=' + token + '; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400');
      sendJSON(res, 200, { ok: true });
    }).catch(function () { sendJSON(res, 400, { error: 'bad json' }); });
    return;
  }

  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    const cookies = parseCookies(req);
    if (cookies.ve_token) sessions.delete(cookies.ve_token);
    res.setHeader('Set-Cookie', 've_token=; HttpOnly; Path=/; Max-Age=0');
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/status' && req.method === 'GET') {
    return sendJSON(res, 200, { isAdmin: isAuthed(req) });
  }

  if (pathname === '/api/products' && req.method === 'GET') {
    return sendJSON(res, 200, readProducts());
  }

  if (pathname === '/api/products' && req.method === 'POST') {
    if (!isAuthed(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    readJSONBody(req).then(function (body) {
      const result = validateAndNormalizeProduct(body);
      if (result.error) return sendJSON(res, 400, { error: result.error });
      const products = readProducts();
      const nextId = products.reduce(function (max, p) { return Math.max(max, p.id); }, 0) + 1;
      const product = Object.assign({ id: nextId }, result.product);
      products.push(product);
      writeProducts(products);
      sendJSON(res, 201, product);
    }).catch(function () { sendJSON(res, 400, { error: 'bad json' }); });
    return;
  }

  if (pathname === '/api/products/reset' && req.method === 'POST') {
    if (!isAuthed(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    writeProducts(DEFAULT_PRODUCTS);
    return sendJSON(res, 200, readProducts());
  }

  const idMatch = pathname.match(/^\/api\/products\/(\d+)$/);
  if (idMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
    if (!isAuthed(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const id = parseInt(idMatch[1], 10);
    const products = readProducts();
    const idx = products.findIndex(function (p) { return p.id === id; });
    if (idx === -1) return sendJSON(res, 404, { error: 'not found' });

    if (req.method === 'DELETE') {
      products.splice(idx, 1);
      writeProducts(products);
      return sendJSON(res, 200, { ok: true });
    }

    readJSONBody(req).then(function (body) {
      const result = validateAndNormalizeProduct(body);
      if (result.error) return sendJSON(res, 400, { error: result.error });
      products[idx] = Object.assign({ id: id }, result.product);
      writeProducts(products);
      sendJSON(res, 200, products[idx]);
    }).catch(function () { sendJSON(res, 400, { error: 'bad json' }); });
    return;
  }

  if (pathname.indexOf('/api/') === 0) {
    return sendJSON(res, 404, { error: 'not found' });
  }

  serveStatic(req, res, pathname);
});

ensureDataFile();
server.listen(PORT, function () {
  console.log('HASNET server running at http://localhost:' + PORT);
  console.log('Admin PIN: ' + ADMIN_PIN + ' (override with the ADMIN_PIN env var)');
});
