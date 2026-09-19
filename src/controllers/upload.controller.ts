import path from "path";
import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { CustomError } from "../errors/customError.error";
import { uploadMiddleware } from "../middlewares/upload.middleware";
import * as cloudinaryService from "../services/cloudinary.service";

const FILE_EXTENSIONS = [
  ".pdf",
  ".xlsx",
  ".xls",
  ".xlsm",
  ".csv",
  ".docx",
  ".doc",
  ".pptx",
  ".ppt",
  ".zip",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
];

/**
 * Recibe el campo `file`. Envuelve a multer para que un archivo demasiado
 * grande responda 400 con un mensaje claro y no un 500.
 */
export function receiveFile(req: Request, res: Response, next: NextFunction) {
  uploadMiddleware.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "El archivo pesa demasiado. El máximo es 10 MB."
          : "No se pudo recibir el archivo. Envíalo en el campo file.";
      next(new CustomError(message, 400));
      return;
    }
    next(error);
  });
}

/** multer lee el nombre como latin1: sin esto "Presupuesto básico" llega con símbolos. */
function originalName(file: Express.Multer.File): string {
  return Buffer.from(file.originalname, "latin1").toString("utf8");
}

/** POST /api/admin/uploads/image — multipart `file` → { url, publicId } */
export async function uploadImage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new CustomError("Adjunta una imagen en el campo file", 400);
    if (!req.file.mimetype.startsWith("image/")) {
      throw new CustomError("El archivo debe ser una imagen", 400);
    }
    const result = await cloudinaryService.uploadBuffer(
      req.file.buffer,
      cloudinaryService.PRODUCT_IMAGES_FOLDER,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/uploads/file — multipart `file` (+ `private=true`) → { url, publicId, filename } */
export async function uploadFile(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new CustomError("Adjunta un archivo en el campo file", 400);
    const filename = originalName(req.file);
    if (!FILE_EXTENSIONS.includes(path.extname(filename).toLowerCase())) {
      throw new CustomError(
        "Ese tipo de archivo no está permitido. Sube un PDF, Excel, Word, PowerPoint, zip o imagen.",
        400,
      );
    }
    const isPrivate = String(req.body?.private ?? req.query.private ?? "") === "true";
    const result = await cloudinaryService.uploadRaw(req.file.buffer, filename, { isPrivate });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}
