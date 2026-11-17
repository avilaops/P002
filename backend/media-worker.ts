import { closeDb } from "./db.js";
import { processNextMediaJob } from "./media-processing.js";

const workerId = `media-${process.pid}`;
let stopping = false;

process.once("SIGTERM", () => { stopping = true; });
process.once("SIGINT", () => { stopping = true; });

while (!stopping) {
  try {
    const processed = await processNextMediaJob(workerId);
    if (!processed) await new Promise((resolve) => setTimeout(resolve, 2_000));
  } catch (error) {
    console.error("[media-worker] ciclo falhou", error);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

await closeDb();
