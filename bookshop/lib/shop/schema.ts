import { z } from "zod";
const text = (max: number) => z.string().trim().max(max);
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80);
const asset = z
  .string()
  .regex(
    /^(?:\/books\/[a-zA-Z0-9._-]+|\/founder\/[a-zA-Z0-9._-]+|asset:[a-f0-9-]{36})$/
  );
export const bookSchema = z
  .object({
    id: slugSchema,
    slug: slugSchema,
    title: text(160).min(3),
    subtitle: text(300),
    description: text(2000),
    teaser: text(3000),
    category: text(60),
    mode: z.enum(["free", "support", "paid"]),
    priceMinor: z.number().int().min(100).max(10000000),
    published: z.boolean(),
    pages: z.number().int().min(1).max(2000),
    cover: asset,
    mockup: asset.optional(),
    pdf: z.string().regex(/^(?:seed:acquisition|file:[a-f0-9-]{36})$/),
    preview: z.string().regex(/^file:[a-f0-9-]{36}$/).optional(),
    chapters: z.array(text(180).min(1)).max(60),
    benefits: z.array(text(250).min(1)).max(12),
  })
  .strict()
  .refine((book) => !book.preview || book.preview !== book.pdf, {
    message: "The public preview must be a separate PDF from the complete edition.",
    path: ["preview"],
  });
export const configSchema = z
  .object({
    books: z.array(bookSchema).max(100),
    author: z
      .object({
        name: text(100).min(1),
        bio: text(5000),
        portrait: asset,
        email: z.email().max(254),
        linkedin: z.url().startsWith("https://"),
        portfolio: z.url().startsWith("https://"),
        services: text(3000),
      })
      .strict(),
    settings: z
      .object({
        ghsPerUsd: z.number().min(1).max(100),
        rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        presets: z.array(z.number().min(1).max(1000)).min(1).max(5),
        paymentsEnabled: z.boolean(),
        terms: text(12000).min(100),
        privacy: text(12000).min(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.books.map((b) => b.id)).size !== v.books.length ||
      new Set(v.books.map((b) => b.slug)).size !== v.books.length
    )
      c.addIssue({
        code: "custom",
        message: "Book IDs and URLs must be unique.",
      });
  });
export type Book = z.infer<typeof bookSchema>;
export type ShopConfig = z.infer<typeof configSchema>;
export type Order = {
  id: string;
  reference: string;
  email: string;
  kind: "support" | "purchase";
  bookId: string;
  file: string;
  amountMinor: number;
  currency: "GHS";
  proofHash: string;
  createdAt: string;
  status: "pending" | "paid" | "revoked";
  paidAt?: string;
};
export const chargeInput = z
  .object({
    email: z.email().max(254),
    kind: z.enum(["support", "purchase"]),
    bookId: slugSchema,
    usd: z.number().min(1).max(1000).optional(),
    rate: z.number().optional(),
  })
  .strict();
