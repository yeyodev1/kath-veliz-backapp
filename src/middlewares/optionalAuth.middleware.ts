import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AuthRequest, JwtPayload } from "../types/AuthRequest";

/**
 * Lee el Bearer si viene, pero nunca corta la petición. Es para rutas que
 * sirven a visitantes y a alumnas a la vez (la clase de muestra): el service
 * decide qué hacer cuando no hay sesión.
 */
export function optionalAuthMiddleware(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      req.user = jwt.verify(authHeader.split(" ")[1], env.JWT_SECRET) as JwtPayload;
    } catch {
      // Un token vencido equivale a no tener sesión.
    }
  }

  next();
}
