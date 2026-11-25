import {
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sellersTable } from "./sellers";

export const subscriptionPaymentMethodEnum = pgEnum("subscription_payment_method", [
  "bankak",
  "fawry",
  "cash",
]);

export const subscriptionPaymentStatusEnum = pgEnum("subscription_payment_status", [
  "pending",
  "approved",
  "rejected",
]);

export const subscriptionSettingsTable = pgTable("subscription_settings", {
  id: integer("id").primaryKey().default(1),
  monthlyAmount: numeric("monthly_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  recipientName: text("recipient_name").notNull().default(""),
  bankakAccount: text("bankak_account").notNull().default(""),
  fawryAccount: text("fawry_account").notNull().default(""),
  cashInstructions: text("cash_instructions").notNull().default(""),
  earningsResetAt: timestamp("earnings_reset_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sellerSubscriptionsTable = pgTable("seller_subscriptions", {
  id: serial("id").primaryKey(),
  sellerId: integer("seller_id").notNull().references(() => sellersTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  paymentMethod: subscriptionPaymentMethodEnum("payment_method").notNull(),
  receiptPath: text("receipt_path").notNull(),
  status: subscriptionPaymentStatusEnum("status").notNull().default("pending"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewerClerkUserId: text("reviewer_clerk_user_id"),
  reviewNote: text("review_note"),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
});

export type SellerSubscription = typeof sellerSubscriptionsTable.$inferSelect;
export type NewSellerSubscription = typeof sellerSubscriptionsTable.$inferInsert;
