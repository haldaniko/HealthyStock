import fs from "node:fs";
import { spawn } from "node:child_process";

const config = {
  apiUrl: process.env.VITE_API_URL || "",
  measurementId: process.env.VITE_GA_MEASUREMENT_ID || ""
};
fs.writeFileSync("/app/dist/runtime-config.js", `window.__HEALTHYSTOCK_CONFIG__ = ${JSON.stringify(config)};\n`);
const server = spawn("serve", ["-s", "dist", "-l", "3000"], { stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 1));
