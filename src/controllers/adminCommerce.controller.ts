import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as accessService from "../services/access.service";
import * as orderService from "../services/order.service";
import * as statsService from "../services/stats.service";

/** GET /api/admin/stats */
export async function stats(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await statsService.getStats());
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/orders?status=&page= */
export async function orders(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status, page } = req.query;
    res.status(200).json(await orderService.listOrders({ status, page }));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/students?search=&page= */
export async function students(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { search, page } = req.query;
    res.status(200).json(await statsService.listStudents({ search, page }));
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/admin/access — body: { email, name?, productIds[], expiresAt, note }
 * `expiresAt` pasa tal cual: el service distingue entre null explícito y ausente.
 */
export async function grantAccess(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    const body = req.body ?? {};
    const result = await accessService.grantManual({
      email: body.email,
      name: body.name,
      productIds: body.productIds,
      expiresAt: body.expiresAt,
      note: body.note,
      adminId: req.user.userId,
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/access?product=&user=&search=&status=&page= */
export async function listAccess(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { product, user, search, status, page } = req.query;
    res
      .status(200)
      .json(await accessService.listAccesses({ product, user, search, status, page }));
  } catch (error) {
    next(error);
  }
}

/** PATCH /api/admin/access/:id — body: { expiresAt } (fecha futura o null explícito) */
export async function updateAccess(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await accessService.updateExpiry(String(req.params.id), req.body?.expiresAt);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/access/:id/revoke */
export async function revokeAccess(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await accessService.revokeAccess(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}
