import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as orderService from "../services/order.service";
import * as studentService from "../services/student.service";

/** GET /api/me/products — productos de la alumna con su acceso y su avance. */
export async function myProducts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    res.status(200).json(await studentService.listMyProducts(req.user.userId));
  } catch (error) {
    next(error);
  }
}

/** GET /api/me/products/:slug — 403 si no hay acceso vigente. */
export async function myProduct(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    res.status(200).json(await studentService.getMyProduct(req.user, String(req.params.slug)));
  } catch (error) {
    next(error);
  }
}

/** GET /api/me/products/:slug/download — { url, filename } con URL firmada. */
export async function download(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    res.status(200).json(await studentService.getDownload(req.user, String(req.params.slug)));
  } catch (error) {
    next(error);
  }
}

/** GET /api/me/orders */
export async function myOrders(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    res.status(200).json(await orderService.listMyOrders(req.user.userId));
  } catch (error) {
    next(error);
  }
}

/** GET /api/lessons/:id/playback — sesión opcional: la clase de muestra es pública. */
export async function playback(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await studentService.getPlayback(req.user, String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/lessons/:id/progress — body: { positionSeconds, completed? } */
export async function progress(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    const { positionSeconds, completed } = req.body ?? {};
    const result = await studentService.saveProgress(req.user, String(req.params.id), {
      positionSeconds,
      completed,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
