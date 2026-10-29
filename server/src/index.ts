import { createApp } from "./app.ts";
import { ENV_PATH, loadConfig } from "./config.ts";
import { createPayPalClient } from "./paypal.ts";

const config = loadConfig();
const app = createApp(config.paypal ? createPayPalClient(config.paypal) : null);

// Localhost only: this server holds PayPal credentials and has no login yet.
app.listen(config.port, "127.0.0.1", (error?: Error) => {
  if (error) {
    console.error(`Could not start server: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const paypal = config.paypal ? "configured" : `not configured (add credentials to ${ENV_PATH})`;
  console.log(`DisputeDesk server on http://127.0.0.1:${config.port}. PayPal sandbox: ${paypal}.`);
});
