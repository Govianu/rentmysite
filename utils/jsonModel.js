const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const APP_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(APP_DIR, process.env.DATA_DIR)
  : path.join(APP_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'app-data.json');
const models = {};
// Never sent to the browser
const USER_SECRETS = [
  'passwordHash', 'linkTokenHash', 'linkTokenExpires', 'linkTokenPurpose', 'linkTokens',
  'emailOtpHash', 'emailOtpExpiresAt', 'emailOtpAttempts',
  'ctaAcceptance', 'ctaAcceptanceLog',   // signature record with IP and device: only through utils/ctaFull.js
  'kyc'   // Aadhaar, PAN and bank details: only through /api/kyc, masked (utils/kyc.js)
];
let data;

function loadData() {
  if (data) return data;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } else {
    data = {};
    persist();
  }
  return data;
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2));
  fs.renameSync(temporaryFile, DATA_FILE);
}

function rowsFor(name) {
  const store = loadData();
  if (!Array.isArray(store[name])) store[name] = [];
  return store[name];
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function getPath(object, key) {
  return key.split('.').reduce((value, part) => value == null ? undefined : value[part], object);
}

function setPath(object, key, value) {
  const parts = key.split('.');
  let current = object;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') current[part] = {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = clone(value);
}

function comparable(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value)) {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  return value;
}

function equal(left, right) {
  if (Array.isArray(left)) return left.some(item => equal(item, right));
  if (left == null || right == null) return left === right;
  return String(left) === String(right);
}

function conditionMatches(value, condition) {
  if (condition instanceof RegExp) return condition.test(String(value || ''));
  if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
    return Object.entries(condition).every(([operator, expected]) => {
      if (operator === '$in') return expected.some(item => equal(value, item));
      if (operator === '$ne') return !equal(value, expected);
      if (operator === '$exists') return (value !== undefined) === Boolean(expected);
      if (operator === '$gte') return comparable(value) >= comparable(expected);
      return false;
    });
  }
  return equal(value, condition);
}

function matches(document, query) {
  return Object.entries(query || {}).every(([key, condition]) => {
    if (key === '$or') return condition.some(clause => matches(document, clause));
    return conditionMatches(getPath(document, key), condition);
  });
}

function mergeDefaults(target, defaults) {
  for (const [key, value] of Object.entries(defaults || {})) {
    if (target[key] === undefined) {
      target[key] = clone(typeof value === 'function' ? value() : value);
    } else if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      mergeDefaults(target[key], value);
    }
  }
}

function project(document, selection) {
  if (!selection) return document;
  const tokens = String(selection).split(/\s+/).filter(Boolean);
  if (!tokens.length) return document;
  // Mongoose semantics: '+field' adds a hidden field to the full document, '-field' excludes it
  if (tokens.every(token => token.startsWith('+'))) return document;
  if (tokens.every(token => token.startsWith('-'))) {
    const output = clone(document);
    for (const token of tokens) {
      const parts = token.slice(1).split('.');
      const parent = parts.length > 1 ? getPath(output, parts.slice(0, -1).join('.')) : output;
      if (parent && typeof parent === 'object') delete parent[parts[parts.length - 1]];
    }
    return output;
  }
  const fields = tokens.map(field => field.replace(/^[+-]/, ''));
  const output = { _id: document._id };
  for (const field of fields) {
    const value = getPath(document, field);
    if (value !== undefined) setPath(output, field, value);
  }
  return output;
}

function toStored(value, root = false) {
  if (!root && value && value.constructor && value.constructor.modelName) return value._id;
  if (Array.isArray(value)) return value.map(item => toStored(item));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toStored(item)]));
  }
  return value;
}

function toPublic(value, omitPassword = false) {
  if (value && value.constructor && value.constructor.modelName) return value.toJSON();
  if (Array.isArray(value)) return value.map(item => toPublic(item));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !(omitPassword && key === 'passwordHash') && key !== '__v')
      .map(([key, item]) => [key, toPublic(item)]));
  }
  return value;
}

