import { clerkClient } from "@clerk/express";
import { and, desc, eq, gt, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import {
  db,
  buyerAccountsTable,
  orderItemsTable,
  ordersTable,
  chatsTable,
  productsTable,
  sellersTable,
} from "@workspace/db";
import {
  ApplyAsSellerBody,
  ApplyAsSellerResponse,
  CreateOrderBody,
  CreateOrderResponse,
  CreateSellerProductBody,
  CreateSellerProductResponse,
  DeleteSellerProductParams,
  GetProductParams,
  GetProductResponse,
  GetSellerProfileResponse,
  ListProductsQueryParams,
  ListProductsResponse,
  ListSellerOrdersResponse,
  ListSellerProductsResponse,
  UpdateSellerProductBody,
  UpdateSellerProductParams,
  UpdateSellerProductResponse,
  UpdateOrderStatusBody,
  UpdateOrderStatusParams,
  UpdateOrderStatusResponse,
} from "@workspace/api-zod";
import {
  getActorId,
  getSeller,
  requireApprovedSeller,
  requireMarketplaceUser,
} from "../middlewares/marketplaceAuth";

const router: IRouter = Router();

function normalizeBuyerPhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `249${digits.slice(1)}`;
  return digits;
}

function hashBuyerPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyBuyerPin(pin: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(pin, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function authenticateBuyer(phone: string, pin: string, allowCreate = true) {
  const normalizedPhone = normalizeBuyerPhone(phone);
  if (normalizedPhone.length < 9 || normalizedPhone.length > 15 || !/^\d{6}$/.test(pin)) {
    return { ok: false as const, status: 400, error: "أدخل رقم هاتف صحيحاً ورمزاً من 6 أرقام." };
  }

  return db.transaction(async (tx) => {
    let [account] = await tx
      .select()
      .from(buyerAccountsTable)
      .where(eq(buyerAccountsTable.phone, normalizedPhone))
      .for("update")
      .limit(1);

    if (!account) {
      if (!allowCreate) {
        return { ok: false as const, status: 401, error: "رقم الهاتف أو الرمز غير صحيح." };
      }
      const [created] = await tx
        .insert(buyerAccountsTable)
        .values({ phone: normalizedPhone, pinHash: hashBuyerPin(pin) })
        .onConflictDoNothing()
        .returning();
      if (created) return { ok: true as const, account: created };

      [account] = await tx
        .select()
        .from(buyerAccountsTable)
        .where(eq(buyerAccountsTable.phone, normalizedPhone))
        .for("update")
        .limit(1);
      if (!account) {
        return { ok: false as const, status: 500, error: "تعذّر إنشاء حساب الطلبات." };
      }
    }

    const now = new Date();
    if (account.lockedUntil && account.lockedUntil > now) {
      const minutes = Math.max(1, Math.ceil((account.lockedUntil.getTime() - now.getTime()) / 60000));
      return { ok: false as const, status: 429, error: `تم إيقاف المحاولة مؤقتاً. حاول بعد ${minutes} دقيقة.` };
    }

    // Reset an expired lock before counting a new attempt.
    if (account.lockedUntil && account.lockedUntil <= now) {
      const [unlocked] = await tx
        .update(buyerAccountsTable)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(eq(buyerAccountsTable.id, account.id))
        .returning();
      if (unlocked) account = unlocked;
    }

    if (!verifyBuyerPin(pin, account.pinHash)) {
      // Let PostgreSQL count attempts and calculate the lock expiry atomically.
      const [updated] = await tx
        .update(buyerAccountsTable)
        .set({
          failedAttempts: sql`LEAST(${buyerAccountsTable.failedAttempts} + 1, 5)`,
          lockedUntil: sql`CASE
            WHEN ${buyerAccountsTable.failedAttempts} + 1 >= 5
              THEN NOW() + INTERVAL '15 minutes'
            ELSE NULL
          END`,
        })
        .where(eq(buyerAccountsTable.id, account.id))
        .returning({
          failedAttempts: buyerAccountsTable.failedAttempts,
          lockedUntil: buyerAccountsTable.lockedUntil,
        });
      const shouldLock = Boolean(
        updated?.lockedUntil && updated.lockedUntil.getTime() > Date.now(),
      );
      logger.warn(
        { phoneSuffix: normalizedPhone.slice(-4), failedAttempts: updated?.failedAttempts ?? null, locked: shouldLock },
        "Buyer PIN verification failed",
      );
      return {
        ok: false as const,
        status: shouldLock ? 429 : 401,
        error: shouldLock
          ? "تم إيقاف المحاولة 15 دقيقة بسبب تكرار الرمز الخطأ."
          : `الرمز غير صحيح. المحاولات المتبقية: ${Math.max(0, 5 - (updated?.failedAttempts ?? 0))}.`,
      };
    }

    if (account.failedAttempts || account.lockedUntil) {
      await tx
        .update(buyerAccountsTable)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(eq(buyerAccountsTable.id, account.id));
    }
    return { ok: true as const, account };
  });
}

function productView(
  product: typeof productsTable.$inferSelect,
  sellerName: string,
) {
  return {
    ...product,
    sellerName,
    price: Number(product.price),
  };
}

async function loadOrder(orderId: number, sellerId?: number) {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);
  if (!order) return undefined;

  const lineQuery = db
    .select()
    .from(orderItemsTable)
    .where(
      sellerId === undefined
        ? eq(orderItemsTable.orderId, orderId)
        : and(
            eq(orderItemsTable.orderId, orderId),
            eq(orderItemsTable.sellerId, sellerId),
          ),
    );
  const lines = await lineQuery;
  return {
    ...order,
    total: Number(order.total),
    items: lines.map((line) => ({
      ...line,
      unitPrice: Number(line.unitPrice),
      lineTotal: Number(line.lineTotal),
    })),
  };
}

router.get("/products", async (req, res): Promise<void> => {
  const query = ListProductsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const filters = [
    eq(productsTable.active, true),
    eq(sellersTable.status, "approved"),
    gt(sellersTable.subscriptionExpiresAt, new Date()),
  ];
  if (query.data.category) {
    filters.push(eq(productsTable.category, query.data.category));
  }
  if (query.data.q) {
    const search = `%${query.data.q}%`;
    filters.push(
      or(
        ilike(productsTable.title, search),
        ilike(productsTable.description, search),
        ilike(productsTable.category, search),
      )!,
    );
  }

  const rows = await db
    .select({ product: productsTable, sellerName: sellersTable.storeName })
    .from(productsTable)
    .innerJoin(sellersTable, eq(productsTable.sellerId, sellersTable.id))
    .where(and(...filters))
    .orderBy(desc(productsTable.createdAt))
    .limit(query.data.limit ?? 24);
  res.json(
    ListProductsResponse.parse(
      rows.map(({ product, sellerName }) => productView(product, sellerName)),
    ),
  );
});

router.get("/products/:id", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .select({ product: productsTable, sellerName: sellersTable.storeName })
    .from(productsTable)
    .innerJoin(sellersTable, eq(productsTable.sellerId, sellersTable.id))
    .where(
      and(
        eq(productsTable.id, params.data.id),
        eq(productsTable.active, true),
        eq(sellersTable.status, "approved"),
        gt(sellersTable.subscriptionExpiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "المنتج غير موجود." });
    return;
  }
  res.json(GetProductResponse.parse(productView(row.product, row.sellerName)));
});

