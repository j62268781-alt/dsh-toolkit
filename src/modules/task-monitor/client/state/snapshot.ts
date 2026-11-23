import React from "react";
import { fetchJson } from "../../../../client/http.js";
import { startPolling } from "../../../../client/poll.js";
import { TASK_MONITOR_POLL_MS, TASK_MONITOR_SNAPSHOT_PATH, type TaskMonitorSnapshot } from "../constants.js";

export async function readSnapshot(sessionId: string, signal?: AbortSignal): Promise<TaskMonitorSnapshot> {
  const response = await fetchJson(TASK_MONITOR_SNAPSHOT_PATH, { json: { sessionId }, signal });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) throw new Error(payload?.detail || `HTTP ${response.status}`);
  return payload;
}

interface Reading {
  snapshot: TaskMonitorSnapshot | undefined;
  listeners: Set<() => void>;
  stop(): void;
}

// The three official sections can mount independently, but share one request per session.
const readings = new Map<string, Reading>();

function subscribe(sessionId: string, listener: () => void): () => void {
  let reading = readings.get(sessionId);
  if (!reading) {
    const current: Reading = { snapshot: undefined, listeners: new Set(), stop: () => {} };
    readings.set(sessionId, current);
    current.stop = startPolling(async (signal) => {
      const data = await readSnapshot(sessionId, signal);
      if (signal.aborted) return;
      current.snapshot = data;
      for (const notify of current.listeners) notify();
    }, { intervalMs: TASK_MONITOR_POLL_MS, pauseWhenHidden: true }).stop;
    reading = current;
  }
  const current = reading;
  current.listeners.add(listener);
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      current.stop();
      readings.delete(sessionId);
    }
  };
}

export function useSnapshot(sessionId: string) {
  const watch = React.useCallback((listener: () => void) => sessionId ? subscribe(sessionId, listener) : () => {}, [sessionId]);
  const read = () => readings.get(sessionId)?.snapshot;
  return React.useSyncExternalStore(watch, read, read);
}
