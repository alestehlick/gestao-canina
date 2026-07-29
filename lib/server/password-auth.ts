import { HttpError } from "./http";
import { runtimeValue } from "./runtime";

export const AUTH_SESSION_COOKIE = "__Host-gestao_session";
export const PASSWORD_ITERATIONS = 310_000;
export const SESSION_DURATION_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid_base64url");
  }
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomBytes(length: number) {
  const value = new Uint8Array(length);
  crypto.getRandomValues(value);
  return value;
}

function secureEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |=
      (left[index % left.length] ?? 0) ^
      (right[index % right.length] ?? 0);
  }
  return difference === 0;
}

function passwordPepper() {
  const pepper = runtimeValue("AUTH_PASSWORD_PEPPER");
  if (!pepper || encoder.encode(pepper).byteLength < 32) {
    throw new HttpError(
      503,
      "auth_not_configured",
      "O acesso por senha ainda não foi configurado.",
    );
  }
  return pepper;
}

export async function hashLoginRateLimitKey(
  scope: "ip" | "ip_email",
  components: string[],
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passwordPepper()),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  const payload = [
    "gestao-canina",
    "login-rate-limit",
    "v1",
    scope,
    ...components,
  ].join("\u0000");
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

export function normalizeAuthEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validateAuthEmail(value: unknown) {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_email", "Informe um e-mail válido.");
  }
  const email = normalizeAuthEmail(value);
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new HttpError(400, "invalid_email", "Informe um e-mail válido.");
  }
  return email;
}

export function validateNewPassword(value: unknown) {
  if (typeof value !== "string") {
    throw new HttpError(
      400,
      "invalid_password",
      "Crie uma senha com pelo menos 12 caracteres.",
    );
  }
  const byteLength = encoder.encode(value).byteLength;
  if (value.length < 12 || value.length > 256 || byteLength > 512) {
    throw new HttpError(
      400,
      "invalid_password",
      "Crie uma senha entre 12 e 256 caracteres.",
    );
  }
  return value;
}

export function readLoginPassword(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    encoder.encode(value).byteLength > 512
  ) {
    throw new HttpError(
      401,
      "invalid_credentials",
      "E-mail ou senha inválidos.",
    );
  }
  return value;
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
) {
  if (iterations < 210_000 || iterations > 2_000_000) {
    throw new HttpError(
      503,
      "unsupported_password_record",
      "A credencial armazenada precisa ser atualizada.",
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${password}\u0000${passwordPepper()}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const result = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: Uint8Array.from(salt).buffer,
      iterations,
    },
    key,
    256,
  );
  return new Uint8Array(result);
}

export async function createPasswordRecord(password: string) {
  const salt = randomBytes(16);
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return {
    algorithm: "pbkdf2-sha256" as const,
    hash: encodeBase64Url(hash),
    salt: encodeBase64Url(salt),
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string,
  iterations: number,
) {
  let expected: Uint8Array;
  let salt: Uint8Array;
  try {
    expected = decodeBase64Url(storedHash);
    salt = decodeBase64Url(storedSalt);
  } catch {
    throw new HttpError(
      503,
      "unsupported_password_record",
      "A credencial armazenada precisa ser atualizada.",
    );
  }
  if (expected.length !== 32 || salt.length < 16) {
    throw new HttpError(
      503,
      "unsupported_password_record",
      "A credencial armazenada precisa ser atualizada.",
    );
  }
  const actual = await derivePassword(password, salt, iterations);
  return secureEqual(actual, expected);
}

export async function performDummyPasswordCheck(password: string) {
  const salt = encoder.encode("gestao-canina-auth-dummy-salt");
  await derivePassword(password, salt, PASSWORD_ITERATIONS);
}

export async function setupKeyMatches(received: unknown) {
  const configured = runtimeValue("INITIAL_SETUP_KEY");
  if (!configured || encoder.encode(configured).byteLength < 24) {
    throw new HttpError(
      503,
      "setup_not_configured",
      "A chave de configuração inicial ainda não foi definida.",
    );
  }
  const candidate = typeof received === "string" ? received : "";
  const [expectedHash, candidateHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(configured)),
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
  ]);
  return secureEqual(
    new Uint8Array(expectedHash),
    new Uint8Array(candidateHash),
  );
}

export function createOpaqueSession() {
  const token = encodeBase64Url(randomBytes(32));
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_SECONDS * 1_000,
  ).toISOString();
  return { token, expiresAt };
}

export async function hashSessionToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return encodeBase64Url(new Uint8Array(digest));
}

export function readSessionToken(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== AUTH_SESSION_COOKIE) continue;
    const token = rawValue.join("=");
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  }
  return null;
}

export function sessionCookie(token: string, expiresAt: string) {
  return [
    `${AUTH_SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_DURATION_SECONDS}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].join("; ");
}

export function expiredSessionCookie() {
  return [
    `${AUTH_SESSION_COOKIE}=`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ].join("; ");
}
