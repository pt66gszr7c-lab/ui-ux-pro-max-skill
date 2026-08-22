'use strict';

const { ADMIN_PIN, makeToken, isAuthed, json, parseJsonBody } = require('./shared');

/*
 * Routed by netlify.toml via a splat (not a named placeholder, which isn't
 * reliably substituted into the query string on every Netlify plan):
 *   /api/admin/*  -> /.netlify/functions/admin/:splat
 * So the action is read straight from event.path instead of a query param.
 *
 * POST /api/admin/login    body {pin} -> sets a signed httpOnly session cookie
 * POST /api/admin/logout   clears the cookie
 * GET  /api/admin/status   {isAdmin: boolean}
 */
exports.handler = async function (event) {
  const pathMatch = (event.path || '').match(/\/admin\/?([^/]*)$/);
  const action = pathMatch && pathMatch[1] ? pathMatch[1] : undefined;

  if (action === 'login' && event.httpMethod === 'POST') {
    const body = parseJsonBody(event);
    if (body === null || body.pin !== ADMIN_PIN) return json(401, { error: 'wrong pin' });
    const token = makeToken();
    const secure = process.env.CONTEXT ? '; Secure' : ''; // Netlify prod/deploy-preview builds set CONTEXT
    return json(200, { ok: true }, {
      'Set-Cookie': 've_token=' + token + '; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400' + secure
    });
  }

  if (action === 'logout' && event.httpMethod === 'POST') {
    return json(200, { ok: true }, { 'Set-Cookie': 've_token=; HttpOnly; Path=/; Max-Age=0' });
  }

  if (action === 'status' && event.httpMethod === 'GET') {
    return json(200, { isAdmin: isAuthed(event) });
  }

  return json(404, { error: 'not found' });
};
