
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

async function main() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;

  if (!id || !secret) {
    console.error("Missing PayPal sandbox credentials in .env");
    process.exitCode = 1;
    return;
  }

  const response = await fetch(
    "https://api-m.sandbox.paypal.com/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${id}:${secret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("PayPal authentication failed:", data.error);
    process.exitCode = 1;
    return;
  }

  console.log("Success! PayPal sandbox authentication works.");
  console.log("Token type:", data.token_type);
  console.log("Expires in:", data.expires_in, "seconds");
}

main().catch((error) => {
  console.error("Request failed:", error.message);
  process.exitCode = 1;
});
