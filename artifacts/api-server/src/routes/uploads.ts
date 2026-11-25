import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { getSeller, requireApprovedSeller, requireMarketplaceUser } from "../middlewares/marketplaceAuth";

const router: IRouter = Router();
const types: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const BUCKET = "geebli-products";

router.post(
  "/seller/product-image/sign",
  requireMarketplaceUser,
  requireApprovedSeller,
  async (req, res): Promise<void> => {
    try {
      const { contentType, size } = req.body ?? {};
      const ext = typeof contentType === "string" ? types[contentType] : undefined;
      if (!ext) {
        res.status(400).json({ error: "اختر صورة JPG أو PNG أو WebP." });
        return;
      }
      if (!Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
        res.status(413).json({ error: "حجم الصورة يجب ألا يتجاوز 5 ميجابايت." });
        return;
      }

      const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
      const secretKey = process.env.SUPABASE_SECRET_KEY;
      const serviceRoleJwt = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const apiKey = secretKey ?? serviceRoleJwt;
      if (!url || !apiKey || !serviceRoleJwt) {
        res.status(503).json({
          error: "إعدادات رفع الصور غير مكتملة. يلزم SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY من المشروع نفسه؛ ومفتاح SUPABASE_SECRET_KEY اختياري إذا كان متاحاً.",
        });
        return;
      }

      const path = `${getSeller(req)!.id}/${randomUUID()}.${ext}`;
      const storageHeaders = new Headers();
      storageHeaders.set("apikey", apiKey);
      storageHeaders.set("authorization", `Bearer ${serviceRoleJwt}`);
      storageHeaders.set("content-type", "application/json");
      if (!storageHeaders.has("authorization") || !storageHeaders.get("authorization")?.startsWith("Bearer ")) {
        res.status(503).json({ error: "تعذّر تجهيز مصادقة تخزين الصور على الخادم." });
        return;
      }

      const signResponse = await fetch(
        `${url}/storage/v1/object/upload/sign/${BUCKET}/${path}`,
        {
          method: "POST",
          headers: storageHeaders,
          body: JSON.stringify({}),
        },
      );

      const payload = await signResponse.json().catch(() => ({})) as {
        url?: string;
        signedURL?: string;
        token?: string;
        message?: string;
      };
      const signedPath = payload.signedURL ?? payload.url;
      const signedUrl = typeof signedPath === "string"
        ? new URL(`${url}/storage/v1${signedPath.startsWith("/") ? signedPath : `/${signedPath}`}`).toString()
        : null;
      const token = payload.token ?? (signedUrl ? new URL(signedUrl).searchParams.get("token") : null);
      if (!signResponse.ok || !signedUrl || !token) {
        console.error("Supabase signed upload URL creation failed:", signResponse.status, payload.message);
        res.status(502).json({
          error: `تعذّر تجهيز رابط رفع الصورة (Supabase ${signResponse.status}). راجع مفاتيح المشروع وصلاحيات Storage.`,
        });
        return;
      }

      const uploadUrl = signedUrl;

      res.status(201).json({
        uploadUrl,
        imageUrl: `${url}/storage/v1/object/public/${BUCKET}/${path}`,
      });
    } catch (error) {
      console.error("Product image signing failed:", error);
      res.status(500).json({ error: "تعذّر تجهيز رفع الصورة. حاول مرة أخرى." });
    }
  },
);

router.post(
  "/seller/product-image",
  requireMarketplaceUser,
  requireApprovedSeller,
  async (req, res): Promise<void> => {
    try {
      const { contentType, imageData } = req.body ?? {};
      const type = typeof contentType === "string" ? types[contentType] : undefined;
      if (!type || typeof imageData !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageData)) {
        res.status(400).json({ error: "اختر صورة JPG أو PNG أو WebP صحيحة." });
        return;
      }

      const bytes = Buffer.from(imageData, "base64");
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
        res.status(413).json({ error: "حجم الصورة يجب ألا يتجاوز 5 ميجابايت." });
        return;
      }

      const validImage =
        (contentType === "image/jpeg" && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
        (contentType === "image/png" && bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (contentType === "image/webp" && bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
      if (!validImage) {
        res.status(400).json({ error: "محتوى الملف لا يطابق نوع الصورة المعلن." });
        return;
      }

      const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
      const serviceRoleJwt = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const apiKey = process.env.SUPABASE_SECRET_KEY ?? serviceRoleJwt;
      if (!url || !apiKey || !serviceRoleJwt) {
        res.status(503).json({ error: "إعدادات تخزين الصور غير مكتملة على الخادم." });
        return;
      }

      const path = `${getSeller(req)!.id}/${randomUUID()}.${type}`;
      const storageHeaders = new Headers();
      storageHeaders.set("apikey", apiKey);
      storageHeaders.set("authorization", `Bearer ${serviceRoleJwt}`);
      storageHeaders.set("content-type", contentType);
      storageHeaders.set("x-upsert", "false");
      if (!storageHeaders.has("authorization") || !storageHeaders.get("authorization")?.startsWith("Bearer ")) {
        res.status(503).json({ error: "تعذّر تجهيز مصادقة تخزين الصور على الخادم." });
        return;
      }

      const uploaded = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
        method: "POST",
        headers: storageHeaders,
        body: bytes,
      });
      if (!uploaded.ok) {
        const details = (await uploaded.text()).slice(0, 240);
        console.error("Server-side product image upload failed:", uploaded.status, details);
        res.status(502).json({ error: "تعذّر حفظ الصورة في التخزين. تحقق من إعدادات Supabase ثم حاول مرة أخرى." });
        return;
      }

      res.status(201).json({
        imageUrl: `${url}/storage/v1/object/public/${BUCKET}/${path}`,
      });
    } catch (error) {
      console.error("Server-side product image upload failed:", error);
      res.status(500).json({ error: "تعذّر رفع الصورة حالياً. حاول مرة أخرى." });
    }
  },
);

export default router;
