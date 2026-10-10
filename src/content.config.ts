import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({
			extend: z.object({
				/**
				 * Present on pages imported from the official documentation (written by
				 * `pnpm docs:import`). Its presence is what marks a page as imported.
				 */
				upstream: z
					.object({
						/** Source file in the upstream repository, e.g. `docs/essential/route.md`. */
						path: z.string(),
						/** Corresponding page on the official site. */
						url: z.url(),
					})
					.optional(),
				/** Documentation set (id in src/config/versions.ts) the page applies to. */
				docVersion: z.string().optional(),
				/** Release-note metadata, taken from the upstream post. */
				release: z
					.object({
						version: z.string().optional(),
						date: z.coerce.date().optional(),
						author: z.string().optional(),
					})
					.optional(),
				/** API reference entries: verification status of the documented API. */
				api: z
					.object({
						name: z.string(),
						status: z.enum(['unverified', 'verified']),
						/** Package and version the entry was checked against, e.g. `elysia@1.4.28`. */
						verifiedAgainst: z.string().optional(),
						/** Exact source location (permalink) used for verification. */
						source: z.url().optional(),
					})
					.optional(),
			}),
		}),
	}),
};
