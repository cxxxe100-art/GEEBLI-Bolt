import { and, count, desc, eq, ne, sum } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  orderItemsTable,
  ordersTable,
  productsTable,
  sellersTable,
} from "@workspace/db";
import {
  DecideSellerApplicationBody,
  DecideSellerApplicationParams,
  DecideSellerApplicationResponse,
  GetAdminSummaryResponse,
  ListAdminOrdersResponse,
  ListAdminSellersResponse,
} from "@workspace/api-zod";
import { requireMarketplaceAdmin } from "../middlewares/marketplaceAuth";

const router: IRouter = Router();
router.use("/admin", requireMarketplaceAdmin);

async function loadOrder(orderId: number) {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);
  if (!order) return undefined;
  const items = await db
    .select()
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, orderId));
  return {
    ...order,
    total: Number(order.total),
    items: items.map((item) => ({
      ...item,
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
    })),
  };
}

router.get("/admin/summary", async (_req, res): Promise<void> => {
  const [
    sellerCount,
    pendingCount,
    productCount,
    orderCount,
    openCount,
    revenueTotal,
  ] = await Promise.all([
    db.select({ value: count() }).from(sellersTable),
    db
      .select({ value: count() })
      .from(sellersTable)
      .where(eq(sellersTable.status, "pending")),
    db
      .select({ value: count() })
      .from(productsTable)
      .where(eq(productsTable.active, true)),
    db.select({ value: count() }).from(ordersTable),
    db
      .select({ value: count() })
      .from(ordersTable)
      .where(
        and(
          ne(ordersTable.status, "delivered"),
          ne(ordersTable.status, "cancelled"),
        ),
      ),
    db
      .select({ value: sum(ordersTable.total) })
      .from(ordersTable)
      .where(ne(ordersTable.status, "cancelled")),
  ]);
  res.json(
    GetAdminSummaryResponse.parse({
      totalSellers: sellerCount[0]?.value ?? 0,
      pendingSellers: pendingCount[0]?.value ?? 0,
      totalProducts: productCount[0]?.value ?? 0,
      totalOrders: orderCount[0]?.value ?? 0,
      openOrders: openCount[0]?.value ?? 0,
      revenue: Number(revenueTotal[0]?.value ?? 0),
    }),
  );
});

router.get("/admin/sellers", async (_req, res): Promise<void> => {
  const sellers = await db
    .select()
    .from(sellersTable)
    .orderBy(desc(sellersTable.createdAt));
  res.json(ListAdminSellersResponse.parse(sellers));
});

router.patch("/admin/sellers/:id/decision", async (req, res): Promise<void> => {
  const params = DecideSellerApplicationParams.safeParse(req.params);
  const body = DecideSellerApplicationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success
        ? params.error.message
        : !body.success
          ? body.error.message
          : "البيانات غير صالحة.",
    });
    return;
  }
  const [seller] = await db
    .update(sellersTable)
    .set({ status: body.data.status })
    .where(eq(sellersTable.id, params.data.id))
    .returning();
  if (!seller) {
    res.status(404).json({ error: "طلب البائع غير موجود." });
    return;
  }
  res.json(DecideSellerApplicationResponse.parse(seller));
});

router.get("/admin/orders", async (_req, res): Promise<void> => {
  const orders = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .orderBy(desc(ordersTable.createdAt));
  const hydrated = await Promise.all(orders.map(({ id }) => loadOrder(id)));
  res.json(ListAdminOrdersResponse.parse(hydrated.filter(Boolean)));
});

export default router;
