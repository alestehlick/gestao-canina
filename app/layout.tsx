import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

function requestOrigin(host: string | null, protocol: string | null) {
  const safeHost =
    host && /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)
      ? host
      : "localhost:3000";
  const safeProtocol = protocol === "https" ? "https" : "http";
  return `${safeProtocol}://${safeHost}`;
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  const origin = requestOrigin(host, protocol);
  const socialImage = new URL("/og.png", origin).toString();

  return {
    metadataBase: new URL(origin),
    title: {
      default: "Gestão Canina",
      template: "%s · Gestão Canina",
    },
    description:
      "Agenda, cuidados, clientes e cobranças Pix para uma operação canina organizada.",
    applicationName: "Gestão Canina",
    robots: { index: false, follow: false },
    openGraph: {
      title: "Gestão Canina",
      description:
        "Agenda, cuidados, clientes e cobranças Pix em um só lugar.",
      locale: "pt_BR",
      type: "website",
      images: [{ url: socialImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Gestão Canina",
      description:
        "Agenda, cuidados, clientes e cobranças Pix em um só lugar.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
