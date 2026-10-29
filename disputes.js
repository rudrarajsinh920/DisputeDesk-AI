
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

async function main() {
  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const auth = await fetch(
    "https://api-m.sandbox.paypal.com/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }
  );

  const tokenData = await auth.json();

  if (!auth.ok) {
    throw new Error(`Authentication failed: ${tokenData.error}`);
  }

  const response = await fetch(
    "https://api-m.sandbox.paypal.com/v1/customer/disputes? page_size=5".replace("? ", "?"),
    {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
    }
  );

  const data = await response.json();

  console.log("HTTP status:", response.status);

  if (!response.ok) {
    console.log("PayPal API response:", data);
    process.exitCode = 1;
    return;
  }

  console.log("Response fields:", Object.keys(data));
console.log("Response preview:");
console.log(JSON.stringify(data, null, 2).slice(0, 2500));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