function createModel(name, config) {
  class ModelDocument {
    constructor(values) {
      Object.assign(this, clone(values));
    }

    equals(id) {
      return String(this._id) === String(id && id._id ? id._id : id);
    }

    toJSON() {
      const output = Object.fromEntries(Object.entries(this)
        .filter(([key]) => !(name === 'User' && USER_SECRETS.includes(key)) && key !== '__v')
        .map(([key, value]) => [key, toPublic(value)]));
      if (name === 'User') {
        output.vertical = this.role === 'business' ? 'business_network'
          : this.role === 'associate' ? 'associate_network' : 'internal';
      }
      return output;
    }

    async save() {
      const rows = rowsFor(name);
      const values = toStored(this, true);
      const index = rows.findIndex(row => String(row._id) === String(this._id));
      if (!values.createdAt) values.createdAt = new Date().toISOString();
      values.updatedAt = new Date().toISOString();
      validate(values);
      checkUnique(values, index);
      if (index < 0) rows.push(values);
      else rows[index] = values;
      persist();
      Object.assign(this, values);
      return this;
    }

    async populate(field, selection) {
      const relation = config.refs && config.refs[field];
      if (!relation) throw new Error(`Unknown ${name} reference: ${field}`);
      const [modelName, isArray] = relation;
      const Target = models[modelName] || require(path.join(__dirname, '..', 'models', modelName));
      const value = this[field];
      const populateOne = async id => {
        if (id == null) return null;
        const target = await Target.findById(id);
        if (!target) return null;
        const projected = project(target, selection);
        return new Target.Document(projected);
      };
      if (isArray) this[field] = await Promise.all((value || []).map(populateOne));
      else this[field] = await populateOne(value);
      return this;
    }
  }

  class Query {
    constructor(kind, query, update, options) {
      this.kind = kind;
      this.filter = query || {};
      this.update = update;
      this.options = options || {};
      this.sortBy = null;
      this.maxResults = null;
      this.selection = null;
      this.populates = [];
    }

    populate(field, selection) {
      this.populates.push([field, selection]);
      return this;
    }

    sort(sortBy) {
      this.sortBy = sortBy;
      return this;
    }

    limit(count) {
      this.maxResults = count;
      return this;
    }

    select(selection) {
      this.selection = selection;
      return this;
    }

    async exec() {
      const rows = rowsFor(name);
      let found = rows.filter(row => matches(row, this.filter));
      if (this.sortBy) {
        const order = Object.entries(this.sortBy);
        found.sort((left, right) => {
          for (const [field, direction] of order) {
            const a = comparable(getPath(left, field));
            const b = comparable(getPath(right, field));
            if (a < b) return -1 * direction;
            if (a > b) return direction;
          }
          return 0;
        });
      }

      if (this.kind === 'update') {
        const row = found[0];
        if (!row) return null;
        const before = clone(row);
        applyUpdate(row, this.update);
        row.updatedAt = new Date().toISOString();
        validate(row);
        persist();
        const document = new ModelDocument(this.options.new ? row : before);
        for (const [field, selection] of this.populates) await document.populate(field, selection);
        return document;
      }

      if (this.maxResults != null) found = found.slice(0, this.maxResults);
      const documents = found.map(row => new ModelDocument(project(clone(row), this.selection)));
      const result = this.kind === 'one' ? (documents[0] || null) : documents;
      const resultDocuments = Array.isArray(result) ? result : result ? [result] : [];
      for (const document of resultDocuments) {
        for (const [field, selection] of this.populates) await document.populate(field, selection);
      }
      return result;
    }

    then(resolve, reject) {
      return this.exec().then(resolve, reject);
    }
  }

  function validate(values) {
    const errors = {};
    for (const field of config.required || []) {
      if (getPath(values, field) == null || getPath(values, field) === '') errors[field] = { message: `${field} is required` };
    }
    for (const [field, allowed] of Object.entries(config.enums || {})) {
      const value = getPath(values, field);
      if (value != null && !allowed.includes(value)) errors[field] = { message: `${field} is invalid` };
    }
    if (Object.keys(errors).length) {
      const error = new Error(Object.values(errors).map(item => item.message).join(', '));
      error.name = 'ValidationError';
      error.errors = errors;
      throw error;
    }
  }

  function checkUnique(values, excludingIndex = -1) {
    for (const field of config.unique || []) {
      const value = getPath(values, field);
      if (value == null || value === '') continue;
      const duplicate = rowsFor(name).some((row, index) =>
        index !== excludingIndex && equal(getPath(row, field), value));
      if (duplicate) {
        const error = new Error(`Duplicate value for ${field}`);
        error.code = 11000;
        throw error;
      }
    }
  }

  function applyUpdate(document, update) {
    if (Object.keys(update || {}).some(key => key.startsWith('$'))) {
      for (const [field, value] of Object.entries(update.$set || {})) setPath(document, field, value);
      for (const [field, value] of Object.entries(update.$push || {})) {
        const current = getPath(document, field);
        setPath(document, field, [...(Array.isArray(current) ? current : []), value]);
      }
      return;
    }
    for (const [field, value] of Object.entries(update || {})) setPath(document, field, value);
  }

  ModelDocument.modelName = name;
  ModelDocument.Document = ModelDocument;
  ModelDocument.find = (query, selection) => new Query('many', query).select(selection);
  ModelDocument.findOne = (query, selection) => new Query('one', query).select(selection);
  ModelDocument.findById = id => new Query('one', { _id: String(id) });
  ModelDocument.findOneAndUpdate = (query, update, options) => new Query('update', query, update, options);
  ModelDocument.findByIdAndUpdate = (id, update, options) => new Query('update', { _id: String(id) }, update, options);
  ModelDocument.exists = async query => rowsFor(name).some(row => matches(row, query)) ? { _id: 'exists' } : null;
  ModelDocument.countDocuments = async query => rowsFor(name).filter(row => matches(row, query)).length;
  ModelDocument.create = async values => {
    const now = new Date().toISOString();
    const document = clone(values || {});
    mergeDefaults(document, config.defaults);
    document._id = document._id || randomUUID();
    document.createdAt = document.createdAt || now;
    document.updatedAt = now;
    const instance = new ModelDocument(document);
    await instance.save();
    return instance;
  };
  ModelDocument.insertMany = async values => Promise.all((values || []).map(item => ModelDocument.create(item)));
  ModelDocument.deleteMany = async query => {
    const rows = rowsFor(name);
    const remaining = rows.filter(row => !matches(row, query));
    const deletedCount = rows.length - remaining.length;
    if (deletedCount) {
      loadData()[name] = remaining;
      persist();
    }
    return { deletedCount };
  };
  ModelDocument.updateOne = async (query, update) => {
    const result = await new Query('update', query, update, { new: true }).exec();
    return { matchedCount: result ? 1 : 0, modifiedCount: result ? 1 : 0 };
  };
  ModelDocument.aggregate = async pipeline => {
    const group = (pipeline || []).find(stage => stage.$group)?.$group;
    if (!group) return [];
    const groups = new Map();
    for (const row of rowsFor(name)) {
      const value = typeof group._id === 'string' && group._id.startsWith('$')
        ? getPath(row, group._id.slice(1)) : group._id;
      const key = JSON.stringify(value);
      if (!groups.has(key)) groups.set(key, { _id: value });
      const output = groups.get(key);
      for (const [field, expression] of Object.entries(group)) {
        if (field !== '_id' && expression && expression.$sum !== undefined) {
          output[field] = (output[field] || 0) + (typeof expression.$sum === 'number' ? expression.$sum : 0);
        }
      }
    }
    return Array.from(groups.values());
  };

  models[name] = ModelDocument;
  return ModelDocument;
}

function initialize() {
  loadData();
}

module.exports = { createModel, initialize, DATA_DIR };
