import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f3f0e8",
};

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
  const socialImage = new URL(
    "/hospet-quintal-compartilhamento.png",
    origin,
  ).toString();

  return {
    metadataBase: new URL(origin),
    title: {
      default: "Hospet Quintal",
      template: "%s · Hospet Quintal",
    },
    description:
      "Agenda, cuidados, clientes e faturas para uma operação canina organizada.",
    applicationName: "Hospet Quintal",
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    },
    robots: { index: false, follow: false },
    openGraph: {
      title: "Hospet Quintal",
      description:
        "Agenda, cuidados, clientes e faturas em um só lugar.",
      siteName: "Hospet Quintal",
      url: origin,
      locale: "pt_BR",
      type: "website",
      images: [
        {
          url: socialImage,
          width: 1280,
          height: 1280,
          alt: "Hospet Quintal",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Hospet Quintal",
      description:
        "Agenda, cuidados, clientes e faturas em um só lugar.",
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
