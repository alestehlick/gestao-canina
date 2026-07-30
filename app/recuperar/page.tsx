"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export default function PasswordRecoveryPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        message: string;
      };
      if (!response.ok) {
        throw new Error(payload?.error?.message || "Não foi possível continuar.");
      }
      setMessage(payload.message);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível continuar.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="startup-screen">
      <section className="startup-card auth-card">
        <span className="brand-mark startup-mark" aria-hidden="true">
          HQ
        </span>
        <p className="eyebrow">Segurança da conta</p>
        <h1>Recupere seu acesso.</h1>
        <p>
          Informe o e-mail usado no Hospet Quintal. Se houver uma conta ativa,
          enviaremos um link pessoal.
        </p>
        {message ? (
          <div className="access-success">
            <span className="success-mark" aria-hidden="true">
              ✓
            </span>
            <p>{message}</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label className="field">
              <span>E-mail</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                maxLength={254}
                autoFocus
                required
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Enviando…" : "Enviar instruções"}
            </button>
          </form>
        )}
        <Link className="auth-secondary-link" href="/">
          Voltar ao login
        </Link>
      </section>
    </main>
  );
}
