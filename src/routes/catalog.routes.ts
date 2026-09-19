import { Router } from "express";
import * as productController from "../controllers/product.controller";
import * as leadController from "../controllers/lead.controller";
import * as serviceRequestController from "../controllers/serviceRequest.controller";
import * as couponController from "../controllers/coupon.controller";

// Rutas públicas del catálogo. Se montan sin prefijo: router.use(catalogRoutes).
const router = Router();

router.get("/products", productController.listPublic);
router.get("/products/:slug", productController.getPublic);

router.post("/leads", leadController.create);
router.post("/service-requests", serviceRequestController.create);
router.post("/coupons/validate", couponController.validate);

export default router;
