import { Request, Response, NextFunction } from "express";
import * as liveSessionService from "../services/liveSession.service";

/** GET /api/admin/live-sessions?product= */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await liveSessionService.listLiveSessions(req.query.product));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/live-sessions — body: { product, title, description?, startsAt, meetUrl? } */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await liveSessionService.createLiveSession(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PATCH /api/admin/live-sessions/:id */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json(await liveSessionService.updateLiveSession(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/live-sessions/:id */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await liveSessionService.deleteLiveSession(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/live-sessions/:id/notify → { sent } */
export async function notify(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await liveSessionService.notifyLiveSession(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}
