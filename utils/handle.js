const User = require('../models/User');

const slugify = (s, keepUnderscore = false) =>
  (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(keepUnderscore ? /[^a-z0-9_]+/g : /[^a-z0-9]+/g, '')
    .slice(0, 40);

// Builds a unique category.location.name handle, appending 2, 3... on collision
async function uniqueHandle(category, location, name) {
  const base = `${slugify(category, true) || 'general'}.${slugify(location) || 'bengaluru'}.${slugify(name) || 'profile'}`;
  let handle = base;
  let i = 2;
  while (await User.exists({ handle })) handle = `${base}${i++}`;
  return handle;
}

module.exports = { slugify, uniqueHandle };
