import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, sum } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  sellersTable,
  sellerSubscriptionsTable,
  subscriptionSettingsTable,
} from "@workspace/db";
import {
  getActorId,
  requireMarketplaceAdmin,
  requireMarketplaceUser,
} from "../middlewares/marketplaceAuth";

const router: IRouter = Router();
const RECEIPT_BUCKET = "geebli-subscription-receipts";
const imageTypes: Record<string, { ext: string; valid: (b: Buffer) => boolean }> = {
  "image/jpeg": { ext: "jpg", valid: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9 },
  "image/png": { ext: "png", valid: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  "image/webp": { ext: "webp", valid: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
};

function storageConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.SUPABASE_SECRET_KEY ?? serviceRole;
  return url && serviceRole && apiKey ? { url, serviceRole, apiKey } : undefined;
}

async function ensurePrivateReceiptBucket(config: NonNullable<ReturnType<typeof storageConfig>>) {
  const headers = { apikey: config.apiKey, Authorization: `Bearer ${config.serviceRole}` };
  const created = await fetch(`${config.url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id: RECEIPT_BUCKET, name: RECEIPT_BUCKET, public: false, file_size_limit: 5242880, allowed_mime_types: Object.keys(imageTypes) }),
  });
  if (created.ok) return headers;
  const existing = await fetch(`${config.url}/storage/v1/bucket/${RECEIPT_BUCKET}`, { headers });
  if (!existing.ok) throw new Error("RECEIPT_BUCKET_UNAVAILABLE");
  const bucket = await existing.json() as { public?: boolean };
  if (bucket.public !== false) throw new Error("RECEIPT_BUCKET_MUST_BE_PRIVATE");
  return headers;
}

router.get("/seller/subscription", requireMarketplaceUser, async (req, res): Promise<void> => {
  const [seller] = await db.select().from(sellersTable).where(eq(sellersTable.clerkUserId, getActorId(req))).limit(1);
  if (!seller) { res.status(404).json({ error: "حساب البائع غير موجود." }); return; }
  const [settings] = await db.select().from(subscriptionSettingsTable).where(eq(subscriptionSettingsTable.id, 1)).limit(1);
  const [latest] = await db.select().from(sellerSubscriptionsTable).where(eq(sellerSubscriptionsTable.sellerId, seller.id)).orderBy(desc(sellerSubscriptionsTable.submittedAt)).limit(1);
  res.json({
    seller: { id: seller.id, storeName: seller.storeName, status: seller.status, subscriptionExpiresAt: seller.subscriptionExpiresAt },
    settings: settings ?? { monthlyAmount: 0, recipientName: "", bankakAccount: "", fawryAccount: "", cashInstructions: "" },
    latestPayment: latest ? { id: latest.id, amount: Number(latest.amount), paymentMethod: latest.paymentMethod, status: latest.status, submittedAt: latest.submittedAt, reviewNote: latest.reviewNote, periodEnd: latest.periodEnd } : null,
    hasActiveSubscription: Boolean(seller.subscriptionExpiresAt && seller.subscriptionExpiresAt > new Date()),
  });
});

router.post("/seller/subscription", requireMarketplaceUser, async (req, res): Promise<void> => {
  try {
    const [seller] = await db.select().from(sellersTable).where(eq(sellersTable.clerkUserId, getActorId(req))).limit(1);
    if (!seller || seller.status !== "approved") { res.status(403).json({ error: "يجب اعتماد طلب متجرك أولاً." }); return; }
    const method = req.body?.paymentMethod;
    const contentType = req.body?.contentType;
    const data = req.body?.receiptData;
    const type = typeof contentType === "string" ? imageTypes[contentType] : undefined;
    if (!["bankak", "fawry", "cash"].includes(method) || !type || typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      res.status(400).json({ error: "اختر طريقة الدفع وارفق صورة إشعار صحيحة." }); return;
    }
    const bytes = Buffer.from(data, "base64");
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) { res.status(413).json({ error: "حجم الإشعار يجب ألا يتجاوز 5 ميجابايت." }); return; }
    if (!type.valid(bytes)) { res.status(400).json({ error: "محتوى الملف لا يطابق نوع الصورة المعلن." }); return; }
    const [settings] = await db.select().from(subscriptionSettingsTable).where(eq(subscriptionSettingsTable.id, 1)).limit(1);
    const amount = Number(settings?.monthlyAmount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) { res.status(409).json({ error: "لم تحدد الإدارة قيمة الاشتراك الشهري بعد." }); return; }
    const paymentDetailsAvailable = (method === "bankak" && Boolean(settings?.bankakAccount)) || (method === "fawry" && Boolean(settings?.fawryAccount)) || (method === "cash" && Boolean(settings?.cashInstructions));
    if (!paymentDetailsAvailable) { res.status(409).json({ error: "طريقة الدفع المختارة غير مهيأة بعد. اختر طريقة أخرى أو تواصل مع الإدارة." }); return; }
    const [pending] = await db.select({ id: sellerSubscriptionsTable.id }).from(sellerSubscriptionsTable).where(and(eq(sellerSubscriptionsTable.sellerId, seller.id), eq(sellerSubscriptionsTable.status, "pending"))).limit(1);
    if (pending) { res.status(409).json({ error: "لديك طلب دفع قيد المراجعة بالفعل." }); return; }
    const config = storageConfig();
    if (!config) { res.status(503).json({ error: "خدمة إيصالات الاشتراك تحتاج إعداد مفاتيح Supabase في Secrets." }); return; }
    const headers = await ensurePrivateReceiptBucket(config);
    const path = `${seller.id}/${randomUUID()}.${type.ext}`;
    const uploaded = await fetch(`${config.url}/storage/v1/object/${RECEIPT_BUCKET}/${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": contentType, "x-upsert": "false" },
      body: bytes,
    });
    if (!uploaded.ok) {
      const details = (await uploaded.text()).slice(0, 300);
      console.error("Subscription receipt upload failed:", uploaded.status, details);
      res.status(502).json({ error: "تعذّر حفظ إشعار الدفع. حاول مرة أخرى." }); return;
    }
    const [payment] = await db.insert(sellerSubscriptionsTable).values({
      sellerId: seller.id,
      amount,
      paymentMethod: method,
      receiptPath: path,
    }).returning();
    res.status(201).json({ id: payment.id, status: payment.status, submittedAt: payment.submittedAt });
  } catch (error) {
    console.error("Subscription submission failed:", error);
    res.status(500).json({ error: "تعذّر إرسال طلب الاشتراك حالياً." });
  }
});

