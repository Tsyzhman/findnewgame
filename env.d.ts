declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    ADMIN_EMAILS?: string;
    CATALOG_MODE?: string;
    SITE_URL?: string;
    BILLING_ENABLED?: string;
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    LAVA_API_KEY?: string;
    LAVA_WEBHOOK_TOKEN?: string;
    LAVA_OFFER_ID?: string;
    TRIBUTE_API_KEY?: string;
    TRIBUTE_DONATION_URL?: string;
    MAINTENANCE_TOKEN?: string;
  }
}

interface ImportMeta {
  readonly env: { DEV: boolean; PROD: boolean };
}
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
