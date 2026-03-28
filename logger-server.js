const fs = require("fs");
const http = require("http");
const path = require("path");

const HOST = process.env.TASK_SOLVER_LOG_HOST || "127.0.0.1";
const PORT = Number(process.env.TASK_SOLVER_LOG_PORT || 8787);
const LOG_FILE = path.resolve(
  process.cwd(),
  process.env.TASK_SOLVER_LOG_FILE || "task-solver.log"
);

function formatLogLine(entry, source) {
  const timestamp = entry.timestamp || new Date().toISOString();
  const origin = entry.origin || source || "unknown";
  const scope = entry.scope || "unknown";
  const level = entry.level || "info";
  const message = entry.message || "";
  const details = entry.details == null ? "" : ` ${safeJson(entry.details)}`;

  return `[${timestamp}] [${origin}] [${scope}] [${level}] ${message}${details}\n`;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return JSON.stringify({ serializationError: true });
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(payload));
}

function appendEntries(entries, source) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return;
  }

  const content = entries.map((entry) => formatLogLine(entry, source)).join("");
  fs.appendFileSync(LOG_FILE, content, "utf8");
}

const server = http.createServer((request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, { ok: true });
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ok: true, logFile: LOG_FILE });
    return;
  }

  if (request.method !== "POST" || request.url !== "/log") {
    sendJson(response, 404, { ok: false, error: "Not found" });
    return;
  }

  let rawBody = "";

  request.on("data", (chunk) => {
    rawBody += chunk;
  });

  request.on("end", () => {
    try {
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const entries = Array.isArray(payload.entries) ? payload.entries : [];

      appendEntries(entries, payload.source);
      sendJson(response, 200, { ok: true, written: entries.length, logFile: LOG_FILE });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
  });
});

server.on("error", (error) => {
  if (error?.code !== "EADDRINUSE") {
    console.error("[TaskSolver:logger-server] failed to start", error);
    process.exit(1);
    return;
  }

  verifyExistingServer()
    .then((isTaskSolverServer) => {
      if (isTaskSolverServer) {
        console.log(`[TaskSolver:logger-server] already running on http://${HOST}:${PORT}/log`);
        console.log(`[TaskSolver:logger-server] writing to ${LOG_FILE}`);
        process.exit(0);
        return;
      }

      console.error(`[TaskSolver:logger-server] port ${PORT} on ${HOST} is already in use by another process`);
      process.exit(1);
    })
    .catch((verificationError) => {
      console.error("[TaskSolver:logger-server] could not verify existing process", verificationError);
      process.exit(1);
    });
});

server.listen(PORT, HOST, () => {
  console.log(`[TaskSolver:logger-server] listening on http://${HOST}:${PORT}/log`);
  console.log(`[TaskSolver:logger-server] writing to ${LOG_FILE}`);
});

function verifyExistingServer() {
  return new Promise((resolve) => {
    const request = http.get(
      {
        hostname: HOST,
        port: PORT,
        path: "/health",
        timeout: 1000
      },
      (response) => {
        let rawBody = "";

        response.on("data", (chunk) => {
          rawBody += chunk;
        });

        response.on("end", () => {
          try {
            const payload = rawBody ? JSON.parse(rawBody) : {};
            resolve(Boolean(payload?.ok));
          } catch (_error) {
            resolve(false);
          }
        });
      }
    );

    request.on("error", () => {
      resolve(false);
    });

    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}
