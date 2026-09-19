import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as orderController from "../controllers/order.controller";

const router = Router();

// Se monta en la raíz de /api: el auth va por ruta, no con router.use.
router.post("/orders", authMiddleware, orderController.create);
router.post("/orders/confirm", authMiddleware, orderController.confirm);

export default router;
