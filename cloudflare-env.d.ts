declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    INITIAL_SETUP_KEY?: string;
    AUTH_PASSWORD_PEPPER?: string;
    PIX_PROVIDER?: string;
    PIX_WEBHOOK_SECRET?: string;
  }
}