router.get("/admin/subscriptions", requireMarketplaceAdmin, async (_req, res): Promise<void> => {
  const [settings] = await db.select().from(subscriptionSettingsTable).where(eq(subscriptionSettingsTable.id, 1)).limit(1);
  const rows = await db.select({ payment: sellerSubscriptionsTable, sellerName: sellersTable.storeName, sellerPhone: sellersTable.phone, sellerEmail: sellersTable.email })
    .from(sellerSubscriptionsTable).innerJoin(sellersTable, eq(sellerSubscriptionsTable.sellerId, sellersTable.id))
    .orderBy(desc(sellerSubscriptionsTable.submittedAt)).limit(200);
  const resetAt = settings?.earningsResetAt ?? new Date(0);
  const [earnings] = await db.select({ total: sum(sellerSubscriptionsTable.amount) })
    .from(sellerSubscriptionsTable)
    .where(and(eq(sellerSubscriptionsTable.status, "approved"), gt(sellerSubscriptionsTable.reviewedAt, resetAt)));
  res.json({
    settings: settings ?? { monthlyAmount: 0, recipientName: "", bankakAccount: "", fawryAccount: "", cashInstructions: "", earningsResetAt: null },
    earningsTotal: Number(earnings?.total ?? 0),
    earningsResetAt: settings?.earningsResetAt ?? null,
    payments: rows.map(({ payment, ...seller }) => ({ ...payment, amount: Number(payment.amount), ...seller })),
  });
});

