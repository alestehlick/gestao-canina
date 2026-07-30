"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

type InvitationDetails = {
  email: string;
  role: "staff" | "customer";
  customerName: string | null;
  expiresAt: string;
};

export default function InvitationPage() {
  const [details, setDetails] = useState<InvitationDetails | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const token =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("token") ?? "";

  useEffect(() => {
    if (!token) {
      const timer = window.setTimeout(
        () => setError("Este convite não possui um código válido."),
        0,
      );
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    fetch(`/api/auth/invitations?token=${encodeURIComponent(token)}`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          error?: { message?: string };
          invitation: InvitationDetails;
        };
        if (!response.ok) {
          throw new Error(payload?.error?.message || "Convite indisponível.");
        }
        setDetails(payload.invitation);
      })
      .catch((reason) => {
        if (reason?.name !== "AbortError") {
          setError(
            reason instanceof Error
              ? reason.message
              : "Não foi possível abrir o convite.",
          );
        }
      });
    return () => controller.abort();
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details || busy) return;
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password !== confirmation) {
      setError("A confirmação da senha não confere.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/invitations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, displayName, password }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        destination?: string;
      };
      if (!response.ok) {
        throw new Error(payload?.error?.message || "Não foi possível criar a conta.");
      }
      setComplete(true);
      window.setTimeout(() => {
        window.location.assign(payload.destination || "/");
      }, 700);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível criar a conta.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="startup-screen">
      <section className="startup-card auth-card invitation-card">
        <span className="brand-mark startup-mark" aria-hidden="true">
          HQ
        </span>
        <p className="eyebrow">Hospet Quintal · novo acesso</p>
        <h1>{complete ? "Conta criada." : "Prepare seu acesso."}</h1>
        {complete ? (
          <p>Seu acesso foi confirmado. Abrindo seu ambiente…</p>
        ) : details ? (
          <>
            <p>
              O convite para <strong>{details.email}</strong> dá acesso como{" "}
              <strong>
                {details.role === "staff" ? "funcionário" : "cliente"}
              </strong>
              {details.customerName ? ` de ${details.customerName}` : ""}.
            </p>
            <form onSubmit={submit}>
              <label className="field">
                <span>Seu nome</span>
                <input
                  name="displayName"
                  autoComplete="name"
                  maxLength={120}
                  autoFocus
                  required
                />
              </label>
              <label className="field">
                <span>Crie uma senha</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  required
                />
                <small>Pelo menos 12 caracteres.</small>
              </label>
              <label className="field">
                <span>Confirmar senha</span>
                <input
                  name="confirmation"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  required
                />
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? "Criando conta…" : "Criar conta"}
              </button>
            </form>
          </>
        ) : error ? (
          <>
            <p className="form-error" role="alert">
              {error}
            </p>
            <Link className="secondary-button" href="/">
              Voltar ao login
            </Link>
          </>
        ) : (
          <span className="loading-dots" aria-label="Validando convite">
            <i />
            <i />
            <i />
          </span>
        )}
      </section>
    </main>
  );
}
