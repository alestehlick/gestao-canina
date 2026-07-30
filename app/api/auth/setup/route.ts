import { getD1Database } from "@/db";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";
import {
  createOpaqueSession,
  createPasswordRecord,
  hashSessionToken,
  sessionCookie,
  setupKeyMatches,
  validateAuthEmail,
  validateNewPassword,
} from "@/lib/server/password-auth";

const defaultServices = [
  ["daycare", "Creche", "day", 7_000, "#009CDE"],
  ["hotel", "Hospedagem", "night", 18_000, "#FF8200"],
  ["bath", "Banho", "service", 9_500, "#E31C79"],
  [
    "hygienic_grooming",
    "Banho e tosa",
    "service",
    9_000,
    "#E31C79",
  ],
  ["transport", "Taxi-dog", "leg", 500, "#FFA300"],
  ["other", "Outro", "service", 5_000, "other"],
] as const;

type AdministratorInput = {
  displayName: string;
  email: string;
  password: string;
};

function readAdministrators(body: Record<string, unknown>) {
  if (
    !Array.isArray(body.administrators) ||
    body.administrators.length !== 2
  ) {
    throw new HttpError(
      400,
      "two_administrators_required",
      "Cadastre exatamente dois administradores.",
    );
  }
  const administrators: AdministratorInput[] = body.administrators.map(
    (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new HttpError(
          400,
          "invalid_administrator",
          "Revise os dados dos administradores.",
        );
      }
      const record = value as Record<string, unknown>;
      const displayName =
        typeof record.displayName === "string"
          ? record.displayName.trim()
          : "";
      if (!displayName || displayName.length > 120) {
        throw new HttpError(
          400,
          "invalid_administrator_name",
          "Informe o nome de cada administrador.",
        );
      }
      return {
        displayName,
        email: validateAuthEmail(record.email),
        password: validateNewPassword(record.password),
      };
    },
  );
  if (administrators[0].email === administrators[1].email) {
    throw new HttpError(
      400,
      "administrators_must_be_distinct",
      "Use um e-mail diferente para cada administrador.",
    );
  }
  if (administrators[0].password === administrators[1].password) {
    throw new HttpError(
      400,
      "administrators_need_distinct_passwords",
      "Crie uma senha diferente para cada administrador.",
    );
  }
  return administrators;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    if (!(await setupKeyMatches(body.setupKey))) {
      throw new HttpError(
        403,
        "invalid_setup_key",
        "A chave de configuração inicial é inválida.",
      );
    }

    const establishmentName = requiredString(
      body,
      "establishmentName",
      120,
    );
    const administrators = readAdministrators(body);
    const passwordRecords = await Promise.all(
      administrators.map(({ password }) => createPasswordRecord(password)),
    );
    const d1 = getD1Database();
    const [existingEstablishments, credentialCount] = await Promise.all([
      d1
        .prepare(
          `SELECT id
          FROM establishments
          ORDER BY created_at
          LIMIT 2`,
        )
        .all<{ id: string }>(),
      d1
        .prepare(`SELECT COUNT(*) AS value FROM admin_credentials`)
        .first<{ value: number }>(),
    ]);
    if (
      existingEstablishments.results.length > 1 ||
      (credentialCount?.value ?? 0) !== 0
    ) {
      throw new HttpError(
        409,
        "setup_already_completed",
        "A configuração inicial já foi concluída.",
      );
    }

    const existingEstablishmentId =
      existingEstablishments.results[0]?.id ?? null;
    const establishmentId =
      existingEstablishmentId ?? crypto.randomUUID();
    const users = administrators.map((administrator, index) => ({
      id: crypto.randomUUID(),
      ...administrator,
      credential: passwordRecords[index],
    }));
    const session = createOpaqueSession();
    const sessionId = crypto.randomUUID();
    const sessionTokenHash = await hashSessionToken(session.token);

    const setupGuardStatement = existingEstablishmentId
      ? d1
          .prepare(
            `UPDATE establishments
            SET name = ?, updated_at = ?
            WHERE id = ?
              AND (SELECT COUNT(*) FROM establishments) = 1
              AND NOT EXISTS (SELECT 1 FROM admin_credentials)`,
          )
          .bind(
            establishmentName,
            new Date().toISOString(),
            establishmentId,
          )
      : d1
          .prepare(
            `INSERT INTO establishments (id, name, timezone)
            SELECT ?, ?, 'America/Sao_Paulo'
            WHERE NOT EXISTS (SELECT 1 FROM establishments)
              AND NOT EXISTS (SELECT 1 FROM admin_credentials)`,
          )
          .bind(establishmentId, establishmentName);

    const statements: D1PreparedStatement[] = [setupGuardStatement];
    if (existingEstablishmentId) {
      statements.push(
        d1
          .prepare(
            `UPDATE app_users
            SET status = 'disabled',
              normalized_email = 'legacy-disabled-' || id || '@invalid.local',
              updated_at = ?
            WHERE establishment_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM admin_credentials
                WHERE admin_credentials.user_id = app_users.id
              )
              AND NOT EXISTS (SELECT 1 FROM admin_credentials)`,
          )
          .bind(new Date().toISOString(), establishmentId),
      );
    }

    for (const user of users) {
      statements.push(
        d1
          .prepare(
            `INSERT INTO app_users (
              id, establishment_id, external_subject, email,
              normalized_email, display_name, role, status
            )
            SELECT ?, ?, ?, ?, ?, ?, 'owner', 'active'
            WHERE EXISTS (
              SELECT 1 FROM establishments WHERE id = ?
            )
              AND NOT EXISTS (SELECT 1 FROM admin_credentials)`,
          )
          .bind(
            user.id,
            establishmentId,
            `password:${user.id}`,
            user.email,
            user.email,
            user.displayName,
            establishmentId,
          ),
      );
    }

    for (const user of users) {
      statements.push(
        d1
          .prepare(
            `INSERT INTO admin_credentials (
              user_id, password_algorithm, password_hash, password_salt,
              password_iterations, failed_login_attempts
            )
            SELECT ?, ?, ?, ?, ?, 0
            WHERE EXISTS (
              SELECT 1 FROM app_users
              WHERE id = ? AND establishment_id = ?
            )
              AND NOT EXISTS (
                SELECT 1 FROM admin_credentials
                WHERE user_id NOT IN (?, ?)
              )`,
          )
          .bind(
            user.id,
            user.credential.algorithm,
            user.credential.hash,
            user.credential.salt,
            user.credential.iterations,
            user.id,
            establishmentId,
            users[0].id,
            users[1].id,
          ),
      );
    }

    for (const [
      code,
      name,
      unit,
      basePriceCents,
      colorToken,
    ] of defaultServices) {
      statements.push(
        d1
          .prepare(
            `INSERT INTO service_catalog (
              id, establishment_id, code, name, unit, base_price_cents,
              color_token, active
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, 1
            WHERE EXISTS (
              SELECT 1 FROM admin_credentials WHERE user_id = ?
            )
              AND NOT EXISTS (
                SELECT 1 FROM service_catalog
                WHERE establishment_id = ? AND code = ?
              )`,
          )
          .bind(
            crypto.randomUUID(),
            establishmentId,
            code,
            name,
            unit,
            basePriceCents,
            colorToken,
            users[0].id,
            establishmentId,
            code,
          ),
      );
    }

    statements.push(
      d1
        .prepare(
          `INSERT INTO admin_sessions (
            id, user_id, establishment_id, token_hash, expires_at
          )
          SELECT ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM admin_credentials WHERE user_id = ?
          )`,
        )
        .bind(
          sessionId,
          users[0].id,
          establishmentId,
          sessionTokenHash,
          session.expiresAt,
          users[0].id,
        ),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json
          )
          SELECT ?, ?, ?, 'owner', 'auth.initial_setup_completed',
            'establishment', ?, ?, 'success', ?
          WHERE EXISTS (
            SELECT 1 FROM admin_credentials WHERE user_id = ?
          )`,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          users[0].id,
          establishmentId,
          requestId,
          JSON.stringify({
            ownerUserIds: users.map(({ id }) => id),
            serviceCount: defaultServices.length,
          }),
          users[0].id,
        ),
    );

    const results = await d1.batch(statements);
    if ((results[0].meta.changes ?? 0) !== 1) {
      throw new HttpError(
        409,
        "setup_already_completed",
        "A configuração inicial já foi concluída.",
      );
    }
    const response = json(
      {
        setupRequired: false,
        authenticated: true,
        identity: {
          email: users[0].email,
          displayName: users[0].displayName,
          role: "owner",
        },
        sessionExpiresAt: session.expiresAt,
      },
      { status: 201 },
    );
    response.headers.append(
      "set-cookie",
      sessionCookie(session.token, session.expiresAt),
    );
    return response;
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
