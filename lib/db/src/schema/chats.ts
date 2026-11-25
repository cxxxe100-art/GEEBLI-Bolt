import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";
import { sellersTable } from "./sellers";

export const chatsTable = pgTable("chat_conversations", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  sellerId: integer("seller_id").notNull().references(() => sellersTable.id, { onDelete: "cascade" }),
  accessTokenHash: text("access_token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orderSellerUnique: uniqueIndex("chat_conversations_order_seller_unique").on(table.orderId, table.sellerId),
  sellerIndex: index("chat_conversations_seller_idx").on(table.sellerId),
}));

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => chatsTable.id, { onDelete: "cascade" }),
  senderType: text("sender_type").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
