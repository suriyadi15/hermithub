import { setPasswordCommand } from "../src/admin";

await setPasswordCommand(process.argv[2]);
