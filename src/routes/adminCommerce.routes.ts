import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import * as adminCommerceController from "../controllers/adminCommerce.controller";

const router = Router();

// Se monta en la raíz de /api: los gates van por ruta, no con router.use.
const admin = [authMiddleware, adminMiddleware];

router.get("/admin/stats", admin, adminCommerceController.stats);
router.get("/admin/orders", admin, adminCommerceController.orders);
router.get("/admin/students", admin, adminCommerceController.students);

router.post("/admin/access", admin, adminCommerceController.grantAccess);
router.get("/admin/access", admin, adminCommerceController.listAccess);
router.patch("/admin/access/:id", admin, adminCommerceController.updateAccess);
router.post("/admin/access/:id/revoke", admin, adminCommerceController.revokeAccess);

export default router;
