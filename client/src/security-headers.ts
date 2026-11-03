// Response headers for the DisputeDesk page, used by vite.config.ts. The API sets its own (server/src/app.ts).
const COMMON = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
};

// Production build (`npm run preview`): only the app's own files run, nothing inline, nothing from other hosts.
// img-src allows data: for the empty favicon in index.html.
export const PREVIEW_HEADERS = {
  ...COMMON,
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; " +
    "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

// Dev server: Vite's React refresh injects an inline script and CSS arrives as inline <style> tags, so a strict
// script-src/style-src would break it. Dev keeps every other protection; the strict policy is checked on the build.
export const DEV_HEADERS = {
  ...COMMON,
  "Content-Security-Policy": "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
