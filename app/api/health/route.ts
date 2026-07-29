import { json } from "@/lib/server/http";
import { getRuntimeBindings } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const bindings = getRuntimeBindings();
  return json({
    status: "ok",
    service: "gestao-canina",
    capabilities: {
      database: Boolean(bindings.DB),
      privateFiles: Boolean(bindings.FILES),
      pixProvider: Boolean(bindings.PIX_PROVIDER),
    },
  });
}
