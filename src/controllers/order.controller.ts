import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as orderService from "../services/order.service";

/** POST /api/orders — body: { productSlug, couponCode?, phone, documentId, serviceRequestId? } */
export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    const { productSlug, couponCode, phone, documentId, serviceRequestId } = req.body ?? {};
    const result = await orderService.createOrder(req.user.userId, {
      productSlug,
      couponCode,
      phone,
      documentId,
      serviceRequestId,
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/** POST /api/orders/confirm — body: { id, clientTransactionId }. Idempotente. */
export async function confirm(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    const { id, clientTransactionId } = req.body ?? {};
    const result = await orderService.confirmOrder(req.user.userId, { id, clientTransactionId });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
