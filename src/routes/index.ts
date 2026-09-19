import express, { Application } from "express";
import adminCommerceRoutes from "./adminCommerce.routes";
import authRoutes from "./auth.routes";
import healthRoutes from "./health.routes";
import learningRoutes from "./learning.routes";
import orderRoutes from "./order.routes";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  router.use("/health", healthRoutes);
  router.use("/auth", authRoutes);

  // Estos routers declaran sus rutas completas y aplican los middlewares por ruta,
  // así pueden convivir en la raíz sin cerrarle el paso a las rutas públicas.
  router.use(learningRoutes);
  router.use(orderRoutes);
  router.use(adminCommerceRoutes);
}

export default routerApi;
