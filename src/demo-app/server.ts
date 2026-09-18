import { createDemoApp } from "./app.js";

const port = Number.parseInt(process.env.DEMO_APP_PORT ?? "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("DEMO_APP_PORT must be an integer between 1 and 65535");
}

const server = createDemoApp().listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `${JSON.stringify({ event: "demo_app_started", url: `http://127.0.0.1:${port}` })}\n`,
  );
});

function shutdown(): void {
  server.close((error) => {
    if (error) {
      process.stderr.write(
        `${JSON.stringify({ event: "demo_app_shutdown_failed", message: error.message })}\n`,
      );
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
