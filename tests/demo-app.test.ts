import request from "supertest";
import { describe, expect, it } from "vitest";

import { createDemoApp } from "../src/demo-app/app.js";

describe("legacy servicing demo", () => {
  const app = createDemoApp();

  it("completes the happy path up to the review checkpoint", async () => {
    const search = await request(app)
      .post("/servicing/search")
      .type("form")
      .send({ memberId: "M-1001", scenario: "happy" });
    expect(search.status).toBe(303);
    expect(search.headers.location).toBe(
      "/servicing/members/M-1001?scenario=happy",
    );

    const review = await request(app)
      .post("/servicing/accounts/A-4401/fee-reversal/review?scenario=happy")
      .type("form")
      .send({
        amount: "12.50",
        reason: "duplicate_fee",
        scenario: "happy",
        authorized: "0",
      });
    expect(review.status).toBe(200);
    expect(review.text).toContain("Fee Reversal Review");
    expect(review.text).toContain("REV-4401-1250");
    expect(review.text).toContain("No reversal has been submitted");
  });

  it("returns member-not-found as visible business state", async () => {
    const search = await request(app)
      .post("/servicing/search")
      .type("form")
      .send({ memberId: "M-4040", scenario: "not-found" });
    expect(search.status).toBe(303);
    const location = search.headers.location;
    if (!location) throw new Error("Expected member search to redirect");

    const outcome = await request(app).get(location);
    expect(outcome.status).toBe(200);
    expect(outcome.text).toContain("No member found for that identifier");
  });

  it("exposes a recoverable session warning", async () => {
    const warning = await request(app).get(
      "/servicing/accounts/A-4401?scenario=session-warning",
    );
    expect(warning.status).toBe(200);
    expect(warning.text).toContain("Your session is about to expire");

    const recovered = await request(app).get(
      "/servicing/accounts/A-4401?scenario=session-warning&recovered=1",
    );
    expect(recovered.status).toBe(200);
    expect(recovered.text).toContain("Prepare fee reversal");
  });

  it("requires a supervisor before showing the form", async () => {
    const blocked = await request(app).get(
      "/servicing/accounts/A-4401/fee-reversal?scenario=supervisor",
    );
    expect(blocked.text).toContain("Supervisor authorization required");
    expect(blocked.text).toContain('data-risk="human-only"');

    const approval = await request(app).post(
      "/servicing/accounts/A-4401/supervisor-approval?scenario=supervisor",
    );
    expect(approval.status).toBe(303);
    expect(approval.headers.location).toContain("authorized=1");
  });

  it("exposes permission denial as a hard runtime condition", async () => {
    const denied = await request(app).get(
      "/servicing/accounts/A-4401/fee-reversal?scenario=permission-denied",
    );
    expect(denied.status).toBe(403);
    expect(denied.text).toContain("Permission denied");
  });

  it("sets defensive response headers", async () => {
    const response = await request(app).get("/servicing/search?scenario=happy");
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'self'",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});
