declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    INITIAL_SETUP_KEY?: string;
    AUTH_PASSWORD_PEPPER?: string;
    POSTMARK_SERVER_TOKEN?: string;
    AUTH_EMAIL_FROM?: string;
  }
}
