import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import type { IChatRouterService } from "../types";
import { createApiRouter } from "./router";

/**
 * Factory function that creates an Express app wired to the given service.
 * Returns the app WITHOUT calling .listen() so it can be used with supertest.
 */
export function createServer(service: IChatRouterService): Express {
  const app = express();

  // Allow cross-origin requests from any origin
  app.use(cors());

  // Parse JSON request bodies
  app.use(express.json());

  // Mount the API router at /api
  app.use("/api", createApiRouter(service));

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
