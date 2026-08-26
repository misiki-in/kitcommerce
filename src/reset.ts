/** Delete the local database and uploads. `bun reset` */
import { rmSync } from "node:fs";
import { config } from "./lib/server/config";

for (const suffix of ["", "-wal", "-shm"]) {
  try { rmSync(config.dbPath + suffix); } catch {}
}
try { rmSync(config.uploadsDir, { recursive: true }); } catch {}
console.log(`Removed ${config.dbPath} and uploads. Run "bun seed" or just "bun dev".`);