router.get(
  "/seller/profile",
  requireMarketplaceUser,
  async (req, res): Promise<void> => {
    const [seller] = await db
      .select()
      .from(sellersTable)
      .where(eq(sellersTable.clerkUserId, getActorId(req)))
      .limit(1);
    if (!seller) {
      res.status(404).json({ error: "لا يوجد طلب بائع لهذا الحساب." });
      return;
    }
    res.json(GetSellerProfileResponse.parse(seller));
  },
);

router.post(
  "/seller/profile",
  requireMarketplaceUser,
  async (req, res): Promise<void> => {
    const body = ApplyAsSellerBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const userId = getActorId(req);
    try {
      const [existing] = await db
        .select()
        .from(sellersTable)
        .where(eq(sellersTable.clerkUserId, userId))
        .limit(1);
      if (existing) {
        res.status(200).json(ApplyAsSellerResponse.parse(existing));
        return;
      }

      const user = await clerkClient.users.getUser(userId);
      const email =
        user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
      // Phone-only Clerk accounts are valid seller applicants.
      const sellerEmail = email ?? "";
      const [seller] = await db
        .insert(sellersTable)
        .values({ ...body.data, clerkUserId: userId, email: sellerEmail })
        .onConflictDoNothing({ target: sellersTable.clerkUserId })
        .returning();

      if (seller) {
        res.status(201).json(ApplyAsSellerResponse.parse(seller));
        return;
      }

      // A second request may have arrived for the same Clerk user concurrently.
      const [createdByConcurrentRequest] = await db
        .select()
        .from(sellersTable)
        .where(eq(sellersTable.clerkUserId, userId))
        .limit(1);
      if (createdByConcurrentRequest) {
        res.status(200).json(ApplyAsSellerResponse.parse(createdByConcurrentRequest));
        return;
      }

      logger.error({ actorId: userId }, "Seller application insert returned no row");
      res.status(503).json({ error: "تعذّر حفظ طلب المتجر حالياً. حاول مرة أخرى بعد قليل." });
    } catch (error) {
      logger.error({ err: error, actorId: userId }, "Seller application submission failed");
      res.status(503).json({
        error: "خدمة تسجيل البائعين غير متاحة حالياً. لم يتم تسجيل الطلب؛ حاول مرة أخرى لاحقاً.",
      });
    }
  },
);

