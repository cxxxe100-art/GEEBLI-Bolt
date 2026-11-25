import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const buyerAccountsTable = pgTable("buyer_accounts", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  pinHash: text("pin_hash").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  phoneUnique: uniqueIndex("buyer_accounts_phone_unique").on(table.phone),
}));
