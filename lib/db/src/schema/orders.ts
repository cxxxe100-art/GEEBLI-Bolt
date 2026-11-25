import { pgEnum, pgTable, serial, text, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { productsTable } from "./products";
import { sellersTable } from "./sellers";
import { buyerAccountsTable } from "./buyerAccounts";

export const orderStatusEnum = pgEnum("order_status", [
  "new",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
]);

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderCode: text("order_code").notNull().unique(),
  buyerAccountId: integer("buyer_account_id").references(() => buyerAccountsTable.id, { onDelete: "set null" }),
  buyerName: text("buyer_name").notNull(),
  phone: text("phone").notNull(),
  city: text("city").notNull(),
  address: text("address").notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7, mode: "number" }),
  longitude: numeric("longitude", { precision: 10, scale: 7, mode: "number" }),
  total: numeric("total", { precision: 12, scale: 2, mode: "number" }).notNull(),
  status: orderStatusEnum("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const orderItemsTable = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id")
    .notNull()
    .references(() => productsTable.id, { onDelete: "restrict" }),
  sellerId: integer("seller_id")
    .notNull()
    .references(() => sellersTable.id, { onDelete: "restrict" }),
  productTitle: text("product_title").notNull(),
  sellerName: text("seller_name").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2, mode: "number" }).notNull(),
  lineTotal: numeric("line_total", { precision: 12, scale: 2, mode: "number" }).notNull(),
});

export type Order = typeof ordersTable.$inferSelect;
export type OrderItem = typeof orderItemsTable.$inferSelect;
