"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export default function PasswordResetPage() {
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const token =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("token") ?? "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password !== confirmation) {
      setError("A confirmação da senha não confere.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload?.error?.message || "Não foi possível alterar a senha.");
      }
      setComplete(true);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível alterar a senha.",
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
        <h1>{complete ? "Senha alterada." : "Crie uma nova senha."}</h1>
        {complete ? (
          <>
            <p>Todas as sessões anteriores foram encerradas por segurança.</p>
            <Link className="primary-button" href="/">
              Entrar
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <label className="field">
              <span>Nova senha</span>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                autoFocus
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
              {busy ? "Salvando…" : "Salvar nova senha"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
