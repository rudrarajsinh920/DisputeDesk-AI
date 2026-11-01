import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Allow only the demo fixtures from the project root, never the rest of it (.env lives there).
    fs: { allow: [".", "../sample-dispute.json", "../demo-disputes.json"] },
    // PayPal calls go through the backend so credentials never reach the browser.
    // 127.0.0.1, not localhost: the server binds IPv4 and Windows may resolve localhost to ::1.
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
});
