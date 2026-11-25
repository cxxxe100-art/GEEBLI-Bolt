import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db, buyerAccountsTable, sellersTable, productsTable, ordersTable, sellerSubscriptionsTable, subscriptionSettingsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz", async (_req, res) => {
  let buyerLockoutSchema: "ok" | "error" = "ok";
  let marketplaceDatabaseSchema: "ok" | "error" = "ok";
  const databaseProjectRef = (() => {
    try {
      const raw = process.env.DATABASE_URL;
      if (!raw) return null;
      const parsed = new URL(raw);
      const direct = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
      if (direct) return direct[1];
      const pooled = decodeURIComponent(parsed.username).match(/(?:^|\.)([a-z0-9]{20,})$/i);
      return pooled?.[1] ?? null;
    } catch {
      return null;
    }
  })();
  let imageStorage: "not_configured" | "bucket_ok" | "bucket_missing" | "service_error" = "not_configured";
  let imageStorageHttpStatus: number | null = null;
  let imageStorageErrorCode: string | null = null;
  let imageStorageErrorMessage: string | null = null;

  try {
    await db
      .select({
        id: buyerAccountsTable.id,
        failedAttempts: buyerAccountsTable.failedAttempts,
        lockedUntil: buyerAccountsTable.lockedUntil,
      })
      .from(buyerAccountsTable)
      .limit(1);
  } catch (error) {
    buyerLockoutSchema = "error";
    logger.error({ err: error }, "Buyer lockout schema health check failed");
  }

  try {
    await Promise.all([
      db.select({ id: sellersTable.id }).from(sellersTable).limit(1),
      db.select({ id: productsTable.id }).from(productsTable).limit(1),
      db.select({ id: ordersTable.id }).from(ordersTable).limit(1),
      db.select({ id: sellerSubscriptionsTable.id }).from(sellerSubscriptionsTable).limit(1),
      db.select({ id: subscriptionSettingsTable.id }).from(subscriptionSettingsTable).limit(1),
    ]);
  } catch (error) {
    marketplaceDatabaseSchema = "error";
    logger.error({ err: error }, "Marketplace database schema health check failed");
  }

  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const legacyServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = secretKey ?? legacyServiceRoleKey;
  const storageProjectRef = (() => {
    try {
      return url ? new URL(url).hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)?.[1] ?? null : null;
    } catch {
      return null;
    }
  })();

  if (url && apiKey && legacyServiceRoleKey) {
    // Storage REST requires an Authorization JWT. Use the matching project's
    // legacy service_role JWT there, while the new secret API key identifies
    // the backend in apikey. Never put an sb_secret key in a Bearer header.
    const headers = new Headers();
    headers.set("apikey", apiKey);
    headers.set("authorization", `Bearer ${legacyServiceRoleKey}`);
    if (!headers.has("authorization") || !headers.get("authorization")?.startsWith("Bearer ")) {
      imageStorage = "service_error";
      imageStorageErrorCode = "MissingStorageAuthorizationHeader";
      imageStorageErrorMessage = "Storage authorization header could not be prepared.";
    }

    try {
      const response = await fetch(`${url}/storage/v1/bucket/geebli-products`, { headers });
      imageStorageHttpStatus = response.status;
      imageStorage = response.ok
        ? "bucket_ok"
        : response.status === 404
          ? "bucket_missing"
          : "service_error";

      if (!response.ok) {
        const body = await response.text();
        try {
          const parsed = JSON.parse(body) as Record<string, unknown>;
          const code = parsed.error ?? parsed.code ?? parsed.statusCode;
          const message = parsed.message ?? parsed.error_description;
          imageStorageErrorCode = typeof code === "string" ? code.slice(0, 100) : null;
          imageStorageErrorMessage = typeof message === "string" ? message.slice(0, 240) : null;
        } catch {
          imageStorageErrorMessage = body.replace(/\s+/g, " ").slice(0, 240) || null;
        }
      }
    } catch (error) {
      const cause = error instanceof Error
        ? (error as Error & { cause?: { code?: string } }).cause
        : undefined;
      imageStorageErrorCode = cause?.code ?? (error instanceof Error ? error.name : "UnknownError");
      logger.error({ err: error, errorCode: imageStorageErrorCode }, "Image storage health check failed");
      imageStorage = "service_error";
    }
  } else if (url && apiKey) {
    imageStorage = "service_error";
    imageStorageErrorCode = "MissingStorageAuthorizationJwt";
    imageStorageErrorMessage = "Set SUPABASE_SERVICE_ROLE_KEY to this project's legacy service_role JWT; keep SUPABASE_SECRET_KEY as the apikey.";
  } else if (url && !apiKey) {
    imageStorage = "service_error";
    imageStorageErrorCode = "MissingSupabaseApiKey";
    imageStorageErrorMessage = "Set SUPABASE_SECRET_KEY in deployment secrets.";
  }

  res.json({
    status: buyerLockoutSchema === "ok" && marketplaceDatabaseSchema === "ok" && imageStorage === "bucket_ok" ? "ok" : "degraded",
    buyerAccountsTable: buyerLockoutSchema,
    marketplaceDatabaseSchema,
    databaseProjectRef,
    storageProjectRef,
    databaseAndStorageMatch: databaseProjectRef && storageProjectRef ? databaseProjectRef === storageProjectRef : null,
    imageStorage,
    imageStorageHttpStatus,
    imageStorageErrorCode,
    imageStorageErrorMessage,
  });
});

export default router;
