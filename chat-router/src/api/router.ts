import { Router, Request, Response } from "express";
import type { IChatRouterService, Platform } from "../types";
import { triggerAcsJob, AcsTriggerConfig } from "../acs/trigger";

/**
 * Creates an Express Router that maps HTTP endpoints to IChatRouterService
 * methods. The service is injected as a parameter.
 */
export function createApiRouter(
  service: IChatRouterService,
  acsConfig?: AcsTriggerConfig,
): Router {
  const router = Router();

  // POST /messages — ingest an inbound message, then trigger ACS
  router.post("/messages", async (req: Request, res: Response) => {
    try {
      const entry = service.ingestMessage(req.body);

      // Trigger ACS job before returning — plugin thumbs-up gates on this
      if (acsConfig) {
        await triggerAcsJob(acsConfig, entry);
      }

      res.status(201).json(entry);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /responses — record an outbound response
  router.post("/responses", (req: Request, res: Response) => {
    try {
      const entry = service.recordResponse(req.body);
      res.status(201).json(entry);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // GET /timeline/:platform/:chatId — timeline for a specific conversation
  router.get("/timeline/:platform/:chatId", (req: Request, res: Response) => {
    const platform = req.params.platform as string;
    const chatId = req.params.chatId as string;
    const after = req.query.after ? Number(req.query.after) : undefined;
    const before = req.query.before ? Number(req.query.before) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const entries = service.getTimeline({
      platform: platform as Platform,
      platformChatId: chatId,
      after,
      before,
      limit,
    });

    res.status(200).json(entries);
  });

  // GET /timeline — unified timeline across all platforms
  router.get("/timeline", (req: Request, res: Response) => {
    const after = req.query.after ? Number(req.query.after) : undefined;
    const before = req.query.before ? Number(req.query.before) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const entries = service.getUnifiedTimeline({ after, before, limit });
    res.status(200).json(entries);
  });

  // GET /conversations — list conversations
  router.get("/conversations", (req: Request, res: Response) => {
    const platform = req.query.platform
      ? (req.query.platform as Platform)
      : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const convos = service.listConversations({ platform, limit });
    res.status(200).json(convos);
  });

  // GET /conversations/:platform/:chatId — single conversation
  router.get(
    "/conversations/:platform/:chatId",
    (req: Request, res: Response) => {
      const platform = req.params.platform as string;
      const chatId = req.params.chatId as string;
      const convo = service.getConversation(
        platform as Platform,
        chatId,
      );

      if (!convo) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }

      res.status(200).json(convo);
    },
  );

  // GET /health — health check
  router.get("/health", (_req: Request, res: Response) => {
    const health = service.healthCheck();
    res.status(200).json(health);
  });

  return router;
}
