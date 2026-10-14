import "dotenv/config";
import { initDb } from "../dist/services/db.js";
import { upsertSuperadmin } from "../dist/services/userStore.js";

const [, , email, passwordArg] = process.argv;
const password = passwordArg ?? process.env.SUPERADMIN_PASSWORD;
if (!email || !password) {
  console.error("Usage: npm run create-superadmin -- admin@example.com 'strong-password'");
  process.exit(1);
}
await initDb();
const admin = await upsertSuperadmin(email, password);
console.log(`Superadmin ready: ${admin.email} (${admin.role})`);
