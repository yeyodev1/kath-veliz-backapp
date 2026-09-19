import { Request, Response, NextFunction } from "express";
import * as serviceRequestService from "../services/serviceRequest.service";

/** POST /api/service-requests — body: { productSlug, name, email, phone, answers[] } */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await serviceRequestService.createServiceRequest(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/service-requests?status= */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await serviceRequestService.listServiceRequests(req.query));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/service-requests/:id/approve — body: { adminNote? } */
export async function approve(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json(
        await serviceRequestService.approveServiceRequest(String(req.params.id), req.body ?? {}),
      );
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/service-requests/:id/reject — body: { adminNote? } */
export async function reject(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json(
        await serviceRequestService.rejectServiceRequest(String(req.params.id), req.body ?? {}),
      );
  } catch (error) {
    next(error);
  }
}
