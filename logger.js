import { LOCAL_LOG_SERVER } from "./config.js";

const FLUSH_DELAY_MS = 100;
const pendingEntries = [];
let flushTimerId = null;
let isFlushing = false;

export function createLogger(scope) {
  return {
    info(message, ...details) {
      emitLog("info", scope, message, details);
    },
    warn(message, ...details) {
      emitLog("warn", scope, message, details);
    },
    error(message, ...details) {
      emitLog("error", scope, message, details);
    }
  };
}

export function queueLogEntries(entries) {
  if (!LOCAL_LOG_SERVER.enabled || !Array.isArray(entries) || entries.length === 0) {
    return;
  }

  pendingEntries.push(...entries.map(normalizeLogEntry));
  scheduleFlush();
}

function emitLog(level, scope, message, details) {
  const consoleMethod = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  consoleMethod(`[TaskSolver:${scope}]`, message, ...details);

  queueLogEntries([
    {
      origin: "background",
      scope,
      level,
      message,
      details: details.length <= 1 ? details[0] : details
    }
  ]);
}

function normalizeLogEntry(entry) {
  return {
    timestamp: entry.timestamp || new Date().toISOString(),
    origin: entry.origin || "background",
    scope: entry.scope || "unknown",
    level: entry.level || "info",
    message: String(entry.message || ""),
    details: entry.details ?? null
  };
}

function scheduleFlush() {
  if (flushTimerId !== null || isFlushing || pendingEntries.length === 0) {
    return;
  }

  flushTimerId = setTimeout(() => {
    flushTimerId = null;
    void flushPendingEntries();
  }, FLUSH_DELAY_MS);
}

async function flushPendingEntries() {
  if (isFlushing || pendingEntries.length === 0 || !LOCAL_LOG_SERVER.enabled) {
    return;
  }

  isFlushing = true;
  const batch = pendingEntries.splice(0, pendingEntries.length);

  try {
    await fetch(LOCAL_LOG_SERVER.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        source: LOCAL_LOG_SERVER.source,
        entries: batch
      })
    });
  } catch (error) {
    console.warn("[TaskSolver:logger]", "Не удалось отправить логи на локальный сервер", {
      message: error?.message,
      endpoint: LOCAL_LOG_SERVER.endpoint
    });
  } finally {
    isFlushing = false;

    if (pendingEntries.length > 0) {
      scheduleFlush();
    }
  }
}
