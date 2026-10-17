import { disableTotp, setPassword, totpEnabled } from "./auth";

/** Shared by `bun run set-password` and `project-hub set-password`. */
export async function setPasswordCommand(arg?: string) {
  const pw = arg ?? prompt("New password (min. 8 characters):");
  if (!pw) process.exit(1);
  await setPassword(pw);
  console.log("Password updated. All existing logins were signed out.");
}

/** Shared by `bun run disable-2fa` and `project-hub disable-2fa`. */
export function disable2faCommand() {
  if (!totpEnabled()) {
    console.log("Two-factor authentication is already off.");
    return;
  }
  disableTotp();
  console.log("Two-factor authentication turned off. Log in with the password alone, then set it up again in Settings.");
}
