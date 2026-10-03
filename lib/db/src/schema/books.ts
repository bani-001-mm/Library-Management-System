import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const booksTable = pgTable(
  "books",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    author: text("author").notNull(),
    isbn: text("isbn").notNull(),
    category: text("category").notNull(),
    totalCopies: integer("total_copies").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("books_isbn_unique").on(table.isbn)],
);

export const insertBookSchema = createInsertSchema(booksTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBook = z.infer<typeof insertBookSchema>;
export type Book = typeof booksTable.$inferSelect;