router.get(
  "/seller/products",
  requireMarketplaceUser,
  requireApprovedSeller,
  async (req, res): Promise<void> => {
    const seller = getSeller(req)!;
    const rows = await db
      .select({ product: productsTable, sellerName: sellersTable.storeName })
      .from(productsTable)
      .innerJoin(sellersTable, eq(productsTable.sellerId, sellersTable.id))
      .where(eq(productsTable.sellerId, seller.id))
      .orderBy(desc(productsTable.createdAt));
    res.json(
      ListSellerProductsResponse.parse(
        rows.map(({ product, sellerName }) => productView(product, sellerName)),
      ),
    );
  },
);

router.post(
  "/seller/products",
  requireMarketplaceUser,
  requireApprovedSeller,
  async (req, res): Promise<void> => {
    const body = CreateSellerProductBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const seller = getSeller(req)!;
    const [product] = await db
      .insert(productsTable)
      .values({ ...body.data, sellerId: seller.id })
      .returning();
    res
      .status(201)
      .json(CreateSellerProductResponse.parse(productView(product, seller.storeName)));
  },
);

router.patch(
  "/seller/products/:id",
  requireMarketplaceUser,
  requireApprovedSeller,
  async (req, res): Promise<void> => {
    const params = UpdateSellerProductParams.safeParse(req.params);
    const body = UpdateSellerProductBody.safeParse(req.body);
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
    const seller = getSeller(req)!;
    const [product] = await db
      .update(productsTable)
      .set(body.data)
      .where(
        and(
          eq(productsTable.id, params.data.id),
          eq(productsTable.sellerId, seller.id),
        ),
      )
      .returning();
    if (!product) {
      res.status(404).json({ error: "المنتج غير موجود." });
      return;
    }
    res.json(
      UpdateSellerProductResponse.parse(productView(product, seller.storeName)),
    );
  },
);

