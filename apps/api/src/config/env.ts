import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Locate the monorepo `.env`, which is shared by the API, the web app and
 * Docker Compose.
 *
 * The depth from this module to the repo root differs between `src/` (run by
 * tsx) and the bundled `dist/`, so we walk upward from both the module
 * directory and the working directory rather than hard-coding a depth.
 */
function findEnvFile(): string | undefined {
  const startDirs = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];

  for (const start of startDirs) {
    let dir = start;
    // Stop at the filesystem root, where dirname becomes a fixed point.
    while (true) {
      const candidate = path.join(dir, '.env');
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

// Real environment variables always win; dotenv never overrides what is set.
const envFile = findEnvFile();
if (envFile) {
  dotenv.config({ path: envFile });
}

/** Coerce a decimal string to a positive integer, with a default. */
const intWithDefault = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const booleanWithDefault = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(fallback ? 'true' : 'false');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_PORT: intWithDefault(4000),
  API_URL: z.string().url().default('http://localhost:4000'),
  WEB_URL: z.string().url().default('http://localhost:5173'),
  // Apex marketing domain that hosts friendly quotation slugs
  // (`https://travelagencycrm.in/<publicSlug>`). Distinct from WEB_URL (the
  // CRM app host) because slugs resolve on the marketing root domain.
  PUBLIC_SLUG_BASE_URL: z.string().url().default('https://travelagencycrm.in'),

  // Additional first-party hostnames that serve the SAME app deployment as
  // WEB_URL (comma-separated), e.g. `demo.travelagencycrm.in`. Treated exactly
  // like the configured platform hosts: trusted by request-host and origin
  // validation and reserved so a customer custom domain can never claim them.
  // Invalid entries are ignored at parse time rather than failing boot.
  PLATFORM_ALIAS_HOSTS: z.string().default(''),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: 'DATABASE_URL must be a PostgreSQL connection string',
    }),

  SESSION_COOKIE_NAME: z.string().min(1).default('interscale_sid'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  TOKEN_PEPPER: z.string().min(32, 'TOKEN_PEPPER must be at least 32 characters'),
  SESSION_EXPIRY_HOURS: intWithDefault(12),
  REMEMBER_ME_EXPIRY_DAYS: intWithDefault(30),

  OTP_EXPIRY_MINUTES: intWithDefault(10),
  OTP_RESEND_COOLDOWN_SECONDS: intWithDefault(60),
  OTP_MAX_ATTEMPTS: intWithDefault(5),

  PASSWORD_RESET_EXPIRY_MINUTES: intWithDefault(30),

  /** Consecutive failures before an account is temporarily locked. */
  LOGIN_MAX_FAILED_ATTEMPTS: intWithDefault(5),
  LOGIN_LOCKOUT_MINUTES: intWithDefault(15),

  /** Name of the JS-readable cookie carrying the double-submit CSRF token. */
  CSRF_COOKIE_NAME: z.string().min(1).default('interscale_csrf'),
  /** Header the frontend echoes the CSRF token back in. */
  CSRF_HEADER_NAME: z.string().min(1).default('x-csrf-token'),

  /**
   * `memory` collects mail in-process for tests and is rejected outside them.
   * `console` prints to the log (development only).
   */
  EMAIL_PROVIDER: z.enum(['console', 'smtp', 'memory']).default('console'),
  EMAIL_FROM: z.string().min(1).default('Travel CRM <no-reply@interscale.local>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  // 'local' is a development-only provider: persistent local disk with
  // presigned-style URLs (disk-storage.service.ts). Production requires 's3'.
  STORAGE_PROVIDER: z.enum(['s3', 'memory', 'local']).default('memory'),
  // Root directory for STORAGE_PROVIDER=local (dev only).
  STORAGE_LOCAL_DIR: z.string().default('./.local-storage'),
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_S3_BUCKET: z.string().default('interscale-travel-crm-dev'),
  AWS_CALL_RECORDINGS_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_ENDPOINT: z.string().url().optional().or(z.literal('')),
  AWS_S3_FORCE_PATH_STYLE: booleanWithDefault(false),
  AWS_S3_SERVER_SIDE_ENCRYPTION: z.enum(['AES256', 'aws:kms']).default('AES256'),
  AWS_S3_PRESIGNED_URL_EXPIRY_SECONDS: intWithDefault(300),
  // Phase 3 Custom Domain: the stable CNAME target customers point their
  // subdomain at (the existing application hostname), and the HTTPS listener
  // that customer certificates are attached to. Empty in local/test where the
  // AWS integration is mocked.
  CUSTOM_DOMAIN_CNAME_TARGET: z.string().trim().min(1).default('app.travelagencycrm.in'),
  CUSTOM_DOMAIN_HTTPS_LISTENER_ARN: z.string().trim().optional().default(''),
  MAX_UPLOAD_SIZE_MB: intWithDefault(10),
  BOOKING_DOCUMENT_MAX_UPLOAD_SIZE_MB: intWithDefault(15),
  BOOKING_PRESIGNED_URL_EXPIRY_SECONDS: intWithDefault(300),
  PASSPORT_EXPIRY_WARNING_MONTHS: intWithDefault(6),
  CUSTOMER_DOCUMENT_MAX_UPLOAD_SIZE_MB: intWithDefault(10),
  CUSTOMER_DOCUMENT_PRESIGNED_URL_EXPIRY_SECONDS: intWithDefault(300),
  VENDOR_DOCUMENT_MAX_UPLOAD_SIZE_MB: intWithDefault(15),
  VENDOR_DOCUMENT_PRESIGNED_URL_EXPIRY_SECONDS: intWithDefault(300),
  DESTINATION_IMAGE_MAX_UPLOAD_SIZE_MB: intWithDefault(4),
  DESTINATION_IMAGE_PRESIGNED_URL_EXPIRY_SECONDS: intWithDefault(300),
  HOTEL_IMAGE_MAX_UPLOAD_SIZE_MB: intWithDefault(5),
  AIRLINE_LOGO_MAX_UPLOAD_SIZE_MB: intWithDefault(2),
  COMPANY_LOGO_MAX_UPLOAD_SIZE_MB: intWithDefault(2),
  CRUISE_IMAGE_MAX_UPLOAD_SIZE_MB: intWithDefault(5),
  VEHICLE_IMAGE_MAX_UPLOAD_SIZE_MB: intWithDefault(5),
  SIGHTSEEING_IMAGE_MAX_UPLOAD_SIZE_MB: intWithDefault(5),
  ADD_ON_SERVICE_IMAGE_MAX_UPLOAD_SIZE_MB: intWithDefault(5),
  TESTIMONIAL_IMAGE_MAX_UPLOAD_SIZE_MB: intWithDefault(2),
  MASTER_MEDIA_PRESIGNED_URL_EXPIRY_SECONDS: intWithDefault(300),
  VENDOR_CONTRACT_EXPIRY_WARNING_DAYS: intWithDefault(30),
  REMINDER_WORKER_BATCH_SIZE: intWithDefault(100),
  REMINDER_WORKER_TIMEZONE_FALLBACK: z.string().min(1).default('Asia/Kolkata'),
  REMINDER_ESCALATION_MANAGER_ROLE: z.string().min(1).default('Manager'),
  REMINDER_EMAIL_ENABLED: booleanWithDefault(true),
  REMINDER_DEFAULT_DUE_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('10:00'),
  REMINDER_PROCESSING_LOOKAHEAD_DAYS: intWithDefault(60),
  NOTIFICATION_RETENTION_DAYS: intWithDefault(180),
  DEFAULT_VENDOR_COUNTRY: z.string().trim().length(2).default('IN'),
  DEFAULT_PHONE_COUNTRY: z.string().trim().length(2).default('IN'),
  CUSTOMER_DUPLICATE_NAME_THRESHOLD: z.coerce.number().min(0.5).max(1).default(0.88),
  /** Base64-encoded 32-byte AES-256 key. Never exposed to the browser. */
  DATA_ENCRYPTION_KEY: z.string().optional(),
  DATA_ENCRYPTION_KEY_VERSION: z.string().min(1).max(30).default('v1'),

  RATE_LIMIT_WINDOW_MINUTES: intWithDefault(15),
  RATE_LIMIT_MAX_REQUESTS: intWithDefault(300),

  /**
   * Live hotel & flight search powered by SearchApi (searchapi.io). The key is
   * only used server-side — the browser never sees it. Without a key the live
   * search endpoints respond 503.
   *
   * `.env` carries an empty SEARCHAPI_API_KEY= by default; an empty string must
   * be treated the same as "unset" so the API boots and auth keeps working even
   * when live search is not configured.
   */
  SEARCHAPI_API_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  SEARCHAPI_BASE_URL: z.string().url().default('https://www.searchapi.io/api/v1/search'),

  /**
   * System Global Masters bootstrap credentials. Read ONLY by the
   * `bootstrap:system-masters` command and never echoed to logs or responses.
   * Optional here because the running API must boot without them; the
   * bootstrap command fails safely when they are missing.
   */
  SYSTEM_ADMIN_EMAIL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().email().optional(),
  ),
  SYSTEM_ADMIN_PASSWORD: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  SYSTEM_ADMIN_RESET_PASSWORD: booleanWithDefault(false),
  /** Optional fallback company id; the deterministic slug is preferred. */
  SYSTEM_GLOBAL_MASTERS_COMPANY_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().uuid().optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

/**
 * The outcome of validating a raw environment source. Kept pure (no process
 * exit, no logging) so it can be unit-tested against fabricated production
 * configurations without tearing down the test runner.
 */
export type EnvEvaluation =
  { success: true; value: Env; errors: [] } | { success: false; value: null; errors: string[] };

const isHttps = (url: string): boolean => url.startsWith('https://');

/**
 * Validate an environment source and collect every problem, rather than
 * throwing on the first. Returns the parsed value on success. This is the
 * single source of truth for both boot-time validation and the env tests.
 */
export function evaluateEnv(source: NodeJS.ProcessEnv): EnvEvaluation {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const errors = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    return { success: false, value: null, errors };
  }

  const value = parsed.data;
  const errors: string[] = [];

  // The in-memory provider must never be reachable outside the test runner.
  if (value.EMAIL_PROVIDER === 'memory' && value.NODE_ENV !== 'test') {
    errors.push('EMAIL_PROVIDER=memory is only valid when NODE_ENV=test.');
  }

  if (value.DATA_ENCRYPTION_KEY) {
    const bytes = Buffer.from(value.DATA_ENCRYPTION_KEY, 'base64');
    if (bytes.length !== 32) {
      errors.push('DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
    }
  }

  // Production-only hardening: refuse to boot with insecure or placeholder config.
  if (value.NODE_ENV === 'production') {
    if (value.SESSION_SECRET.includes('change_me') || value.TOKEN_PEPPER.includes('change_me')) {
      errors.push(
        'SESSION_SECRET / TOKEN_PEPPER still contain the example placeholder. Refusing to start in production.',
      );
    }
    if (!isHttps(value.WEB_URL)) errors.push('WEB_URL must use https:// in production.');
    if (!isHttps(value.API_URL)) errors.push('API_URL must use https:// in production.');

    if (value.EMAIL_PROVIDER !== 'smtp') {
      // `console` prints OTPs to the log; `memory` silently discards mail.
      errors.push(
        `EMAIL_PROVIDER="${value.EMAIL_PROVIDER}" is not permitted in production. Use "smtp".`,
      );
    } else {
      if (!value.SMTP_HOST) errors.push('SMTP_HOST is required when EMAIL_PROVIDER=smtp.');
      if (!value.SMTP_PORT) errors.push('SMTP_PORT is required in production.');
      if (!value.SMTP_USER) errors.push('SMTP_USER is required in production.');
      if (!value.SMTP_PASSWORD) errors.push('SMTP_PASSWORD is required in production.');
    }
    if (/\.local(\b|>|$)/i.test(value.EMAIL_FROM)) {
      errors.push('EMAIL_FROM must use a real, deliverable domain (not a ".local" placeholder).');
    }

    if (value.STORAGE_PROVIDER !== 's3' || !value.AWS_S3_BUCKET) {
      errors.push('Production requires STORAGE_PROVIDER=s3 and AWS_S3_BUCKET.');
    }
    if (!value.AWS_REGION) errors.push('AWS_REGION is required in production.');
    // Either the IAM/default credential chain is intended (neither static key
    // set) or a complete static pair is supplied. A half-set pair is a misconfig.
    const hasKeyId = Boolean(value.AWS_ACCESS_KEY_ID);
    const hasKeySecret = Boolean(value.AWS_SECRET_ACCESS_KEY);
    if (hasKeyId !== hasKeySecret) {
      errors.push(
        'Set BOTH AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or NEITHER (to use an IAM role / default credential chain).',
      );
    }

    if (!value.DATA_ENCRYPTION_KEY) {
      errors.push('DATA_ENCRYPTION_KEY is required in production for passport protection.');
    }
    if (!value.DATA_ENCRYPTION_KEY_VERSION) {
      errors.push('DATA_ENCRYPTION_KEY_VERSION is required in production.');
    }
  }

  if (errors.length) return { success: false, value: null, errors };
  return { success: true, value, errors: [] };
}

/**
 * Boot-time validation. On failure, print every problem at once and exit — a
 * half-configured server is worse than one that refuses to start.
 */
function loadEnv(): Env {
  const result = evaluateEnv(process.env);

  if (!result.success) {
    console.error(
      [
        '',
        '✖ Invalid environment configuration. The API cannot start.',
        '',
        ...result.errors.map((message) => `  - ${message}`),
        '',
        '  Fix: copy .env.example to .env at the repository root and fill in the values.',
        '    cp .env.example .env',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  return result.value;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
