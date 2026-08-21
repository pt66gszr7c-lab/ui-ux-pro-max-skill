'use strict';

/*
 * Shared helpers for the VigilEye Netlify Functions.
 *
 * Storage: Netlify Blobs (@netlify/blobs) — a small managed key/value store
 * that Netlify provisions automatically for a deployed site, so the product
 * catalog is real, persistent, shared state (unlike a local JSON file,
 * which would not survive between serverless invocations).
 *
 * Auth: a stateless, HMAC-signed session token instead of an in-memory
 * session set — serverless functions don't share memory between
 * invocations, so "remember who's logged in" has to live in the cookie
 * itself, signed so it can't be forged without ADMIN_SECRET.
 *
 * Set ADMIN_PIN and ADMIN_SECRET as real environment variables in the
 * Netlify dashboard (Site settings -> Environment variables) before this
 * site is anything more than a demo — the fallbacks below are only for
 * convenience while testing locally with `netlify dev`.
 */

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const ADMIN_PIN = process.env.ADMIN_PIN || '2580';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'vigileye-dev-secret-change-me';
const CAM_TYPES = ['dome', 'bullet', 'ptz', 'mini'];
const STORE_NAME = 'vigileye';
const PRODUCTS_KEY = 'products.json';
const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const DEFAULT_PRODUCTS = [
  { id: 1, price: 349, camType: 'dome', badge: { ar: 'الأكثر مبيعاً', en: 'Best Seller' },
    name: { ar: 'VE-Dome 200', en: 'VE-Dome 200' },
    desc: { ar: 'كاميرا قبة داخلية أنيقة بدقة فائقة، مثالية للمنازل والمكاتب.', en: 'An elegant indoor dome camera with ultra-fine detail, perfect for homes and offices.' },
    specs: { resolution: '4MP', night: { ar: '15 متر', en: '15 m' }, connect: 'Wi-Fi / PoE', protection: 'IP20' } },
  { id: 2, price: 459, camType: 'bullet', badge: null,
    name: { ar: 'VE-Bullet X7', en: 'VE-Bullet X7' },
    desc: { ar: 'كاميرا خارجية مقاومة للماء والغبار، مصممة لتحمل كل الظروف الجوية.', en: 'A weatherproof outdoor bullet camera engineered to withstand every condition.' },
    specs: { resolution: '5MP', night: { ar: '30 متر', en: '30 m' }, connect: 'PoE', protection: 'IP66' } },
  { id: 3, price: 1299, camType: 'ptz', badge: { ar: 'احترافي', en: 'Pro' },
    name: { ar: 'VE-PTZ Pro', en: 'VE-PTZ Pro' },
    desc: { ar: 'كاميرا متحركة بزاوية تغطية 360° وتتبع تلقائي للحركة.', en: 'A pan-tilt-zoom camera with full 360° coverage and automatic motion tracking.' },
    specs: { resolution: '8MP', night: { ar: '50 متر', en: '50 m' }, connect: 'Wi-Fi / 4G', protection: 'IP67' } },
  { id: 4, price: 259, camType: 'mini', badge: null,
    name: { ar: 'VE-Mini Cube', en: 'VE-Mini Cube' },
    desc: { ar: 'كاميرا صغيرة الحجم للمنزل الذكي، سهلة التركيب والتشغيل.', en: 'A compact smart-home camera, easy to install and set up in minutes.' },
    specs: { resolution: '2MP', night: { ar: '10 متر', en: '10 m' }, connect: 'Wi-Fi', protection: 'IP20' } },
  { id: 5, price: 599, camType: 'bullet', badge: { ar: 'جديد', en: 'New' },
    name: { ar: 'VE-NightVision Ultra', en: 'VE-NightVision Ultra' },
    desc: { ar: 'رؤية ليلية فائقة الوضوح حتى في الظلام الدامس.', en: 'Ultra-clear night vision performance even in complete darkness.' },
    specs: { resolution: '5MP', night: { ar: '40 متر', en: '40 m' }, connect: 'PoE', protection: 'IP66' } },
  { id: 6, price: 749, camType: 'dome', badge: null,
    name: { ar: 'VE-Solar Guard', en: 'VE-Solar Guard' },
    desc: { ar: 'تعمل بالطاقة الشمسية بالكامل، مثالية للمواقع البعيدة عن الكهرباء.', en: 'Fully solar-powered, ideal for remote sites without power access.' },
    specs: { resolution: '4MP', night: { ar: '20 متر', en: '20 m' }, connect: '4G / Wi-Fi', protection: 'IP66' } },
  { id: 7, price: 399, camType: 'mini', badge: null,
    name: { ar: 'VE-Doorbell Cam', en: 'VE-Doorbell Cam' },
    desc: { ar: 'جرس باب ذكي بكاميرا مدمجة واتصال ثنائي الاتجاه.', en: 'A smart video doorbell with built-in camera and two-way audio.' },
    specs: { resolution: '3MP', night: { ar: '8 أمتار', en: '8 m' }, connect: 'Wi-Fi', protection: 'IP65' } },
  { id: 8, price: 1599, camType: 'ptz', badge: { ar: 'موصى به', en: 'Recommended' },
    name: { ar: 'VE-4K Enterprise', en: 'VE-4K Enterprise' },
    desc: { ar: 'كاميرا احترافية بدقة 4K للمنشآت والمشاريع الكبرى.', en: 'A professional-grade 4K camera built for enterprises and large-scale sites.' },
    specs: { resolution: '4K / 8MP', night: { ar: '60 متر', en: '60 m' }, connect: 'PoE / Fiber', protection: 'IP67' } }
];

