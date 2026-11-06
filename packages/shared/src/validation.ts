import { z } from 'zod';
import type { EntityDef, FieldDef } from './entities.js';

/** Empty strings from forms become null. */
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

function fieldSchema(f: FieldDef): z.ZodType {
  let s: z.ZodType;
  switch (f.type) {
    case 'text':
    case 'textarea': {
      let t = z.string().trim();
      if (f.maxLength) t = t.max(f.maxLength, `${f.label}: max ${f.maxLength} characters`);
      s = f.upper ? t.transform((v) => v.toUpperCase()) : t;
      break;
    }
    case 'email':
      s = z.string().trim().toLowerCase().pipe(z.email(`${f.label}: invalid email`));
      break;
    case 'integer':
      s = z.coerce.number({ error: `${f.label}: must be a number` }).int(`${f.label}: whole number`);
      break;
    case 'decimal':
      // Kept as string to avoid floating point drift; validated as a finite number.
      s = z
        .union([z.string(), z.number()])
        .transform((v) => String(v).trim())
        .refine((v) => /^-?\d+(\.\d+)?$/.test(v), `${f.label}: must be a number`);
      break;
    case 'boolean':
      s = z.union([z.boolean(), z.enum(['true', 'false'])]).transform((v) => v === true || v === 'true');
      break;
    case 'select':
      s = z.enum(f.options as [string, ...string[]], { error: `${f.label}: choose a valid option` });
      break;
    case 'date':
      s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${f.label}: date must be YYYY-MM-DD`);
      break;
    case 'ref':
    case 'file':
      s = z.uuid(`${f.label}: invalid reference`);
      break;
  }
  if (f.required) {
    return z.preprocess(emptyToNull, s.refine((v) => v !== null && v !== undefined, `${f.label} is required`));
  }
  return z.preprocess(emptyToNull, s.nullable().optional());
}

/** Validation schema for create (full) or update (partial) payloads of a master. */
export function buildEntitySchema(def: EntityDef, mode: 'create' | 'update' = 'create') {
  const shape: Record<string, z.ZodType> = {};
  for (const f of def.fields) {
    shape[f.name] = mode === 'update' ? fieldSchema({ ...f, required: false }).optional() : fieldSchema(f);
    if (mode === 'update' && f.required) {
      // On update a required field may be omitted, but not blanked out.
      shape[f.name] = z.preprocess(emptyToNull, fieldSchema(f)).optional();
    }
  }
  return z.object(shape).strict();
}

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');
