import { Request, Response, NextFunction } from "express";
import * as productService from "../services/product.service";

/** GET /api/products?type= — catálogo público, solo publicados. */
export async function listPublic(req: Request, res: Response, next: NextFunction) {
  try {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    res.status(200).json(await productService.listPublicProducts(type));
  } catch (error) {
    next(error);
  }
}

/** GET /api/products/:slug — detalle público con temario y próximas clases. */
export async function getPublic(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.getPublicProduct(String(req.params.slug)));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/products — incluye los no publicados. */
export async function listAdmin(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.listAdminProducts());
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/products */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await productService.createProduct(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PATCH /api/admin/products/:id */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.updateProduct(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/products/:id — borra también módulos, lecciones y clases. */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.deleteProduct(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}
