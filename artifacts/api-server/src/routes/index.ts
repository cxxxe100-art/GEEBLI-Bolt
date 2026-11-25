import { Router, type IRouter } from "express";
import adminRouter from "./admin";
import healthRouter from "./health";
import marketplaceRouter from "./marketplace";
import chatsRouter from "./chats";
import uploadsRouter from "./uploads";
import subscriptionsRouter from "./subscriptions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketplaceRouter);
router.use(chatsRouter);
router.use(uploadsRouter);
router.use(subscriptionsRouter);
router.use(adminRouter);

export default router;
