import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as authController from "../controllers/auth.controller";

const router = Router();

router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);

router.use(authMiddleware);

router.get("/me", authController.me);
router.put("/me", authController.updateMe);
router.put("/password", authController.changePassword);

export default router;
