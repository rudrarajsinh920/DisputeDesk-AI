import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { DEV_HEADERS, PREVIEW_HEADERS } from "./src/security-headers.ts";

// One hostname (localhost) and fixed ports, so the host-only session cookie and the server's Origin check always
// see the same origin. strictPort fails loudly instead of moving to another port.
const proxy = { "/api": { target: "http://127.0.0.1:3001", changeOrigin: false } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // "@/" is the shadcn/ui import alias (also in tsconfig.json and test/tsx-hooks.mjs).
  resolve: { alias: { "@": "/src" } },
  preview: { host: "localhost", port: 4173, strictPort: true, headers: PREVIEW_HEADERS, proxy },
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    headers: DEV_HEADERS,
    // Allow only shared code from the project root, never the rest of it (.env and the demo files live there).
    // Demo disputes reach the browser only through the server, filtered to the signed-in account.
    fs: { allow: [".", "../shared"] },
    // PayPal calls go through the backend so credentials never reach the browser.
    // 127.0.0.1, not localhost: the server binds IPv4 and Windows may resolve localhost to ::1.
    // changeOrigin: false keeps the browser's Host (localhost:5173), so the server's Origin check and the
    // host-only session cookie see one hostname. The string shorthand would rewrite Host to 127.0.0.1:3001.
    proxy,
  },
});
