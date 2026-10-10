import * as v from 'valibot';
import { normalizeToE164, phoneIsValid } from '../services/phone-numbers.js';

/**
 * Single validation authority shared by HTTP routes (backend) and Svelte
 * forms (frontend). Every message below is pinned by tests — keep them
 * stable when touching these schemas.
 */

/** Throw a 400 carrying the first schema issue message. */
export function parseField<
  const TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(schema: TSchema, value: unknown): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, value);
  if (!result.success) {
    const flat = v.flatten(result.issues);
    const first =
      Object.values(flat.nested ?? {})
        .flat()
        .find((message): message is string => typeof message === 'string') ??
      flat.root?.find((message): message is string => typeof message === 'string') ??
      'invalid value';
    throw Object.assign(new Error(first), { statusCode: 400 });
  }
  return result.output;
}

/** Validate a whole form object; returns field → first-message pairs. */
export function formErrors(schema: v.GenericSchema, values: unknown): Record<string, string> {
  const result = v.safeParse(schema, values);
  if (result.success) return {};
  const flat = v.flatten(result.issues);
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(flat.nested ?? {})) {
    const first = messages?.find((message): message is string => typeof message === 'string');
    if (first && !(field in out)) out[field] = first;
  }
  const root = flat.root?.find((message): message is string => typeof message === 'string');
  if (root && !('_root' in out)) out._root = root;
  return out;
}

/** Unknown input coerced to string, failing with `message` when absent. */
const text = (message: string) =>
  v.pipe(
    v.unknown(),
    v.transform((value) => (typeof value === 'string' ? value : '')),
    v.minLength(1, message),
  );

export const password = (message = 'password must be 4–200 characters') =>
  v.pipe(text(message), v.maxLength(200, message), v.minLength(4, message));

export const profileName = (field: 'name' | 'simLabel') =>
  v.pipe(
    v.unknown(),
    v.transform((value) => (typeof value === 'string' ? value.trim() : '')),
    v.minLength(1, `${field} is required`),
    v.maxLength(120, `${field} is required`),
  );

/** Trimmed text capped at max (no presence requirement); endpoints add their own. */
export const trimmedText = (max: number, message = 'value is too long') =>
  v.pipe(
    v.unknown(),
    v.transform((value) => (typeof value === 'string' ? value.trim() : '')),
    v.maxLength(max, message),
  );

export const otpCode = (message = 'wrong OTP') =>
  v.pipe(text(message), v.regex(/^\d{6}$/, message));

/** Strict E.164 number parsed under `country`; output is canonical. */
export const phoneE164 = (country: string | undefined, message: string) =>
  v.pipe(
    text(message),
    v.check((value) => phoneIsValid(value, country), message),
    v.transform((value) => normalizeToE164(value, country) ?? ''),
    v.minLength(1, message),
  );

export const recoveryNumber = (country: string | undefined) =>
  phoneE164(country, 'invalid recovery number');

export const smsText = () =>
  v.pipe(
    text('message must contain 1-2000 characters'),
    v.check((value) => [...value].length <= 2000, 'message must contain 1-2000 characters'),
  );

export const messageId = () =>
  v.pipe(text('invalid message id'), v.regex(/^[a-f0-9]{12}$/i, 'invalid message id'));

