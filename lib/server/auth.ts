import { and, count, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import {
  adminCredentials,
  adminSessions,
  appUsers,
  establishments,
} from "@/db/schema";
import { HttpError } from "./http";
import {
  hashSessionToken,
  readSessionToken,
} from "./password-auth";

export type AppRole = "owner" | "staff" | "finance" | "customer";

export type Identity = {
  provider: "password";
  subject: string;
  email: string;
  displayName: string;
  role: AppRole;
  userId: string | null;
  establishmentId: string | null;
  sessionExpiresAt: string;
};

export async function getAdminConfigurationState() {
  const db = getDb();
  const [[establishmentCount], [credentialCount], [activeOwnerCount]] =
    await Promise.all([
      db.select({ value: count() }).from(establishments),
      db.select({ value: count() }).from(adminCredentials),
      db
        .select({ value: count() })
        .from(adminCredentials)
        .innerJoin(appUsers, eq(appUsers.id, adminCredentials.userId))
        .where(
          and(
            eq(appUsers.role, "owner"),
            eq(appUsers.status, "active"),
          ),
        ),
    ]);
  const establishmentsTotal = establishmentCount?.value ?? 0;
  const credentialsTotal = credentialCount?.value ?? 0;
  const activeOwnersTotal = activeOwnerCount?.value ?? 0;
  return {
    setupRequired:
      establishmentsTotal <= 1 &&
      credentialsTotal === 0 &&
      activeOwnersTotal === 0,
    valid:
      establishmentsTotal === 1 &&
      activeOwnersTotal === 2,
  };
}

async function getPasswordSessionIdentity(
  request: Request,
): Promise<Identity | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const tokenHash = await hashSessionToken(token);
  const db = getDb();
  const [session] = await db
    .select({
      userId: appUsers.id,
      establishmentId: appUsers.establishmentId,
      externalSubject: appUsers.externalSubject,
      email: appUsers.normalizedEmail,
      displayName: appUsers.displayName,
      role: appUsers.role,
      expiresAt: adminSessions.expiresAt,
    })
    .from(adminSessions)
    .innerJoin(appUsers, eq(appUsers.id, adminSessions.userId))
    .innerJoin(
      adminCredentials,
      eq(adminCredentials.userId, appUsers.id),
    )
    .where(
      and(
        eq(adminSessions.tokenHash, tokenHash),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, new Date().toISOString()),
        eq(appUsers.status, "active"),
      ),
    )
    .limit(1);
  if (!session) return null;
  return {
    provider: "password",
    subject: session.externalSubject,
    email: session.email,
    displayName: session.displayName,
    role: session.role,
    userId: session.userId,
    establishmentId: session.establishmentId,
    sessionExpiresAt: session.expiresAt,
  };
}

export async function getIdentity(
  request: Request,
): Promise<Identity | null> {
  return getPasswordSessionIdentity(request);
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
