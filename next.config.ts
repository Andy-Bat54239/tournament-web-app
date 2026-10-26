import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Loaded by Node at run time, not bundled: pg is a native-style CommonJS driver, and PGlite carries a WebAssembly file.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
};

export default nextConfig;
