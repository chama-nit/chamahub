import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // L'applicazione e' interamente client-side: nessuna logica applicativa
  // viene eseguita sul server Next.js. Tutta la sicurezza e' delegata a
  // Supabase (RLS + Edge Function con service_role).
  reactStrictMode: true,
  //allowedDevOrigins: ["192.168.10.187"]
};

export default nextConfig;
