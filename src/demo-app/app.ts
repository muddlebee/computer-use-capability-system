import path from "node:path";

import ejs from "ejs";
import express, { type Express, type Request, type Response } from "express";
import helmet from "helmet";
import { z } from "zod";

export const DemoScenarioSchema = z.enum([
  "happy",
  "not-found",
  "session-warning",
  "supervisor",
  "permission-denied",
]);

export type DemoScenario = z.infer<typeof DemoScenarioSchema>;

const MemberIdSchema = z.string().regex(/^M-[0-9]{4}$/);
const SearchBodySchema = z.object({
  memberId: MemberIdSchema,
  scenario: DemoScenarioSchema,
});
const ReversalBodySchema = z.object({
  amount: z.string().regex(/^\d+\.\d{2}$/),
  reason: z.enum(["duplicate_fee", "incorrect_fee", "other"]),
  scenario: DemoScenarioSchema,
  authorized: z.enum(["0", "1"]).default("0"),
});

const MEMBER = {
  id: "M-1001",
  name: "Alex Morgan",
  accountId: "A-4401",
  accountLast4: "4401",
  balance: "$2,431.18",
} as const;

function parseScenario(request: Request): DemoScenario {
  const result = DemoScenarioSchema.safeParse(request.query.scenario);
  return result.success ? result.data : "happy";
}

function routeWithScenario(route: string, scenario: DemoScenario): string {
  const parameters = new URLSearchParams({ scenario });
  return `${route}?${parameters.toString()}`;
}

function renderError(
  response: Response,
  status: number,
  title: string,
  message: string,
): void {
  response.status(status).render("error", { title, message });
}

export function createDemoApp(): Express {
  const app = express();
  const viewsDirectory = path.join(process.cwd(), "src", "demo-app", "views");

  app.disable("x-powered-by");
  app.engine("ejs", ejs.renderFile);
  app.set("view engine", "ejs");
  app.set("views", viewsDirectory);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'"],
          scriptSrc: ["'none'"],
        },
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use("/assets", express.static(path.join(viewsDirectory, "assets")));

  app.get("/", (_request, response) => {
    response.redirect(302, "/servicing/search?scenario=happy");
  });

  app.get("/servicing/search", (request, response) => {
    const scenario = parseScenario(request);
    const outcome = request.query.outcome === "not-found" ? "not-found" : undefined;
    response.render("search", { scenario, outcome });
  });

  app.post("/servicing/search", (request, response) => {
    const parsed = SearchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      renderError(response, 422, "Validation error", "Enter a member number in M-#### format.");
      return;
    }

    const { memberId, scenario } = parsed.data;
    if (scenario === "not-found" || memberId !== MEMBER.id) {
      response.redirect(
        303,
        `${routeWithScenario("/servicing/search", scenario)}&outcome=not-found`,
      );
      return;
    }

    response.redirect(
      303,
      routeWithScenario(`/servicing/members/${MEMBER.id}`, scenario),
    );
  });

  app.get("/servicing/members/:memberId", (request, response) => {
    const scenario = parseScenario(request);
    if (request.params.memberId !== MEMBER.id) {
      renderError(response, 404, "Member not found", "No member found for that identifier.");
      return;
    }

    response.render("member", {
      scenario,
      member: MEMBER,
      accountUrl: routeWithScenario(
        `/servicing/accounts/${MEMBER.accountId}`,
        scenario,
      ),
    });
  });

  app.get("/servicing/accounts/:accountId", (request, response) => {
    const scenario = parseScenario(request);
    if (request.params.accountId !== MEMBER.accountId) {
      renderError(response, 404, "Account not found", "No account found for that identifier.");
      return;
    }

    if (scenario === "session-warning" && request.query.recovered !== "1") {
      response.render("session-warning", {
        continueUrl: `${routeWithScenario(
          `/servicing/accounts/${MEMBER.accountId}`,
          scenario,
        )}&recovered=1`,
      });
      return;
    }

    response.render("account", {
      scenario,
      member: MEMBER,
      permissionDenied: scenario === "permission-denied",
      reversalUrl: routeWithScenario(
        `/servicing/accounts/${MEMBER.accountId}/fee-reversal`,
        scenario,
      ),
    });
  });

  app.get(
    "/servicing/accounts/:accountId/fee-reversal",
    (request, response) => {
      const scenario = parseScenario(request);
      if (request.params.accountId !== MEMBER.accountId) {
        renderError(response, 404, "Account not found", "No account found for that identifier.");
        return;
      }

      if (scenario === "permission-denied") {
        renderError(
          response,
          403,
          "Permission denied",
          "Your operator role cannot prepare fee reversals for this account.",
        );
        return;
      }

      const authorized = request.query.authorized === "1";
      if (scenario === "supervisor" && !authorized) {
        response.render("supervisor", {
          approvalUrl: routeWithScenario(
            `/servicing/accounts/${MEMBER.accountId}/supervisor-approval`,
            scenario,
          ),
        });
        return;
      }

      response.render("reversal", {
        scenario,
        authorized,
        member: MEMBER,
        reviewUrl: routeWithScenario(
          `/servicing/accounts/${MEMBER.accountId}/fee-reversal/review`,
          scenario,
        ),
      });
    },
  );

  app.post(
    "/servicing/accounts/:accountId/supervisor-approval",
    (request, response) => {
      const scenario = parseScenario(request);
      if (request.params.accountId !== MEMBER.accountId || scenario !== "supervisor") {
        renderError(response, 404, "Approval unavailable", "No approval request is active.");
        return;
      }

      response.redirect(
        303,
        `${routeWithScenario(
          `/servicing/accounts/${MEMBER.accountId}/fee-reversal`,
          scenario,
        )}&authorized=1`,
      );
    },
  );

  app.post(
    "/servicing/accounts/:accountId/fee-reversal/review",
    (request, response) => {
      const parsed = ReversalBodySchema.safeParse(request.body);
      if (request.params.accountId !== MEMBER.accountId || !parsed.success) {
        renderError(response, 422, "Validation error", "The fee reversal form is incomplete.");
        return;
      }

      if (parsed.data.scenario === "supervisor" && parsed.data.authorized !== "1") {
        renderError(
          response,
          403,
          "Supervisor authorization required",
          "A supervisor must authorize this reversal before review.",
        );
        return;
      }

      const reference = `REV-${MEMBER.accountLast4}-${parsed.data.amount.replace(".", "")}`;
      response.render("review", {
        member: MEMBER,
        amount: parsed.data.amount,
        reason: parsed.data.reason,
        reference,
      });
    },
  );

  app.post("/servicing/submit-reversal", (_request, response) => {
    response.status(200).render("submitted");
  });

  app.use((_request, response) => {
    renderError(response, 404, "Page not found", "The requested servicing page does not exist.");
  });

  return app;
}
