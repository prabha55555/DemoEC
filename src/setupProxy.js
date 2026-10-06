// Development only (Create React App picks this file up automatically; it is never part of a
// production build). Lets the local test stack (tools/devstack) answer /api/* calls from the
// storefront: set DEV_API_PROXY to the API host's URL. With the variable unset this does nothing --
// and does not even load the proxy library, so a normal `npm start` is unaffected.
module.exports = function setupProxy(app) {
  const target = process.env.DEV_API_PROXY;
  if (!target) return;
  const { createProxyMiddleware } = require('http-proxy-middleware');
  // http-proxy-middleware forwards the ORIGINAL url (/api/...), so no rewrite is needed.
  app.use('/api', createProxyMiddleware({ target, changeOrigin: true }));
};
