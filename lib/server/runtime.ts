import { env } from "cloudflare:workers";

export type RuntimeBindings = {
  DB?: D1Database;
  FILES?: R2Bucket;
  INITIAL_SETUP_KEY?: string;
  AUTH_PASSWORD_PEPPER?: string;
  PIX_PROVIDER?: string;
  PIX_WEBHOOK_SECRET?: string;
};

export function getRuntimeBindings(): RuntimeBindings {
  return env as unknown as RuntimeBindings;
}

export function runtimeValue(
  key: keyof RuntimeBindings,
): string | undefined {
  const binding = getRuntimeBindings()[key];
  if (typeof binding === "string" && binding.trim()) return binding.trim();

  const processValue = process.env[key];
  return processValue?.trim() || undefined;
}
