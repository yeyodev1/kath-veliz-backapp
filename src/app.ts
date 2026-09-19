import express from "express";
import cors from "cors";
import http from "http";
import routerApi from "./routes";
import { env } from "./config/env";
import { globalErrorHandler } from "./middlewares/globalErrorHandler.middleware";

const whitelist = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://localhost:8100",
  "http://localhost:8101",
  // "https://cliente.com",
  // "https://www.cliente.com",
  ...env.CORS_ORIGINS,
];

/** Previews de Vercel y túneles de desarrollo: permitidos. */
const allowedPatterns: RegExp[] = [
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
  /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i,
  /^https:\/\/[a-z0-9-]+\.bakano\.ec$/i,
];

function isOriginAllowed(origin: string): boolean {
  if (whitelist.includes(origin)) return true;
  return allowedPatterns.some((p) => p.test(origin));
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Sin Origin (curl, server-to-server, Vercel Cron) se deja pasar.
    if (!origin || isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

export function createApp() {
  const app = express();

  app.use(cors(corsOptions));
  // Vercel corta cualquier cuerpo de más de ~4.5 MB antes de llegar aquí. Ningún JSON del
  // API se acerca a eso: los archivos suben directo a Cloudinary y los videos a Bunny.
  app.use(express.json({ limit: "4mb" }));

  app.get("/", (_req, res) => {
    res.send("Server is alive");
  });

  routerApi(app);

  app.use(globalErrorHandler);

  const server = http.createServer(app);

  return { app, server };
}
