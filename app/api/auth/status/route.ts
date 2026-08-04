import {
  getAdminConfigurationState,
  getIdentity,
} from "@/lib/server/auth";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await getIdentity(request);
    if (identity?.establishmentId) {
      return json({
        setupRequired: false,
        authenticated: true,
        identity: {
          email: identity.email,
          displayName: identity.displayName,
          role: identity.role,
        },
        sessionExpiresAt: identity.sessionExpiresAt,
      });
    }

    const configuration = await getAdminConfigurationState();
    const { setupRequired } = configuration;

    return json({
      setupRequired,
      authenticated: false,
      ...(!setupRequired && !configuration.valid
        ? { configurationError: true }
        : {}),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
