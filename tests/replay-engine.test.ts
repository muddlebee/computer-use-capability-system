import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDemoApp } from "../src/demo-app/app.js";
import { CapabilityArtifactSchema } from "../src/domain/contracts.js";
import { replayCapability } from "../src/replay/replay-engine.js";
import { OperatorConsoleHandoff } from "../src/handoff/operator-console.js";

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

  async function loadArtifact() {
    const artifactJson: unknown = JSON.parse(
      await readFile("artifacts/prepare-fee-reversal.generated.json", "utf8"),
    );
    const savedArtifact = CapabilityArtifactSchema.parse(artifactJson);
    return CapabilityArtifactSchema.parse({
      ...savedArtifact,
      target: {
        ...savedArtifact.target,
        entryUrl: `${origin}/servicing/search?scenario=happy`,
        allowedOrigins: [origin],
      },
    });
  }

  it("replays the artifact without a model and returns typed outputs", async () => {
    const artifact = await loadArtifact();

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

  it("returns a known business outcome instead of a crash", async () => {
    const artifact = await loadArtifact();
    const result = await replayCapability({
      artifact,
      rawInputs: {
        memberId: "M-4040",
        amount: "12.50",
        reason: "duplicate_fee",
      },
      evidenceRoot,
      entryUrlOverride: `${origin}/servicing/search?scenario=not-found`,
    });

    expect(result).toMatchObject({
      status: "business_outcome",
      code: "member_not_found",
    });
  }, 30_000);

  it("recovers from the declared session warning", async () => {
    const artifact = await loadArtifact();
    const result = await replayCapability({
      artifact,
      rawInputs: {
        memberId: "M-1001",
        amount: "12.50",
        reason: "duplicate_fee",
      },
      evidenceRoot,
      entryUrlOverride: `${origin}/servicing/search?scenario=session-warning`,
    });

    expect(result).toMatchObject({
      status: "success",
      recoveries: ["session_extended"],
    });
  }, 30_000);

  it("classifies a declared permission denial as a hard failure", async () => {
    const artifact = await loadArtifact();
    const result = await replayCapability({
      artifact,
      rawInputs: {
        memberId: "M-1001",
        amount: "12.50",
        reason: "duplicate_fee",
      },
      evidenceRoot,
      entryUrlOverride: `${origin}/servicing/search?scenario=permission-denied`,
    });

    expect(result).toMatchObject({
      status: "failure",
      code: "permission_denied",
      stepId: "step-3",
      retryable: false,
    });
  }, 30_000);

  it("blocks a same-origin route outside the configured path allowlist", async () => {
    const artifact = await loadArtifact();
    const result = await replayCapability({
      artifact,
      rawInputs: {
        memberId: "M-1001",
        amount: "12.50",
        reason: "duplicate_fee",
      },
      evidenceRoot,
      entryUrlOverride: `${origin}/administration/users`,
    });

    expect(result).toMatchObject({
      status: "failure",
      code: "policy_denied",
    });
  });

  it("cedes the same live session to an operator and resumes", async () => {
    const artifact = await loadArtifact();
    const handoff = new OperatorConsoleHandoff({
      timeoutMs: 10_000,
      onReady: async (url) => {
        const response = await fetch(`${url}/act`, { method: "POST" });
        if (!response.ok) throw new Error(`Operator action failed: ${response.status}`);
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
      entryUrlOverride: `${origin}/servicing/search?scenario=supervisor`,
      handoff,
    });

    expect(result.status).toBe("success");
    const events = await readFile(
      path.join(result.evidenceDirectory, "events.jsonl"),
      "utf8",
    );
    expect(events).toContain("control_transferred");
    expect(events).toContain("human_action_completed");
  }, 30_000);
});
