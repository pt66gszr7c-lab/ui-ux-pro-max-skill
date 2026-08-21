'use strict';

const {
  DEFAULT_PRODUCTS,
  readProducts,
  writeProducts,
  isAuthed,
  json,
  validateAndNormalizeProduct,
  parseJsonBody
} = require('./shared');

/*
 * Routed by netlify.toml:
 *   /api/products         -> here, no ?id
 *   /api/products/:id     -> here, ?id=:id  (also handles the special id "reset")
 *
 * GET    /api/products          list (public)
 * POST   /api/products          create (admin)
 * PUT    /api/products/:id      update (admin)
 * DELETE /api/products/:id      delete (admin)
 * POST   /api/products/reset    restore the built-in defaults (admin)
 */
exports.handler = async function (event) {
  const method = event.httpMethod;
  const idParam = event.queryStringParameters && event.queryStringParameters.id;

  if (method === 'GET' && !idParam) {
    return json(200, await readProducts());
  }

  if (method === 'POST' && idParam === 'reset') {
    if (!isAuthed(event)) return json(401, { error: 'unauthorized' });
    await writeProducts(DEFAULT_PRODUCTS);
    return json(200, await readProducts());
  }

  if (method === 'POST' && !idParam) {
    if (!isAuthed(event)) return json(401, { error: 'unauthorized' });
    const body = parseJsonBody(event);
    if (body === null) return json(400, { error: 'bad json' });
    const result = validateAndNormalizeProduct(body);
    if (result.error) return json(400, { error: result.error });

    const products = await readProducts();
    const nextId = products.reduce(function (max, p) { return Math.max(max, p.id); }, 0) + 1;
    const product = Object.assign({ id: nextId }, result.product);
    products.push(product);
    await writeProducts(products);
    return json(201, product);
  }

  if ((method === 'PUT' || method === 'DELETE') && idParam) {
    if (!isAuthed(event)) return json(401, { error: 'unauthorized' });
    const id = parseInt(idParam, 10);
    const products = await readProducts();
    const idx = products.findIndex(function (p) { return p.id === id; });
    if (idx === -1) return json(404, { error: 'not found' });

    if (method === 'DELETE') {
      products.splice(idx, 1);
      await writeProducts(products);
      return json(200, { ok: true });
    }

    const body = parseJsonBody(event);
    if (body === null) return json(400, { error: 'bad json' });
    const result = validateAndNormalizeProduct(body);
    if (result.error) return json(400, { error: result.error });
    products[idx] = Object.assign({ id: id }, result.product);
    await writeProducts(products);
    return json(200, products[idx]);
  }

  return json(404, { error: 'not found' });
};
