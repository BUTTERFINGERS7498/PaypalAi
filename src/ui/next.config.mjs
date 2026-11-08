/** Static export. Build with: next build src/ui  (output lands in src/ui/out) */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};
export default nextConfig;
