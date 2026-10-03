import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { booksTable } from "./books";
import { membersTable } from "./members";

export const loansTable = pgTable("loans", {
  id: serial("id").primaryKey(),
  bookId: integer("book_id")
    .notNull()
    .references(() => booksTable.id, { onDelete: "restrict" }),
  memberId: integer("member_id")
    .notNull()
    .references(() => membersTable.id, { onDelete: "restrict" }),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  dueAt: timestamp("due_at", { withTimezone: true })
    .notNull()
    .default(sql`now() + interval '14 days'`),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
});

export const insertLoanSchema = createInsertSchema(loansTable).omit({
  id: true,
  issuedAt: true,
  dueAt: true,
  returnedAt: true,
});
export type InsertLoan = z.infer<typeof insertLoanSchema>;
export type Loan = typeof loansTable.$inferSelect;