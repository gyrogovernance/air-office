import type { ElicitationContext, ElicitationFieldValue, ElicitationResult, ElicitationSchemaField } from '@github/copilot-sdk';
import type { UserInputRequestPayload } from '@office/contracts/chat';

type Ask = (input: UserInputRequestPayload) => Promise<{ answer: string; wasFreeform: boolean } | null>;

function parseField(field: ElicitationSchemaField, input: string): ElicitationFieldValue | undefined {
  if (field.type === 'boolean') return input === 'Yes' ? true : input === 'No' ? false : undefined;
  if (field.type === 'number' || field.type === 'integer') {
    const value = Number(input);
    if (!input.trim() || !Number.isFinite(value) || field.type === 'integer' && !Number.isSafeInteger(value) || field.minimum !== undefined && value < field.minimum || field.maximum !== undefined && value > field.maximum) return undefined;
    return value;
  }
  if (field.type === 'array') {
    let value: unknown;
    try { value = JSON.parse(input); } catch { return undefined; }
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string') || field.minItems !== undefined && value.length < field.minItems || field.maxItems !== undefined && value.length > field.maxItems || new Set(value).size !== value.length) return undefined;
    const allowed = 'enum' in field.items ? field.items.enum : field.items.anyOf.map((item) => item.const);
    return value.every((item) => allowed.includes(item)) ? value : undefined;
  }
  if ('enum' in field && !field.enum.includes(input) || 'oneOf' in field && !field.oneOf.some((item) => item.const === input)) return undefined;
  if ('minLength' in field && field.minLength !== undefined && input.length < field.minLength || 'maxLength' in field && field.maxLength !== undefined && input.length > field.maxLength) return undefined;
  if ('format' in field && field.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return undefined;
  if ('format' in field && field.format === 'uri') { try { new URL(input); } catch { return undefined; } }
  if ('format' in field && field.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(input) || Number.isNaN(Date.parse(`${input}T00:00:00Z`)))) return undefined;
  if ('format' in field && field.format === 'date-time' && Number.isNaN(Date.parse(input))) return undefined;
  return input;
}

export async function requestCopilotElicitation(context: ElicitationContext, ask: Ask): Promise<ElicitationResult> {
  if (context.mode === 'url') {
    let url: URL;
    try { url = new URL(context.url ?? ''); } catch { return { action: 'cancel' }; }
    if (url.username || url.password || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return { action: 'cancel' };
    const answer = await ask({ requestId: crypto.randomUUID(), question: context.message, url: url.href, transient: true, choices: ['Allow', 'Decline'], allowFreeform: false });
    return { action: answer?.answer === 'Allow' ? 'accept' : answer ? 'decline' : 'cancel' };
  }
  const schema = context.requestedSchema;
  if (!schema || schema.type !== 'object' || Object.keys(schema.properties).length > 50) return { action: 'cancel' };
  // Field prompts already carry context.message. A Continue/Decline gate before Yes/No
  // (or other fields) only adds an extra click with no extra information.
  const values: Record<string, ElicitationFieldValue> = Object.create(null);
  const entries = Object.entries(schema.properties);
  for (const [name, field] of entries) {
    const required = schema.required?.includes(name) ?? false;
    const choices = field.type === 'boolean' ? ['Yes', 'No'] : field.type === 'string' && 'enum' in field ? field.enum : field.type === 'string' && 'oneOf' in field ? field.oneOf.map((item) => item.const) : undefined;
    const instructions = field.type === 'array' ? `Enter a JSON array of choices: ${('enum' in field.items ? field.items.enum : field.items.anyOf.map((item) => item.const)).join(', ')}.` : '';
    const fieldLabel = field.title ?? name;
    const showFieldLabel = entries.length > 1 || fieldLabel !== context.message;
    let invalid = false;
    for (;;) {
      const question = [
        context.message,
        showFieldLabel ? fieldLabel : '',
        field.description,
        instructions,
        required ? '' : 'Optional: leave blank to skip.',
        invalid ? 'The previous answer did not match the requested format or allowed values.' : ''
      ].filter(Boolean).join('\n\n');
      const answer = await ask({ requestId: crypto.randomUUID(), question, ...(choices ? { choices } : {}), allowFreeform: !choices || !required });
      if (!answer) return { action: 'cancel' };
      if (!required && !answer.answer.trim()) break;
      const value = parseField(field, answer.answer);
      if (value !== undefined) { values[name] = value; break; }
      invalid = true;
    }
  }
  return { action: 'accept', content: values };
}