export const ussdCode = () =>
  v.pipe(text('invalid USSD code'), v.regex(/^\*[\d*#]{1,80}#$/, 'invalid USSD code'));

export const contactName = () =>
  v.pipe(
    v.unknown(),
    v.transform((value) => (typeof value === 'string' ? value.trim() : '')),
    v.minLength(1, 'invalid contact name'),
    v.maxLength(80, 'invalid contact name'),
  );

export const phonebookIndex = () =>
  v.pipe(
    v.unknown(),
    v.check(
      (value) =>
        value === '' ||
        value == null ||
        (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 9999),
      'invalid phonebook index',
    ),
    v.transform((value) => (value === '' || value == null ? '' : Number(value))),
  );

export const phonebookStore = () =>
  v.pipe(
    text('invalid phonebook store'),
    v.regex(/^[A-Za-z0-9_]{1,8}$/, 'invalid phonebook store'),
  );

export const forwardingReason = () =>
  v.pipe(
    v.unknown(),
    v.check(
      (value) => Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 3,
      'invalid forwarding request',
    ),
    v.transform((value) => Number(value)),
  );

export const apnName = () =>
  v.pipe(text('invalid APN'), v.regex(/^[A-Za-z0-9._-]{1,100}$/, 'invalid APN'));

export const atCommand = () =>
  v.pipe(
    v.unknown(),
    v.transform((value) => (typeof value === 'string' ? value.trim().replace(/[\r\n]/g, '') : '')),
    v.check(
      (value) =>
        /^AT(?:\+[A-Z0-9]+(?:\?|=[^;]{0,120})?)?$/i.test(value) &&
        !/^(?:AT(?:D|A|H|T|O|\+CMGS|\+CMSS))/i.test(value),
      'command is not permitted',
    ),
  );

export const dataToggle = () => v.boolean('on must be a boolean');

export const baudRate = () =>
  v.pipe(
    v.unknown(),
    v.check(
      (value) =>
        typeof value === 'number' &&
        Number.isInteger(value) &&
        (value as number) >= 1200 &&
        (value as number) <= 4000000,
      'baud has an invalid type',
    ),
  );

/** Route-level config checks mirror updateConfig exactly; validateConfig owns ranges. */
export const configInt = (key: string) =>
  v.pipe(
    v.unknown(),
    v.check(
      (value) => typeof value === 'number' && Number.isInteger(value),
      `${key} has an invalid type`,
    ),
  );

export const configString = (key: string) =>
  v.pipe(
    v.unknown(),
    v.check((value) => typeof value === 'string', `${key} has an invalid type`),
  );

export const configText = (key: string, max: number) =>
  v.pipe(
    v.unknown(),
    v.check(
      (value) => typeof value === 'string' && value.length <= max,
      `${key} has an invalid type`,
    ),
  );

export const configFlag = (key: string) => v.boolean(`${key} has an invalid type`);

export const lockMinutes = () =>
  v.pipe(
    v.unknown(),
    v.check(
      (value) =>
        typeof value === 'number' &&
        Number.isInteger(value) &&
        (value as number) >= 0 &&
        (value as number) <= 1440,
      'lockMinutes has an invalid type',
    ),
  );

export const sessionMaxMinutes = () =>
  v.pipe(
    v.unknown(),
    v.check(
      (value) =>
        typeof value === 'number' &&
        Number.isInteger(value) &&
        (value as number) >= 0 &&
        (value as number) <= 10080,
      'sessionMaxMinutes has an invalid type',
    ),
  );

/** '' (none) or an ISO 3166-1 alpha-2 code; output is uppercased. */
export function countryCode() {
  return v.pipe(
    v.unknown(),
    v.transform((value) => (typeof value === 'string' ? value.toUpperCase() : '')),
    v.check((value) => value === '' || /^[A-Z]{2}$/.test(value), 'invalid country'),
  );
}

/* ---------- whole-form schemas (frontend + API bodies) ---------- */

export const setupForm = (country?: string) =>
  v.pipe(
    v.object({
      name: v.pipe(
        v.unknown(),
        v.transform((value) => (typeof value === 'string' ? value.trim() : '')),
        v.minLength(1, 'name and simLabel are required'),
        v.maxLength(120, 'name and simLabel are required'),
      ),
      simLabel: v.pipe(
        v.unknown(),
        v.transform((value) => (typeof value === 'string' ? value.trim() : '')),
        v.minLength(1, 'name and simLabel are required'),
        v.maxLength(120, 'name and simLabel are required'),
      ),
      recovery: recoveryNumber(country),
      password: password(),
      confirm: v.string(),
    }),
    v.partialCheck(
      [['password'], ['confirm']],
      (input) => input.password === input.confirm,
      'passwords do not match',
    ),
  );

export const loginForm = () =>
  v.object({
    password: v.pipe(
      v.unknown(),
      v.transform((value) => (typeof value === 'string' ? value : '')),
      v.minLength(4, 'invalid password'),
      v.maxLength(200, 'invalid password'),
    ),
  });

export const ussdForm = () =>
  v.object({
    code: ussdCode(),
  });

export const setupOtpForm = () =>
  v.object({
    otp: v.pipe(
      v.unknown(),
      v.transform((value) => (typeof value === 'string' ? value.trim() : '')),
      v.regex(/^\d{6}$/, 'enter the 6-digit code'),
    ),
  });

export const recoverPhraseForm = () =>
  v.pipe(
    v.object({
      phrase: v.pipe(
        v.unknown(),
        v.transform((value) => (typeof value === 'string' ? value.trim() : '')),
        v.minLength(1, 'recovery phrase is required'),
      ),
      password: password(),
      confirm: v.string(),
    }),
    v.partialCheck(
      [['password'], ['confirm']],
      (input) => input.password === input.confirm,
      'passwords do not match',
    ),
  );

export const recoverOtpForm = () =>
  v.pipe(
    v.object({
      otp: v.pipe(
        v.unknown(),
        v.transform((value) => (typeof value === 'string' ? value.trim() : '')),
        v.regex(/^\d{6}$/, 'enter the 6-digit code'),
      ),
      password: password(),
      confirm: v.string(),
    }),
    v.partialCheck(
      [['password'], ['confirm']],
      (input) => input.password === input.confirm,
      'passwords do not match',
    ),
  );

export const smsForm = (country?: string) =>
  v.object({
    to: phoneE164(country, 'invalid destination number'),
    text: smsText(),
  });

export const contactForm = (country?: string) =>
  v.object({
    name: contactName(),
    number: phoneE164(country, 'invalid phone number'),
  });

export const forwardingForm = (country?: string) =>
  v.object({
    reason: forwardingReason(),
    number: phoneE164(country, 'invalid forwarding request'),
  });

export const profileForm = () =>
  v.object({
    name: v.pipe(
      v.unknown(),
      v.transform((value) => (typeof value === 'string' ? value.trim() : '')),
      v.maxLength(120, 'invalid profile name'),
    ),
    country: countryCode(),
  });

export const configForm = () =>
  v.object({
    port: portName(),
    baud: baudRate(),
    dialup: dialupName(),
    profile: modemProfile(),
    captureRaw: configFlag('captureRaw'),
    capturePath: capturePath(),
    lockMinutes: lockMinutes(),
    sessionMaxMinutes: sessionMaxMinutes(),
  });

/** Optional config names mirror validateConfig exactly (empty = automatic). */
export const portName = () =>
  v.pipe(
    v.unknown(),
    v.transform((value) => (typeof value === 'string' ? value : '')),
    v.check((value) => value === '' || /^[A-Za-z0-9._:-]{1,120}$/.test(value), 'invalid port'),
  );

export const dialupName = () =>
  v.pipe(
    v.unknown(),
    v.transform((value) => (typeof value === 'string' ? value : '')),
    v.maxLength(120, 'invalid dial-up profile'),
  );

export const modemProfile = () =>
  v.pipe(
    v.unknown(),
    v.transform((value) => (typeof value === 'string' ? value : '')),
    v.check(
      (value) => value === '' || /^[A-Za-z0-9._-]{1,80}$/.test(value),
      'invalid modem profile',
    ),
  );

export const capturePath = () =>
  v.pipe(
    v.unknown(),
    v.transform((value) => (typeof value === 'string' ? value : '')),
    v.maxLength(260, 'invalid trace file path'),
  );
