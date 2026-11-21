// Pages send PATCH, PUT and DELETE as POST + X-HTTP-Method-Override (public/js/api.js), because Apache on the
// live server blocks those methods with a bare 403 before they reach the API. This turns them back.
module.exports = function methodOverride(req, res, next) {
  const m = String(req.get('X-HTTP-Method-Override') || '').toUpperCase();
  if (req.method === 'POST' && ['PATCH', 'PUT', 'DELETE'].includes(m)) req.method = m;
  next();
};
