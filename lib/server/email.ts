import { runtimeValue } from "./runtime";

type EmailKind = "invitation" | "password_reset";

export type EmailDeliveryResult =
  | { status: "sent"; messageId: string | null }
  | { status: "manual"; error: string }
  | { status: "failed"; error: string };

export function emailDeliveryConfigured() {
  return Boolean(
    runtimeValue("POSTMARK_SERVER_TOKEN") &&
      runtimeValue("AUTH_EMAIL_FROM"),
  );
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

export async function sendAccessEmail(input: {
  kind: EmailKind;
  to: string;
  name?: string | null;
  actionUrl: string;
  expiresIn: string;
}): Promise<EmailDeliveryResult> {
  const token = runtimeValue("POSTMARK_SERVER_TOKEN");
  const from = runtimeValue("AUTH_EMAIL_FROM");
  if (!token || !from) {
    return {
      status: "manual",
      error:
        "O envio automático ainda não foi configurado. Copie o link e envie pelo canal seguro de sua preferência.",
    };
  }

  const invitation = input.kind === "invitation";
  const subject = invitation
    ? "Seu acesso ao Hospet Quintal"
    : "Redefinição de senha do Hospet Quintal";
  const heading = invitation
    ? "Você recebeu um convite"
    : "Redefina sua senha";
  const actionLabel = invitation ? "Criar minha conta" : "Criar nova senha";
  const introduction = invitation
    ? "Uma conta foi preparada para você no Hospet Quintal."
    : "Recebemos uma solicitação para redefinir a senha da sua conta.";
  const recipientName = input.name?.trim() || "Olá";
  const safeName = escapeHtml(recipientName);
  const safeActionUrl = escapeHtml(input.actionUrl);
  const textBody = [
    recipientName,
    "",
    introduction,
    `${actionLabel}: ${input.actionUrl}`,
    "",
    `Este link é pessoal, pode ser usado uma única vez e expira em ${input.expiresIn}.`,
    "Se você não esperava esta mensagem, ignore-a.",
  ].join("\n");
  const htmlBody = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#f3f0e8;font-family:Arial,sans-serif;color:#26302b">
    <div style="max-width:560px;margin:0 auto;padding:32px 18px">
      <div style="background:#fbfaf7;border:1px solid #d8d2c8;border-radius:16px;padding:32px">
        <div style="width:44px;height:44px;line-height:44px;text-align:center;border-radius:50%;background:#294d3f;color:white;font-family:Georgia,serif;margin-bottom:22px">HQ</div>
        <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6d716c;margin:0 0 8px">Hospet Quintal</p>
        <h1 style="font-family:Georgia,serif;font-size:30px;line-height:1.15;color:#203e33;margin:0 0 16px">${heading}</h1>
        <p style="font-size:16px;line-height:1.6;margin:0 0 12px">${safeName},</p>
        <p style="font-size:16px;line-height:1.6;margin:0 0 24px">${introduction}</p>
        <a href="${safeActionUrl}" style="display:inline-block;background:#294d3f;color:white;text-decoration:none;border-radius:10px;padding:13px 20px;font-weight:700">${actionLabel}</a>
        <p style="font-size:13px;line-height:1.5;color:#6d716c;margin:24px 0 0">Este link é pessoal, pode ser usado uma única vez e expira em ${input.expiresIn}. Se você não esperava esta mensagem, ignore-a.</p>
      </div>
    </div>
  </body>
</html>`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-postmark-server-token": token,
      },
      body: JSON.stringify({
        From: from,
        To: input.to,
        Subject: subject,
        TextBody: textBody,
        HtmlBody: htmlBody,
        MessageStream: "outbound",
        Tag: input.kind,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    const payload = (await response.json().catch(() => null)) as
      | { MessageID?: string; Message?: string }
      | null;
    if (!response.ok) {
      return {
        status: "failed",
        error:
          payload?.Message ||
          "O provedor de e-mail recusou o envio. Tente novamente.",
      };
    }
    return { status: "sent", messageId: payload?.MessageID ?? null };
  } catch {
    return {
      status: "failed",
      error: "O serviço de e-mail não respondeu. Tente novamente.",
    };
  }
}