router.delete(
  "/seller/products/:id",
  requireMarketplaceUser,
  requireApprovedSeller,
  async (req, res): Promise<void> => {
    const params = DeleteSellerProductParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const seller = getSeller(req)!;
    const [product] = await db
      .update(productsTable)
      .set({ active: false })
      .where(
        and(
          eq(productsTable.id, params.data.id),
          eq(productsTable.sellerId, seller.id),
        ),
      )
      .returning();
    if (!product) {
      res.status(404).json({ error: "المنتج غير موجود." });
      return;
    }
    res.sendStatus(204);
  },
);

router.post("/orders", async (req, res): Promise<void> => {
  const body = CreateOrderBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const pin = typeof req.body?.pin === "string" ? req.body.pin : "";
  let buyerAuth: Awaited<ReturnType<typeof authenticateBuyer>>;
  try {
    buyerAuth = await authenticateBuyer(body.data.phone, pin);
  } catch (error) {
    logger.error({ err: error }, "Failed to authenticate buyer during checkout");
    res.status(500).json({ error: "تعذّر التحقق من بيانات الطلب حالياً. حاول مرة أخرى لاحقاً." });
    return;
  }
  if (!buyerAuth.ok) { if (buyerAuth.status === 429) res.setHeader("Retry-After", "900"); res.status(buyerAuth.status).json({ error: buyerAuth.error }); return; }
  const buyerAccountId = buyerAuth.account.id;

  const quantities = new Map<number, number>();
  for (const item of body.data.items) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }
  const ids = [...quantities.keys()];
  try {
    const order = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ product: productsTable, seller: sellersTable })
      .from(productsTable)
      .innerJoin(sellersTable, eq(productsTable.sellerId, sellersTable.id))
      .where(
        and(
          inArray(productsTable.id, ids),
          eq(productsTable.active, true),
          eq(sellersTable.status, "approved"),
          gt(sellersTable.subscriptionExpiresAt, new Date()),
        ),
      )
      .for("update", { of: productsTable });
    const byId = new Map(rows.map((row) => [row.product.id, row]));
    if (byId.size !== ids.length) {
      throw new Error("PRODUCT_UNAVAILABLE");
    }

    const lines = ids.map((id) => {
      const row = byId.get(id)!;
      const quantity = quantities.get(id)!;
      if (row.product.stock < quantity) {
        throw new Error("INSUFFICIENT_STOCK");
      }
      return {
        productId: id,
        productTitle: row.product.title,
        sellerId: row.seller.id,
        sellerName: row.seller.storeName,
        quantity,
        unitPrice: Number(row.product.price),
        lineTotal: Number(row.product.price) * quantity,
      };
    });
    const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const orderCode = `GB-${randomBytes(4).toString("hex").toUpperCase()}`;
      const [created] = await tx
        .insert(ordersTable)
        .values({
          buyerAccountId,
          buyerName: body.data.buyerName,
          phone: body.data.phone,
          city: body.data.city,
          address: body.data.address,
          latitude: body.data.latitude ?? null,
          longitude: body.data.longitude ?? null,
          total,
          orderCode,
        })
        .returning();

      await tx.insert(orderItemsTable).values(
        lines.map((line) => ({
          ...line,
          orderId: created.id,
        })),
      );
      const chatLinks: Array<{ sellerId: number; sellerName: string; token: string }> = [];
      const sellersInOrder = [...new Map<number, string>(lines.map((line) => [line.sellerId, line.sellerName] as const)).entries()];
      for (const [sellerId, sellerName] of sellersInOrder) {
        const token = randomBytes(32).toString("hex");
        await tx.insert(chatsTable).values({
          orderId: created.id,
          sellerId,
          accessTokenHash: createHash("sha256").update(token).digest("hex"),
        });
        chatLinks.push({ sellerId, sellerName, token });
      }
      for (const line of lines) {
        await tx
          .update(productsTable)
          .set({ stock: sql`${productsTable.stock} - ${line.quantity}` })
          .where(
            and(
              eq(productsTable.id, line.productId),
              gte(productsTable.stock, line.quantity),
            ),
          );
      }
      return {
        ...created,
        total: Number(created.total),
        items: lines,
        chatLinks,
      };
    });
    res.status(201).json({ ...CreateOrderResponse.parse(order), chatLinks: order.chatLinks });
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_UNAVAILABLE") {
      res.status(400).json({ error: "أحد المنتجات لم يعد متاحاً." });
      return;
    }
    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") {
      res.status(409).json({ error: "الكمية المطلوبة غير متوفرة حالياً." });
      return;
    }
    logger.error({ err: error }, "Failed to create marketplace order");
    res.status(500).json({ error: "تعذّر حفظ الطلب حالياً. حاول مرة أخرى لاحقاً." });
  }
});

