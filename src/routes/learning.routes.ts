import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { optionalAuthMiddleware } from "../middlewares/optionalAuth.middleware";
import * as learningController from "../controllers/learning.controller";

const router = Router();

// Este router se monta en la raíz de /api: el auth va por ruta, nunca con
// router.use, para no cerrarle el paso a las rutas públicas de otros routers.
router.get("/me/products", authMiddleware, learningController.myProducts);
router.get("/me/products/:slug", authMiddleware, learningController.myProduct);
router.get("/me/products/:slug/download", authMiddleware, learningController.download);
router.get("/me/orders", authMiddleware, learningController.myOrders);

router.get("/lessons/:id/playback", optionalAuthMiddleware, learningController.playback);
router.post("/lessons/:id/progress", authMiddleware, learningController.progress);

export default router;
