import { disableTotp, totpEnabled } from "../src/auth";

if (!totpEnabled()) {
  console.log("Two-factor authentication is already off.");
  process.exit(0);
}
disableTotp();
console.log("Two-factor authentication turned off. Log in with the password alone, then set it up again in Settings.");