router.post("/buyer/orders", async (req, res): Promise<void> => {
  const phone = typeof req.body?.phone === "string" ? req.body.phone : "";
  const pin = typeof req.body?.pin === "string" ? req.body.pin : "";
  const auth = await authenticateBuyer(phone, pin, false);
  if (!auth.ok) { if (auth.status === 429) res.setHeader("Retry-After", "900"); res.status(auth.status).json({ error: auth.error }); return; }
  const orders = await db.select({ id: ordersTable.id, orderCode: ordersTable.orderCode, total: ordersTable.total, status: ordersTable.status, createdAt: ordersTable.createdAt })
    .from(ordersTable).where(eq(ordersTable.buyerAccountId, auth.account.id)).orderBy(desc(ordersTable.createdAt)).limit(50);
  const result = await Promise.all(orders.map(async (order) => {
    const items = await db.select({ productTitle: orderItemsTable.productTitle, sellerName: orderItemsTable.sellerName, quantity: orderItemsTable.quantity })
      .from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
    return { ...order, total: Number(order.total), items };
  }));
  res.json({ orders: result });
});
router.get(
  "/seller/orders",
  requireMarketplaceUser,
  requireApprovedSeller,
  async (req, res): Promise<void> => {
    const seller = getSeller(req)!;
    const orderIds = await db
      .selectDistinct({ orderId: orderItemsTable.orderId })
      .from(orderItemsTable)
      .where(eq(orderItemsTable.sellerId, seller.id));
    const orders = await Promise.all(
      orderIds.map(({ orderId }) => loadOrder(orderId, seller.id)),
    );
    res.json(ListSellerOrdersResponse.parse(orders.filter(Boolean)));
  },
);

router.patch(
  "/seller/orders/:id/status",
  requireMarketplaceUser,
  requireApprovedSeller,
  async (req, res): Promise<void> => {
    const params = UpdateOrderStatusParams.safeParse(req.params);
    const body = UpdateOrderStatusBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const seller = getSeller(req)!;
    const [sellerOrder] = await db
      .select({ orderId: orderItemsTable.orderId })
      .from(orderItemsTable)
      .where(
        and(
          eq(orderItemsTable.orderId, params.data.id),
          eq(orderItemsTable.sellerId, seller.id),
        ),
      )
      .limit(1);
    if (!sellerOrder) {
      res.status(404).json({ error: "الطلب غير موجود في متجرك." });
      return;
    }

    const [updated] = await db
      .update(ordersTable)
      .set({ status: body.data.status })
      .where(eq(ordersTable.id, params.data.id))
      .returning({ id: ordersTable.id });
    if (!updated) {
      res.status(404).json({ error: "الطلب غير موجود." });
      return;
    }

    const order = await loadOrder(params.data.id, seller.id);
    if (!order) {
      res.status(404).json({ error: "الطلب غير موجود." });
      return;
    }
    res.json(UpdateOrderStatusResponse.parse(order));
  },
);

export default router;
