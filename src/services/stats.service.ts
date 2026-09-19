import { Access } from "../models/access.model";
import { Lead } from "../models/lead.model";
import { Order } from "../models/order.model";
import { ServiceRequest } from "../models/serviceRequest.model";
import { User } from "../models/user.model";
import { accessStatus, statusFilter } from "./access.service";

const PAGE_SIZE = 20;

/** GET /admin/stats. Números del tablero; las ventas son solo órdenes pagadas. */
export async function getStats() {
  const [sales, students, leads, pendingRequests, activeAccesses] = await Promise.all([
    Order.aggregate([
      { $match: { status: "paid" } },
      { $group: { _id: null, salesCents: { $sum: "$totalCents" }, ordersPaid: { $sum: 1 } } },
    ]),
    User.countDocuments({ accountType: "customer" }),
    Lead.countDocuments({}),
    ServiceRequest.countDocuments({ status: "pending" }),
    Access.countDocuments(statusFilter("vigente")),
  ]);

  return {
    salesCents: sales[0]?.salesCents ?? 0,
    ordersPaid: sales[0]?.ordersPaid ?? 0,
    students,
    leads,
    pendingRequests,
    activeAccesses,
  };
}

/** GET /admin/students?search=&page= — cuentas customer con sus accesos. */
export async function listStudents(query: { search?: unknown; page?: unknown }) {
  const filter: Record<string, unknown> = { accountType: "customer" };
  const search = String(query.search ?? "").trim();
  if (search) {
    const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ email: pattern }, { name: pattern }, { phone: pattern }];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    User.countDocuments(filter),
  ]);

  const accesses = await Access.find({ user: { $in: users.map((user: any) => user._id) } })
    .sort({ createdAt: -1 })
    .populate("product", "slug title type")
    .lean();

  return {
    items: users.map((user: any) => ({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      phone: user.phone,
      documentId: user.documentId || "",
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      accesses: accesses
        .filter((access) => access.user.toString() === user._id.toString())
        .map((access: any) => ({
          id: access._id.toString(),
          product:
            access.product && access.product.slug
              ? {
                  id: access.product._id.toString(),
                  slug: access.product.slug,
                  title: access.product.title,
                  type: access.product.type,
                }
              : null,
          source: access.source,
          note: access.note,
          status: accessStatus(access),
          expiresAt: access.expiresAt,
          revokedAt: access.revokedAt,
        })),
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}
