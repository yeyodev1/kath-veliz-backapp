import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import * as productController from "../controllers/product.controller";
import * as contentController from "../controllers/content.controller";
import * as uploadController from "../controllers/upload.controller";
import * as liveSessionController from "../controllers/liveSession.controller";
import * as couponController from "../controllers/coupon.controller";
import * as leadController from "../controllers/lead.controller";
import * as serviceRequestController from "../controllers/serviceRequest.controller";

/**
 * Panel: catálogo y contenido. Se monta sin prefijo: router.use(adminContentRoutes).
 *
 * El guard va por ruta y no con router.use(): este router comparte el prefijo
 * /admin con otros, y un use() global respondería 401 a rutas que no son suyas.
 */
const router = Router();
const admin = [authMiddleware, adminMiddleware];

router.get("/admin/products", admin, productController.listAdmin);
router.post("/admin/products", admin, productController.create);
router.get("/admin/products/:id", admin, productController.getAdmin);
router.patch("/admin/products/:id", admin, productController.update);
router.delete("/admin/products/:id", admin, productController.remove);

router.get("/admin/products/:id/content", admin, contentController.getContent);
router.put("/admin/products/:id/order", admin, contentController.reorder);
router.post("/admin/products/:id/modules", admin, contentController.createModule);
router.patch("/admin/modules/:id", admin, contentController.updateModule);
router.delete("/admin/modules/:id", admin, contentController.removeModule);
router.post("/admin/modules/:id/lessons", admin, contentController.createLesson);
router.patch("/admin/lessons/:id", admin, contentController.updateLesson);
router.delete("/admin/lessons/:id", admin, contentController.removeLesson);

router.post("/admin/lessons/:id/video", admin, contentController.createVideo);
router.get("/admin/lessons/:id/video-status", admin, contentController.videoStatus);

// El guard va antes de multer: nadie sin sesión llega a subir bytes.
router.post(
  "/admin/uploads/image",
  admin,
  uploadController.receiveFile,
  uploadController.uploadImage,
);
router.post(
  "/admin/uploads/file",
  admin,
  uploadController.receiveFile,
  uploadController.uploadFile,
);

router.get("/admin/live-sessions", admin, liveSessionController.list);
router.post("/admin/live-sessions", admin, liveSessionController.create);
router.patch("/admin/live-sessions/:id", admin, liveSessionController.update);
router.delete("/admin/live-sessions/:id", admin, liveSessionController.remove);
router.post("/admin/live-sessions/:id/notify", admin, liveSessionController.notify);

router.get("/admin/coupons", admin, couponController.list);
router.post("/admin/coupons", admin, couponController.create);
router.patch("/admin/coupons/:id", admin, couponController.update);
router.delete("/admin/coupons/:id", admin, couponController.remove);

// export.csv va antes de cualquier ruta con :id que se agregue a /admin/leads.
router.get("/admin/leads/export.csv", admin, leadController.exportCsv);
router.get("/admin/leads", admin, leadController.list);

router.get("/admin/service-requests", admin, serviceRequestController.list);
router.post("/admin/service-requests/:id/approve", admin, serviceRequestController.approve);
router.post("/admin/service-requests/:id/reject", admin, serviceRequestController.reject);

export default router;
