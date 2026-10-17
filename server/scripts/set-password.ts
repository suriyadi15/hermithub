import { setPassword } from "../src/auth";

const pw = process.argv[2] ?? prompt("New password (min. 8 characters):");
if (!pw) process.exit(1);
await setPassword(pw);
console.log("Password updated. All existing logins were signed out.");
