import { clerkClient, getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db, sellersTable, type Seller } from "@workspace/db";

type MarketplaceRequest = Request & {
  actorId?: string;
  seller?: Seller;
};

export const requireMarketplaceUser: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "سجّل الدخول للمتابعة." });
    return;
  }
  (req as MarketplaceRequest).actorId = userId;
  next();
};

export const requireApprovedSeller: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const actorId = (req as MarketplaceRequest).actorId;
  if (!actorId) {
    res.status(401).json({ error: "سجّل الدخول للمتابعة." });
    return;
  }

  const [seller] = await db
    .select()
    .from(sellersTable)
    .where(eq(sellersTable.clerkUserId, actorId))
    .limit(1);
  if (!seller || seller.status !== "approved") {
    res.status(403).json({ error: "يجب اعتماد حساب البائع قبل إدارة المنتجات." });
    return;
  }
  if (!seller.subscriptionExpiresAt || seller.subscriptionExpiresAt <= new Date()) {
    res.status(403).json({ error: "انتهى اشتراك متجرك. جدّد الاشتراك لمواصلة الإدارة." });
    return;
  }
  (req as MarketplaceRequest).seller = seller;
  next();
};

export const requireMarketplaceAdmin: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "سجّل الدخول للمتابعة." });
    return;
  }

  const allowedEmails = new Set(
    (process.env.GEEBLI_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowedEmails.size === 0) {
    res.status(403).json({ error: "لم يتم إعداد حساب الأدمن بعد." });
    return;
  }

  const user = await clerkClient.users.getUser(userId);
  const emailAddresses = user.emailAddresses.map((entry) =>
    entry.emailAddress.toLowerCase(),
  );
  if (!emailAddresses.some((email) => allowedEmails.has(email))) {
    res.status(403).json({ error: "ليس لديك صلاحية الأدمن." });
    return;
  }
  (req as MarketplaceRequest).actorId = userId;
  next();
};

export function getActorId(req: Request): string {
  return (req as MarketplaceRequest).actorId ?? "";
}

export function getSeller(req: Request): Seller | undefined {
  return (req as MarketplaceRequest).seller;
}
