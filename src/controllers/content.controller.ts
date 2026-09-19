import { Request, Response, NextFunction } from "express";
import * as contentService from "../services/content.service";

/** GET /api/admin/products/:id/content */
export async function getContent(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await contentService.getAdminContent(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/products/:id/order — body: { modules: [{ id, lessons: [id] }] } */
export async function reorder(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json(await contentService.reorderContent(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/products/:id/modules */
export async function createModule(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await contentService.createModule(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PATCH /api/admin/modules/:id */
export async function updateModule(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await contentService.updateModule(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/modules/:id — borra también sus lecciones. */
export async function removeModule(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await contentService.deleteModule(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/modules/:id/lessons */
export async function createLesson(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await contentService.createLesson(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PATCH /api/admin/lessons/:id */
export async function updateLesson(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await contentService.updateLesson(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/lessons/:id */
export async function removeLesson(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await contentService.deleteLesson(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/lessons/:id/video — body: { title? }. Devuelve la firma TUS. */
export async function createVideo(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(201)
      .json(await contentService.createLessonVideo(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/lessons/:id/video-status */
export async function videoStatus(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await contentService.getLessonVideoStatus(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}
