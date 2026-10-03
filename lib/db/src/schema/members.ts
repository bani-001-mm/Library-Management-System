import { createInsertSchema } from "drizzle-zod";
import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const membersTable = pgTable(
  "members",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("members_email_unique").on(table.email)],
);

export const insertMemberSchema = createInsertSchema(membersTable).omit({
  id: true,
  joinedAt: true,
});
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof membersTable.$inferSelect;