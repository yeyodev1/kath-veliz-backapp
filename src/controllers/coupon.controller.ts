import { Request, Response, NextFunction } from "express";
import * as couponService from "../services/coupon.service";
import * as productService from "../services/product.service";

/** POST /api/coupons/validate — body: { code, productSlug } */
export async function validate(req: Request, res: Response, next: NextFunction) {
  try {
    const { code, productSlug } = req.body ?? {};
    const product = await productService.findPublishedBySlug(productSlug);
    res.status(200).json(await couponService.validateCoupon(code, product));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/coupons */
export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await couponService.listCoupons());
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/coupons */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await couponService.createCoupon(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PATCH /api/admin/coupons/:id */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await couponService.updateCoupon(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/coupons/:id */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await couponService.deleteCoupon(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}
