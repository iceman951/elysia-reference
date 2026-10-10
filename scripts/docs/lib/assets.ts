import { existsSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import { importConfig } from '../import.config.ts';
import { listFiles, matchesAnyGlob, sha256, writeIfChanged } from './fs-utils.ts';
import type { AssetResolution, AssetResolver } from './convert/transform.ts';

export interface AssetRecord {
	/** Path relative to the upstream public dir. */
	publicPath: string;
	status: 'mirrored' | 'excluded' | 'missing';
	reason?: string;
	url: string;
	width?: number;
	height?: number;
	bytes?: number;
	sha256?: string;
	referencedBy: Set<string>;
}

const RASTER_OR_SVG = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

export class AssetManager {
	readonly records = new Map<string, AssetRecord>();
	readonly publicFiles: Set<string>;
	private readonly publicDir: string;
	private readonly siteUrl: string;

	private constructor(publicDir: string, files: string[], siteUrl: string) {
		this.publicDir = publicDir;
		this.siteUrl = siteUrl;
		this.publicFiles = new Set(files);
	}

	static async create(checkoutDir: string, siteUrl: string): Promise<AssetManager> {
		const publicDir = path.join(checkoutDir, importConfig.upstream.publicDir);
		return new AssetManager(publicDir, await listFiles(publicDir), siteUrl);
	}

	private exclusionReason(publicPath: string): string | undefined {
		for (const rule of [...importConfig.assets.exclude, ...importConfig.assets.reviewedExclusions]) {
			if (matchesAnyGlob(publicPath, [rule.pattern])) return rule.reason;
		}
		return undefined;
	}

	private record(publicPath: string): AssetRecord {
		const existing = this.records.get(publicPath);
		if (existing) return existing;
		const upstreamUrl = `${this.siteUrl}/${publicPath.split('/').map(encodeURIComponent).join('/')}`;
		let record: AssetRecord;
		const excluded = this.exclusionReason(publicPath);
		if (!this.publicFiles.has(publicPath)) {
			record = { publicPath, status: 'missing', url: upstreamUrl, referencedBy: new Set() };
		} else if (excluded) {
			record = { publicPath, status: 'excluded', reason: excluded, url: upstreamUrl, referencedBy: new Set() };
		} else {
			const url = `${importConfig.assets.urlPrefix}/${publicPath.split('/').map(encodeURIComponent).join('/')}`;
			record = { publicPath, status: 'mirrored', url, referencedBy: new Set() };
		}
		this.records.set(publicPath, record);
		return record;
	}

	/** Reads dimensions and sizes of mirrored files. Call once after conversion. */
	async measure(): Promise<void> {
		for (const record of this.records.values()) {
			if (record.status !== 'mirrored') continue;
			const file = path.join(this.publicDir, record.publicPath);
			const content = await readFile(file);
			record.bytes = content.length;
			record.sha256 = sha256(content);
			if (RASTER_OR_SVG.test(record.publicPath)) {
				try {
					const size = imageSize(content);
					if (size.width && size.height) {
						record.width = size.width;
						record.height = size.height;
					}
				} catch {
					// Unknown format: leave dimensions unset.
				}
			}
		}
	}

	/**
	 * Image dimensions must be known while converting (they are written into the MDX),
	 * so mirrored images are measured eagerly on first use.
	 */
	private measureSync(record: AssetRecord, content: Buffer): void {
		if (!RASTER_OR_SVG.test(record.publicPath)) return;
		try {
			const size = imageSize(content);
			if (size.width && size.height) {
				record.width = size.width;
				record.height = size.height;
			}
		} catch {
			// ignore
		}
	}

	forPage(page: string, readSync: (file: string) => Buffer): AssetResolver {
		return {
			resolve: (publicPath: string): AssetResolution => {
				const record = this.record(publicPath);
				record.referencedBy.add(page);
				if (record.status === 'mirrored') {
					if (record.width === undefined && RASTER_OR_SVG.test(publicPath)) {
						this.measureSync(record, readSync(path.join(this.publicDir, publicPath)));
					}
					const resolution: AssetResolution = { kind: 'mirrored', url: record.url };
					if (record.width !== undefined) resolution.width = record.width;
					if (record.height !== undefined) resolution.height = record.height;
					return resolution;
				}
				if (record.status === 'excluded') return { kind: 'excluded', upstreamUrl: record.url, reason: record.reason ?? 'excluded' };
				return { kind: 'missing', upstreamUrl: record.url };
			},
		};
	}

	/** Copies mirrored assets into `destDir` and removes files that are no longer used. */
	async sync(destDir: string): Promise<{ written: number; removed: string[] }> {
		let written = 0;
		const keep = new Set<string>();
		for (const record of this.records.values()) {
			if (record.status !== 'mirrored') continue;
			keep.add(record.publicPath);
			const content = await readFile(path.join(this.publicDir, record.publicPath));
			if (await writeIfChanged(path.join(destDir, record.publicPath), content)) written++;
		}
		const removed: string[] = [];
		if (existsSync(destDir)) {
			for (const file of await listFiles(destDir)) {
				if (keep.has(file)) continue;
				const target = path.join(destDir, file);
				if ((await stat(target)).isFile()) {
					await rm(target);
					removed.push(file);
				}
			}
		}
		return { written, removed };
	}
}
