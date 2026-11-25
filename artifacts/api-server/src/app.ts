import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "7mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

// Serve the Vite production build from the same origin as the API. This keeps
// browser API requests, Clerk sessions, and uploads on one Render service.
if (process.env.NODE_ENV === "production") {
  const frontendDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../geebli/dist/public",
  );
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path === "/api" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(frontendDist, "index.html"), (error) => {
      if (error) next(error);
    });
  });
}

// Keep API failures machine-readable. Express's default error page is HTML,
// which otherwise makes frontend JSON clients fail with "Unexpected token <".
app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(
    { err: error, method: req.method, path: req.path },
    "Unhandled API request error",
  );
  if (res.headersSent) {
    next(error);
    return;
  }
  if (req.path.startsWith("/api/")) {
    res.status(500).json({
      error: "حدث خطأ غير متوقع في الخادم. لم يتم تأكيد العملية؛ حاول مرة أخرى لاحقاً.",
    });
    return;
  }
  res.status(500).send("Internal Server Error");
});

export default app;
