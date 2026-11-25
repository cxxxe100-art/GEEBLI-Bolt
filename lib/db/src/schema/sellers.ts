import { pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const sellerStatusEnum = pgEnum("seller_status", [
  "pending",
  "approved",
  "rejected",
]);

export const sellersTable = pgTable("sellers", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  storeName: text("store_name").notNull(),
  contactName: text("contact_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  status: sellerStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
});

export type Seller = typeof sellersTable.$inferSelect;
export type NewSeller = typeof sellersTable.$inferInsert;
