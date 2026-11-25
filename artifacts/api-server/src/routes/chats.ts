import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, chatsTable, chatMessagesTable, ordersTable, sellersTable } from "@workspace/db";
import { getSeller, requireApprovedSeller, requireMarketplaceUser } from "../middlewares/marketplaceAuth";
const router: IRouter = Router();
const tokenHash = (token:string) => createHash("sha256").update(token).digest("hex");
const readMessage = (body:unknown):string|null => {
  const value = body && typeof body === "object" ? (body as {message?:unknown}).message : null;
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 2000 ? value.trim() : null;
};

router.get("/chat/guest", async (req,res):Promise<void> => {
  const token=req.header("x-geebli-chat-token")??"";
  if(!/^[a-f0-9]{64}$/i.test(token)){res.status(401).json({error:"رابط المحادثة غير صالح."});return;}
  const [chat]=await db.select().from(chatsTable).where(eq(chatsTable.accessTokenHash,tokenHash(token))).limit(1);
  if(!chat){res.status(404).json({error:"المحادثة غير موجودة."});return;}
  const [order]=await db.select({orderCode:ordersTable.orderCode}).from(ordersTable).where(eq(ordersTable.id,chat.orderId)).limit(1);
  const [seller]=await db.select({storeName:sellersTable.storeName}).from(sellersTable).where(eq(sellersTable.id,chat.sellerId)).limit(1);
  const messages=await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.conversationId,chat.id)).orderBy(chatMessagesTable.createdAt);
  res.json({orderCode:order?.orderCode??"",sellerName:seller?.storeName??"المتجر",messages});
});
router.post("/chat/guest/messages",async(req,res):Promise<void>=>{
  const token=req.header("x-geebli-chat-token")??"", message=readMessage(req.body);
  if(!/^[a-f0-9]{64}$/i.test(token)){res.status(401).json({error:"رابط المحادثة غير صالح."});return;}
  if(!message){res.status(400).json({error:"اكتب رسالة من 1 إلى 2000 حرف."});return;}
  const [chat]=await db.select().from(chatsTable).where(eq(chatsTable.accessTokenHash,tokenHash(token))).limit(1);
  if(!chat){res.status(404).json({error:"المحادثة غير موجودة."});return;}
  const [created]=await db.insert(chatMessagesTable).values({conversationId:chat.id,senderType:"buyer",body:message}).returning();
  res.status(201).json(created);
});
router.get("/seller/chats",requireMarketplaceUser,requireApprovedSeller,async(req,res):Promise<void>=>{
  const seller=getSeller(req)!;
  const rows=await db.select({id:chatsTable.id,orderCode:ordersTable.orderCode,buyerName:ordersTable.buyerName,buyerPhone:ordersTable.phone,createdAt:chatsTable.createdAt})
    .from(chatsTable).innerJoin(ordersTable,eq(chatsTable.orderId,ordersTable.id))
    .where(eq(chatsTable.sellerId,seller.id)).orderBy(desc(chatsTable.createdAt));
  const chats=await Promise.all(rows.map(async row=>{
    const [last]=await db.select({body:chatMessagesTable.body}).from(chatMessagesTable)
      .where(eq(chatMessagesTable.conversationId,row.id)).orderBy(desc(chatMessagesTable.createdAt)).limit(1);
    return {...row,lastMessage:last?.body??""};
  }));
  res.json(chats);
});
router.get("/seller/chats/:id",requireMarketplaceUser,requireApprovedSeller,async(req,res):Promise<void>=>{
  const seller=getSeller(req)!,id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<1){res.status(400).json({error:"رقم المحادثة غير صالح."});return;}
  const [chat]=await db.select({id:chatsTable.id,orderCode:ordersTable.orderCode,buyerName:ordersTable.buyerName,buyerPhone:ordersTable.phone})
    .from(chatsTable).innerJoin(ordersTable,eq(chatsTable.orderId,ordersTable.id))
    .where(and(eq(chatsTable.id,id),eq(chatsTable.sellerId,seller.id))).limit(1);
  if(!chat){res.status(404).json({error:"المحادثة غير موجودة."});return;}
  const messages=await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.conversationId,id)).orderBy(chatMessagesTable.createdAt);
  res.json({...chat,messages});
});
router.post("/seller/chats/:id/messages",requireMarketplaceUser,requireApprovedSeller,async(req,res):Promise<void>=>{
  const seller=getSeller(req)!,id=Number(req.params.id),message=readMessage(req.body);
  if(!Number.isSafeInteger(id)||id<1){res.status(400).json({error:"رقم المحادثة غير صالح."});return;}
  if(!message){res.status(400).json({error:"اكتب رسالة من 1 إلى 2000 حرف."});return;}
  const [chat]=await db.select({id:chatsTable.id}).from(chatsTable).where(and(eq(chatsTable.id,id),eq(chatsTable.sellerId,seller.id))).limit(1);
  if(!chat){res.status(404).json({error:"المحادثة غير موجودة."});return;}
  const [created]=await db.insert(chatMessagesTable).values({conversationId:id,senderType:"seller",body:message}).returning();
  res.status(201).json(created);
});
export default router;
