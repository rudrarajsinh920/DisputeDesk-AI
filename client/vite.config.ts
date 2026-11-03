import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Allow only shared code from the project root, never the rest of it (.env and the demo files live there).
    // Demo disputes reach the browser only through the server, filtered to the signed-in account.
    fs: { allow: [".", "../shared"] },
    // PayPal calls go through the backend so credentials never reach the browser.
    // 127.0.0.1, not localhost: the server binds IPv4 and Windows may resolve localhost to ::1.
    // changeOrigin: false keeps the browser's Host (localhost:5173), so the server's Origin check and the
    // host-only session cookie see one hostname. The string shorthand would rewrite Host to 127.0.0.1:3001.
    proxy: { "/api": { target: "http://127.0.0.1:3001", changeOrigin: false } },
  },
});
