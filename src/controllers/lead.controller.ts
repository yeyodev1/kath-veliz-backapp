import { Request, Response, NextFunction } from "express";
import * as leadService from "../services/lead.service";

/** POST /api/leads — body: { name, email, phone?, source, productSlug?, kind } */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await leadService.createLead(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/leads?source=&kind=&page= */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await leadService.listLeads(req.query));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/leads/export.csv?source=&kind= */
export async function exportCsv(req: Request, res: Response, next: NextFunction) {
  try {
    const csv = await leadService.exportLeadsCsv(req.query);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="leads-${date}.csv"`);
    res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
}
