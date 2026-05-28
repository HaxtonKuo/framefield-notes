import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string(),
    authorInitials: z.string(),
    readingTime: z.string(),
    categories: z.array(z.string()),
    cover: z.string().optional(),
    coverAlt: z.string().optional(),
    sourceUrl: z
      .string()
      .refine((value) => {
        try {
          new URL(value);
          return true;
        } catch {
          return false;
        }
      }, "sourceUrl must be a valid URL")
      .optional(),
    featured: z.boolean().default(false),
  }),
});

export const collections = { posts };
