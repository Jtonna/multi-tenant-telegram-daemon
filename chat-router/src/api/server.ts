import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import type { IChatRouterService } from "../types";
import type { AcsTriggerConfig } from "../acs/trigger";
import { createApiRouter } from "./router";

/**
 * Factory function that creates an Express app wired to the given service.
 * Returns the app WITHOUT calling .listen() so it can be used with supertest.
 */
export function createServer(
  service: IChatRouterService,
  acsConfig?: AcsTriggerConfig,
): Express {
  const app = express();

  // Allow cross-origin requests from any origin
  app.use(cors());

  // Parse JSON request bodies
  app.use(express.json());

  // Request logger
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const { method, url } = req;

    // Log request
    if (req.body && Object.keys(req.body).length > 0) {
      const summary = method === "POST" && req.body.text
        ? `"${req.body.text.slice(0, 80)}"`
        : JSON.stringify(req.body).slice(0, 120);
      console.log(`[api] --> ${method} ${url} ${summary}`);
    } else {
      console.log(`[api] --> ${method} ${url}`);
    }

    // Log response
    res.on("finish", () => {
      const ms = Date.now() - start;
      console.log(`[api] <-- ${method} ${url} ${res.statusCode} ${ms}ms`);
    });

    next();
  });

  // Mount the API router at /api
  app.use("/api", createApiRouter(service, acsConfig));

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