router.put("/admin/subscription-settings", requireMarketplaceAdmin, async (req, res): Promise<void> => {
  const body = req.body ?? {};
  const monthlyAmount = Number(body.monthlyAmount);
  const recipientName = typeof body.recipientName === "string" ? body.recipientName.trim().slice(0, 120) : "";
  const bankakAccount = typeof body.bankakAccount === "string" ? body.bankakAccount.trim().slice(0, 120) : "";
  const fawryAccount = typeof body.fawryAccount === "string" ? body.fawryAccount.trim().slice(0, 120) : "";
  const cashInstructions = typeof body.cashInstructions === "string" ? body.cashInstructions.trim().slice(0, 1000) : "";
  if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) { res.status(400).json({ error: "أدخل مبلغ اشتراك صحيحاً أكبر من صفر." }); return; }
  const [settings] = await db.insert(subscriptionSettingsTable).values({ id: 1, monthlyAmount, recipientName, bankakAccount, fawryAccount, cashInstructions, updatedAt: new Date() })
    .onConflictDoUpdate({ target: subscriptionSettingsTable.id, set: { monthlyAmount, recipientName, bankakAccount, fawryAccount, cashInstructions, updatedAt: new Date() } }).returning();
  res.json(settings);
});

router.post("/admin/subscriptions/earnings/reset", requireMarketplaceAdmin, async (_req, res): Promise<void> => {
  const now = new Date();
  await db.insert(subscriptionSettingsTable).values({ id: 1, earningsResetAt: now })
    .onConflictDoUpdate({ target: subscriptionSettingsTable.id, set: { earningsResetAt: now, updatedAt: now } });
  res.json({ success: true, earningsTotal: 0, earningsResetAt: now });
});

router.get("/admin/subscriptions/:id/receipt", requireMarketplaceAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "رقم الطلب غير صحيح." }); return; }
  const [payment] = await db.select().from(sellerSubscriptionsTable).where(eq(sellerSubscriptionsTable.id, id)).limit(1);
  if (!payment) { res.status(404).json({ error: "إشعار الدفع غير موجود." }); return; }
  const config = storageConfig();
  if (!config) { res.status(503).json({ error: "خدمة تخزين الإيصالات غير مهيأة." }); return; }
  const headers = { apikey: config.apiKey, Authorization: `Bearer ${config.serviceRole}`, "Content-Type": "application/json" };
  const signed = await fetch(`${config.url}/storage/v1/object/sign/${RECEIPT_BUCKET}/${payment.receiptPath}`, { method: "POST", headers, body: JSON.stringify({ expiresIn: 300 }) });
  if (!signed.ok) { res.status(502).json({ error: "تعذّر إنشاء رابط آمن للإيصال." }); return; }
  const result = await signed.json() as { signedURL?: string };
  if (!result.signedURL) { res.status(502).json({ error: "لم يرجع التخزين رابط الإيصال." }); return; }
  const signedUrl = result.signedURL.startsWith("http") ? result.signedURL : `${config.url}/storage/v1${result.signedURL.startsWith("/") ? "" : "/"}${result.signedURL}`;
  res.json({ url: signedUrl });
});

router.patch("/admin/subscriptions/:id/decision", requireMarketplaceAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const status = req.body?.status;
  if (!Number.isInteger(id) || id <= 0 || !["approved", "rejected"].includes(status)) { res.status(400).json({ error: "بيانات المراجعة غير صحيحة." }); return; }
  const [payment] = await db.select().from(sellerSubscriptionsTable).where(eq(sellerSubscriptionsTable.id, id)).limit(1);
  if (!payment || payment.status !== "pending") { res.status(404).json({ error: "طلب الدفع غير موجود أو تمت مراجعته." }); return; }
  const now = new Date();
  const [seller] = await db.select().from(sellersTable).where(eq(sellersTable.id, payment.sellerId)).limit(1);
  if (!seller) { res.status(404).json({ error: "حساب البائع غير موجود." }); return; }
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  if (status === "approved") {
    periodStart = seller.subscriptionExpiresAt && seller.subscriptionExpiresAt > now ? seller.subscriptionExpiresAt : now;
    periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }
  await db.transaction(async (tx) => {
    await tx.update(sellerSubscriptionsTable).set({ status, reviewedAt: now, reviewerClerkUserId: getActorId(req), reviewNote: typeof req.body?.reviewNote === "string" ? req.body.reviewNote.slice(0, 500) : null, periodStart, periodEnd }).where(eq(sellerSubscriptionsTable.id, id));
    if (status === "approved" && periodEnd) {
      await tx.update(sellersTable).set({ subscriptionExpiresAt: periodEnd }).where(eq(sellersTable.id, seller.id));
    }
  });
  res.json({ id, status, periodStart, periodEnd });
});

export default router;
