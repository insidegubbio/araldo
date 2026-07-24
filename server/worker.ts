import { ENV } from "./_core/env";

export interface WorkerTrackPayload {
  key: string;
  filename: string;
  action: "upload" | "download" | "delete";
  userId?: number;
  timestamp: string;
}

export async function notifyWorker(payload: WorkerTrackPayload): Promise<boolean> {
  if (!ENV.workerUrl) return false;
  try {
    const res = await fetch(ENV.workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

