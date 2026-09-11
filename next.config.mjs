import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * A self-contained server, on request only.
   *
   * `standalone` traces the modules the server actually reaches and writes a
   * `server.js` that runs without `node_modules` — which is what a Docker
   * image or any self-hosted deploy needs, and what makes "the website as a
   * file" a real artefact rather than a checkout.
   *
   * Behind an env var rather than always on, because Vercel builds this
   * repository too and has its own packaging; leaving the default alone means
   * nothing about the hosted deploy changes.
   */
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  images: {
    formats: ["image/avif", "image/webp"]
  }
};

export default withNextIntl(nextConfig);
