import {
  getAdminConfigurationState,
  getIdentity,
} from "@/lib/server/auth";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const [configuration, identity] = await Promise.all([
      getAdminConfigurationState(),
      getIdentity(request),
    ]);
    const { setupRequired } = configuration;
    const authenticated =
      configuration.valid && Boolean(identity?.establishmentId);

    return json({
      setupRequired,
      authenticated,
      ...(authenticated && identity
        ? {
            identity: {
              email: identity.email,
              displayName: identity.displayName,
              role: identity.role,
            },
            sessionExpiresAt: identity.sessionExpiresAt,
          }
        : {}),
      ...(!setupRequired && !configuration.valid
        ? { configurationError: true }
        : {}),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
