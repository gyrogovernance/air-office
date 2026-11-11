export type JsonSchema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: (string | number | boolean | null)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  description?: string;
};

export type ToolEffect = 'read' | 'mutate';
export type ToolConnectionKind = 'builtin' | 'openapi' | 'mcp';
export type ToolDefinition = {
  id: string;
  connectionId: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  effect: ToolEffect;
  enabled: boolean;
};
export type LocalMcpConfiguration = {
  catalogId: 'atomic-mail' | 'resend' | 'shopify-dev';
};

export type ToolConnection = {
  id: string;
  name: string;
  kind: ToolConnectionKind;
  endpoint: string | null;
  discoveredAt: string | null;
  enabled: boolean;
  /** A curated local MCP package. Saving or importing this field never installs or starts it. */
  local?: LocalMcpConfiguration;
};

export function isJsonSchema(value: unknown, depth = 0): value is JsonSchema {
  if (depth > 32 || typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const schema = value as Record<string, unknown>;
  const keys = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'description'];
  if (Object.keys(schema).some((key) => !keys.includes(key))) return false;
  if (schema.type !== undefined && !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(String(schema.type))) return false;
  if (schema.description !== undefined && (typeof schema.description !== 'string' || schema.description.length > 2000)) return false;
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') return false;
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== 'string') || new Set(schema.required).size !== schema.required.length)) return false;
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length > 100 || schema.enum.some((item) => !['string', 'number', 'boolean'].includes(typeof item) && item !== null))) return false;
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength']) if (schema[key] !== undefined && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]) || schema[key] < 0)) return false;
  if (schema.properties !== undefined) {
    if (typeof schema.properties !== 'object' || schema.properties === null || Array.isArray(schema.properties)) return false;
    for (const child of Object.values(schema.properties)) if (!isJsonSchema(child, depth + 1)) return false;
  }
  return schema.items === undefined || isJsonSchema(schema.items, depth + 1);
}

/**
 * Softens common LLM argument shapes before schema validation: numeric strings
 * become numbers for integer/number fields, JSON array strings become arrays,
 * empty optional strings are dropped, and undeclared keys are stripped when
 * additionalProperties is false. Field name aliases are not accepted.
 */
export function coerceToolArguments(schema: JsonSchema, value: unknown, depth = 0): unknown {
  if (depth > 32) return value;
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
      const record = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(record)) {
        const child = schema.properties?.[key];
        out[key] = child ? coerceToolArguments(child, item, depth + 1) : item;
      }

      const required = new Set(schema.required ?? []);
      for (const [key, item] of Object.entries(out)) {
        if (required.has(key)) continue;
        if (item === '' || item === null || item === undefined) delete out[key];
      }

      if (schema.additionalProperties === false && schema.properties) {
        for (const key of Object.keys(out)) {
          if (!(key in schema.properties)) delete out[key];
        }
      }
      return out;
    }
    case 'array': {
      let items: unknown = value;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('[')) {
          try {
            const parsed: unknown = JSON.parse(trimmed);
            if (Array.isArray(parsed)) items = parsed;
          } catch {
            return value;
          }
        }
      }
      if (!Array.isArray(items)) return value;
      return items.map((item) => (schema.items ? coerceToolArguments(schema.items, item, depth + 1) : item));
    }
    case 'integer': {
      if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
      if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
        const parsed = Number(value.trim());
        if (Number.isSafeInteger(parsed)) return parsed;
      }
      return value;
    }
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return value;
    }
    default:
      return value;
  }
}

export function validateToolArguments(schema: JsonSchema, value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) return false;
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      if (schema.additionalProperties === false && Object.keys(record).some((key) => !schema.properties || !(key in schema.properties))) return false;
      if (schema.required?.some((key) => !(key in record))) return false;
      return Object.entries(record).every(([key, item]) => !schema.properties || !(key in schema.properties) || validateToolArguments(schema.properties[key]!, item, depth + 1));
    }
    case 'array': return Array.isArray(value) && (schema.items === undefined || value.every((item) => validateToolArguments(schema.items!, item, depth + 1)));
    case 'string': return typeof value === 'string' && (schema.minLength === undefined || value.length >= schema.minLength) && (schema.maxLength === undefined || value.length <= schema.maxLength);
    case 'number': return typeof value === 'number' && Number.isFinite(value) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}
