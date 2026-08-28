/**
 * Mavci Core - a deliberately small JSON Schema validator.
 *
 * Supports exactly the keywords this system's schemas use:
 *   type, enum, const, required, properties, additionalProperties,
 *   items, minItems, uniqueItems, pattern, minLength, maxLength,
 *   minimum, maximum, format (date-time | date), $ref to #/$defs/*
 *
 * Not a general-purpose implementation, and not trying to be. A dependency here
 * would break the zero-dependency guarantee that makes the escape hatch real
 * (ARCHITECTURE section 11), and the schemas are ours to keep within the subset.
 * An unknown keyword is IGNORED rather than silently passing something invalid -
 * validate.yml asserts every schema only uses keywords from this list.
 */

const SUPPORTED = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'description', 'examples', 'default',
  'type', 'enum', 'const', 'required', 'properties', 'additionalProperties',
  'items', 'minItems', 'uniqueItems', 'pattern', 'minLength', 'maxLength',
  'minimum', 'maximum', 'format',
]);

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Keywords a schema author used that this validator does not implement. */
export function unsupportedKeywords(schema, seen = new Set()) {
  const found = new Set();
  (function walk(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(walk); return; }
    for (const [k, v] of Object.entries(node)) {
      if (!SUPPORTED.has(k)) found.add(k);
      if (k === 'properties' || k === '$defs') { Object.values(v ?? {}).forEach(walk); }
      else if (k === 'items') walk(v);
      else if (typeof v === 'object') walk(v);
    }
  })(schema);
  return [...found];
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function typeMatches(value, expected) {
  const actual = typeOf(value);
  const list = Array.isArray(expected) ? expected : [expected];
  return list.some((t) => (t === 'number' ? actual === 'number' || actual === 'integer' : actual === t));
}

function resolve(schema, root) {
  if (schema && schema.$ref) {
    const ref = schema.$ref;
    if (!ref.startsWith('#/$defs/')) throw new Error(`unsupported $ref: ${ref}`);
    const key = ref.slice('#/$defs/'.length);
    const target = root.$defs?.[key];
    if (!target) throw new Error(`$ref not found: ${ref}`);
    return target;
  }
  return schema;
}

/**
 * @returns {string[]} human-readable errors, empty when valid.
 * Every message is prefixed with the JSON path so a gate failure names the field.
 */
export function validate(value, schema, root = schema, pathPrefix = '') {
  const errors = [];
  const s = resolve(schema, root);
  if (!s) return errors;
  const p = pathPrefix || '(root)';

  if (s.type && !typeMatches(value, s.type)) {
    errors.push(`${p}: expected ${Array.isArray(s.type) ? s.type.join('|') : s.type}, got ${typeOf(value)}`);
    return errors; // further checks would be noise
  }

  if (s.const !== undefined && value !== s.const) {
    errors.push(`${p}: must equal ${JSON.stringify(s.const)}`);
  }

  if (s.enum && !s.enum.includes(value)) {
    errors.push(`${p}: ${JSON.stringify(value)} is not one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }

  const t = typeOf(value);

  if (t === 'string') {
    if (s.minLength !== undefined && value.length < s.minLength) {
      errors.push(`${p}: shorter than minLength ${s.minLength} (got ${value.length})`);
    }
    if (s.maxLength !== undefined && value.length > s.maxLength) {
      errors.push(`${p}: longer than maxLength ${s.maxLength}`);
    }
    if (s.pattern && !new RegExp(s.pattern).test(value)) {
      errors.push(`${p}: does not match pattern ${s.pattern}`);
    }
    if (s.format === 'date-time' && !DATE_TIME.test(value)) {
      errors.push(`${p}: not an ISO-8601 UTC timestamp ending in Z (got ${JSON.stringify(value)})`);
    }
    if (s.format === 'date' && !DATE.test(value)) {
      errors.push(`${p}: not a YYYY-MM-DD date`);
    }
  }

  if (t === 'number' || t === 'integer') {
    if (s.minimum !== undefined && value < s.minimum) errors.push(`${p}: below minimum ${s.minimum}`);
    if (s.maximum !== undefined && value > s.maximum) errors.push(`${p}: above maximum ${s.maximum}`);
  }

  if (t === 'array') {
    if (s.minItems !== undefined && value.length < s.minItems) {
      errors.push(`${p}: needs at least ${s.minItems} item(s)`);
    }
    if (s.uniqueItems) {
      const seen = new Set(value.map((v) => JSON.stringify(v)));
      if (seen.size !== value.length) errors.push(`${p}: items must be unique`);
    }
    if (s.items) {
      value.forEach((item, i) => errors.push(...validate(item, s.items, root, `${p}[${i}]`)));
    }
  }

  if (t === 'object') {
    for (const key of s.required ?? []) {
      if (!(key in value)) errors.push(`${p}: missing required property "${key}"`);
    }
    const props = s.properties ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in value) errors.push(...validate(value[key], sub, root, pathPrefix ? `${pathPrefix}.${key}` : key));
    }
    if (s.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) errors.push(`${p}: unexpected property "${key}"`);
      }
    }
  }

  return errors;
}

/** Throw with every error at once - fixing one field at a time is miserable. */
export function assertValid(value, schema, label) {
  const errors = validate(value, schema);
  if (errors.length) {
    throw new Error(`${label} failed schema validation:\n  - ${errors.join('\n  - ')}`);
  }
}
