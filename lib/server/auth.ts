import { and, eq, or } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getDb } from "@/db";
import { appUsers } from "@/db/schema";
import { HttpError } from "./http";
import { runtimeValue } from "./runtime";

export type AppRole = "owner" | "staff" | "finance" | "customer";

export type Identity = {
  provider: "sites" | "cloudflare-access" | "development";
  subject: string;
  email: string;
  displayName: string;
  role: AppRole;
  userId: string | null;
  establishmentId: string | null;
};

const trustedOwnerRoles: AppRole[] = ["owner"];

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function configuredOwnerEmails() {
  return new Set(
    (runtimeValue("OWNER_EMAILS") ?? "")
      .split(",")
      .map(normalizedEmail)
      .filter(Boolean),
  );
}

async function verifyCloudflareIdentity(
  request: Request,
): Promise<{
  subject: string;
  email: string;
  displayName: string;
} | null> {
  const emailHeader = request.headers.get(
    "cf-access-authenticated-user-email",
  );
  const assertion = request.headers.get("cf-access-jwt-assertion");
  if (!emailHeader || !assertion) return null;

  const teamDomain = runtimeValue("CLOUDFLARE_ACCESS_TEAM_DOMAIN");
  const audience = runtimeValue("CLOUDFLARE_ACCESS_AUD");
  if (!teamDomain || !audience) {
    throw new HttpError(
      503,
      "access_not_configured",
      "A validação do Cloudflare Access ainda não foi configurada.",
    );
  }

  const normalizedTeamDomain = teamDomain.replace(/^https?:\/\//, "").replace(
    /\/+$/,
    "",
  );
  const issuer = `https://${normalizedTeamDomain}`;
  const jwks = createRemoteJWKSet(
    new URL(`${issuer}/cdn-cgi/access/certs`),
  );
  const { payload } = await jwtVerify(assertion, jwks, {
    issuer,
    audience,
  });
  const tokenEmail =
    typeof payload.email === "string"
      ? payload.email
      : typeof payload.sub === "string" && payload.sub.includes("@")
        ? payload.sub
        : null;
  if (!tokenEmail || normalizedEmail(tokenEmail) !== normalizedEmail(emailHeader)) {
    throw new HttpError(
      401,
      "invalid_identity",
      "A identidade recebida não pôde ser confirmada.",
    );
  }

  return {
    subject: String(payload.sub ?? normalizedEmail(tokenEmail)),
    email: normalizedEmail(tokenEmail),
    displayName:
      typeof payload.name === "string" ? payload.name : tokenEmail.split("@")[0],
  };
}

export async function getIdentity(
  request: Request,
  options: { allowUnprovisionedOwner?: boolean } = {},
): Promise<Identity | null> {
  const sitesEmail = request.headers.get("oai-authenticated-user-email");
  if (sitesEmail) {
    const encodedFullName = request.headers.get(
      "oai-authenticated-user-full-name",
    );
    const fullName =
      encodedFullName &&
      request.headers.get("oai-authenticated-user-full-name-encoding") ===
        "percent-encoded-utf-8"
        ? safeDecodeURIComponent(encodedFullName)
        : null;
    return {
      provider: "sites",
      subject: `sites:${normalizedEmail(sitesEmail)}`,
      email: normalizedEmail(sitesEmail),
      displayName: fullName ?? sitesEmail.split("@")[0],
      role: "owner",
      userId: null,
      establishmentId: runtimeValue("DEFAULT_ESTABLISHMENT_ID") ?? null,
    };
  }

  const cloudflareIdentity = await verifyCloudflareIdentity(request);
  if (cloudflareIdentity) {
    const ownerEmails = configuredOwnerEmails();
    if (
      options.allowUnprovisionedOwner &&
      ownerEmails.has(cloudflareIdentity.email)
    ) {
      return {
        provider: "cloudflare-access",
        ...cloudflareIdentity,
        role: "owner",
        userId: null,
        establishmentId: runtimeValue("DEFAULT_ESTABLISHMENT_ID") ?? null,
      };
    }

    const db = getDb();
    const [user] = await db
      .select()
      .from(appUsers)
      .where(
        and(
          eq(appUsers.status, "active"),
          or(
            eq(appUsers.externalSubject, cloudflareIdentity.subject),
            eq(appUsers.normalizedEmail, cloudflareIdentity.email),
          ),
        ),
      )
      .limit(1);
    if (!user) return null;
    return {
      provider: "cloudflare-access",
      ...cloudflareIdentity,
      role: user.role,
      userId: user.id,
      establishmentId: user.establishmentId,
    };
  }

  if (process.env.NODE_ENV !== "production") {
    return {
      provider: "development",
      subject: "development:local-admin",
      email: "admin.local@example.com",
      displayName: "Administração local",
      role: "owner",
      userId: null,
      establishmentId: runtimeValue("DEFAULT_ESTABLISHMENT_ID") ?? "demo-local",
    };
  }

  return null;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export async function requireIdentity(
  request: Request,
  roles: AppRole[],
): Promise<Identity> {
  const identity = await getIdentity(request);
  if (!identity) {
    throw new HttpError(401, "authentication_required", "Entre para continuar.");
  }
  if (!roles.includes(identity.role)) {
    throw new HttpError(
      403,
      "permission_denied",
      "Sua conta não tem permissão para esta ação.",
    );
  }
  if (!identity.establishmentId) {
    throw new HttpError(
      503,
      "establishment_not_configured",
      "O ambiente ainda precisa ser inicializado.",
    );
  }
  return identity;
}

export async function requireBootstrapOwner(request: Request) {
  const identity = await getIdentity(request, {
    allowUnprovisionedOwner: true,
  });
  if (!identity || !trustedOwnerRoles.includes(identity.role)) {
    throw new HttpError(
      403,
      "bootstrap_denied",
      "Somente o proprietário autenticado pode iniciar o ambiente.",
    );
  }
  return identity;
}