function productsStore() {
  return getStore(STORE_NAME);
}

function cloneProducts(arr) {
  return JSON.parse(JSON.stringify(arr));
}

async function readProducts() {
  const data = await productsStore().get(PRODUCTS_KEY, { type: 'json' });
  // Always return a fresh copy — callers mutate this array in place, and
  // handing out DEFAULT_PRODUCTS by reference before the first save would
  // let that mutation leak into the shared in-memory constant itself.
  return Array.isArray(data) && data.length ? data : cloneProducts(DEFAULT_PRODUCTS);
}

async function writeProducts(products) {
  await productsStore().setJSON(PRODUCTS_KEY, products);
}

function sign(payload) {
  return crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('hex');
}

function makeToken() {
  const ts = Date.now().toString();
  return ts + '.' + sign(ts);
}

function verifyToken(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const ts = parts[0];
  const sig = parts[1];
  const expected = sign(ts);
  let sigBuf, expBuf;
  try {
    sigBuf = Buffer.from(sig, 'hex');
    expBuf = Buffer.from(expected, 'hex');
  } catch (e) {
    return false;
  }
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  const age = Date.now() - parseInt(ts, 10);
  return age >= 0 && age < TOKEN_MAX_AGE_MS;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(function (pair) {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function isAuthed(event) {
  const header = (event.headers && (event.headers.cookie || event.headers.Cookie)) || '';
  const cookies = parseCookies(header);
  return verifyToken(cookies.ve_token);
}

function json(statusCode, data, extraHeaders) {
  return {
    statusCode: statusCode,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      extraHeaders || {}
    ),
    body: JSON.stringify(data)
  };
}

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function parseJsonBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch (e) {
    return null;
  }
}

module.exports = {
  ADMIN_PIN: ADMIN_PIN,
  DEFAULT_PRODUCTS: DEFAULT_PRODUCTS,
  readProducts: readProducts,
  writeProducts: writeProducts,
  makeToken: makeToken,
  isAuthed: isAuthed,
  json: json,
  validateAndNormalizeProduct: validateAndNormalizeProduct,
  parseJsonBody: parseJsonBody
};
