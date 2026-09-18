import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDemoApp } from "../src/demo-app/app.js";
import { CapabilityArtifactSchema } from "../src/domain/contracts.js";
import { replayCapability } from "../src/replay/replay-engine.js";

describe("deterministic replay", () => {
  let server: Server;
  let origin: string;
  let evidenceRoot: string;

  beforeAll(async () => {
    server = createDemoApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected the demo server to listen on a TCP address");
    }
    origin = `http://127.0.0.1:${address.port}`;
    evidenceRoot = await mkdtemp(path.join(tmpdir(), "cua-replay-"));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(evidenceRoot, { recursive: true, force: true });
  });

  it("replays the artifact without a model and returns typed outputs", async () => {
    const artifactJson: unknown = JSON.parse(
      await readFile("artifacts/prepare-fee-reversal.v1.json", "utf8"),
    );
    const savedArtifact = CapabilityArtifactSchema.parse(artifactJson);
    const artifact = CapabilityArtifactSchema.parse({
      ...savedArtifact,
      target: {
        ...savedArtifact.target,
        entryUrl: `${origin}/servicing/search?scenario=happy`,
        allowedOrigins: [origin],
      },
    });

    const result = await replayCapability({
      artifact,
      rawInputs: {
        memberId: "M-1001",
        amount: "12.50",
        reason: "duplicate_fee",
      },
      evidenceRoot,
      headless: true,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.outputs).toEqual({
      reviewReference: "REV-4401-1250",
      accountLast4: "4401",
      amount: "12.50",
      reviewStatus: "Ready for review",
    });

    const events = await readFile(
      path.join(result.evidenceDirectory, "events.jsonl"),
      "utf8",
    );
    expect(events).toContain("replay_succeeded");
    expect(events).not.toContain("M-1001");
  }, 30_000);
});
