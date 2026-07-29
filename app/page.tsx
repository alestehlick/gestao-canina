import type { Metadata } from "next";
import { ManagementApp } from "./components/management-app";

export const metadata: Metadata = {
  title: "Hoje",
};

export const dynamic = "force-dynamic";

export default function Home() {
  return <ManagementApp />;
}
