import "dotenv/config";
import { initDb, query } from "../dist/services/db.js";
import { upsertSuperadmin } from "../dist/services/userStore.js";

await initDb();
const existing = await query("SELECT COUNT(*) AS count FROM users WHERE role = 'superadmin'");
if (Number(existing[0].count) > 0) {
  console.log("Superadmin already exists; credentials preserved.");
} else {
  const email = process.env.LOCAL_SUPERADMIN_EMAIL;
  const password = process.env.LOCAL_SUPERADMIN_PASSWORD;
  if (!email || !password) throw new Error("LOCAL_SUPERADMIN_EMAIL and LOCAL_SUPERADMIN_PASSWORD are required");
  const admin = await upsertSuperadmin(email, password);
  console.log(`Initial superadmin created: ${admin.email}`);
}
