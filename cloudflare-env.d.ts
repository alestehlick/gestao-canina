declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    DEFAULT_ESTABLISHMENT_ID?: string;
    CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
    CLOUDFLARE_ACCESS_AUD?: string;
    OWNER_EMAILS?: string;
    PIX_PROVIDER?: string;
    PIX_WEBHOOK_SECRET?: string;
  }
}
