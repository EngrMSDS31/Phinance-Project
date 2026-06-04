import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig(async ({ mode }) => {
  const port = Number(process.env.PORT || 5173);
  const basePath = process.env.BASE_PATH || "/";

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      ...(mode !== "production" ? [runtimeErrorOverlay()] : []),
      ...(mode !== "production" && process.env.REPL_ID
        ? [
            (await import("@replit/vite-plugin-cartographer")).cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
            (await import("@replit/vite-plugin-dev-banner")).devBanner(),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist"),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
