import { defineCollection, z } from 'astro:content';

export const collections = {
    changelog: defineCollection({
        schema: z.object({
            title: z.string(),
            date: z.date(),
            version: z.string().optional(),
            author: z.string().optional(),
            image: z.string().optional(),
            description: z.string(),
            tags: z.array(z.string()).optional(),
        }),
    }),
};
