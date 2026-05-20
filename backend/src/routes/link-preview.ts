import net from 'net';

import { Router } from 'express';
import { z } from 'zod';

import { logger } from '../utils/logger';
import { sendValidatedJson } from '../utils/response-validation';

import type { Response } from 'express';

const linkPreviewRouter = Router();

const MAX_CHARS = 200_000;
const TIMEOUT_MS = 5000;
const ALLOWLIST = (process.env['PREVIEW_ALLOWLIST'] ?? '')
	.split(',')
	.map(entry => entry.trim().toLowerCase())
	.filter(Boolean);
const ALLOW_ALL = ALLOWLIST.includes('*');
const ALLOWLIST_ENABLED = ALLOWLIST.length > 0 && !ALLOW_ALL;
const previewUrlParamSchema = z.string().trim().min(1);
const previewErrorResponseSchema = z.object({
	error: z.string().min(1)
}).strict();
const linkPreviewResponseSchema = z.object({
	url: z.url(),
	title: z.string().min(1).optional(),
	description: z.string().min(1).optional(),
	image: z.url().optional(),
	siteName: z.string().min(1).optional()
}).strict();

type PreviewTargetResult = {
	ok: true;
	targetUrl: URL;
} | {
	ok: false;
	status: number;
	error: string;
};

type LinkPreviewResponse = z.infer<typeof linkPreviewResponseSchema>;

const isBlockedHost = (hostname: string): boolean => {
	const lower = hostname.toLowerCase();
	if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1') {
		return true;
	}

	const ipType = net.isIP(lower);
	if (ipType) {
		if (lower.startsWith('10.') || lower.startsWith('192.168.')) return true;
		if (lower.startsWith('172.')) {
			const second = Number(lower.split('.')[1]);
			if (second >= 16 && second <= 31) return true;
		}
	}

	return false;
};

const isAllowlistedHost = (hostname: string): boolean => {
	const lower = hostname.toLowerCase();
	if (ALLOW_ALL) return true;
	if (!ALLOWLIST_ENABLED) {
		return process.env['NODE_ENV'] !== 'production';
	}
	return ALLOWLIST.some(entry => lower === entry || lower.endsWith(`.${entry}`));
};

const isAllowedPreviewTargetUrl = (targetUrl: URL): boolean => (
	['http:', 'https:'].includes(targetUrl.protocol)
	&& !isBlockedHost(targetUrl.hostname)
	&& isAllowlistedHost(targetUrl.hostname)
);

const getPreviewTargetUrl = (value: unknown): PreviewTargetResult => {
	const parsed = previewUrlParamSchema.safeParse(value);
	if (!parsed.success)
		return { ok: false, status: 400, error: 'Missing url parameter' };

	let targetUrl: URL;
	try {
		targetUrl = new URL(parsed.data);
	} catch {
		return { ok: false, status: 400, error: 'Invalid URL' };
	}

	if (!['http:', 'https:'].includes(targetUrl.protocol))
		return { ok: false, status: 400, error: 'Invalid protocol' };

	if (isBlockedHost(targetUrl.hostname))
		return { ok: false, status: 403, error: 'Blocked host' };

	if (!isAllowlistedHost(targetUrl.hostname))
		return { ok: false, status: 403, error: 'Domain not allowed' };

	return { ok: true, targetUrl };
};

const sendPreviewError = (res: Response, status: number, error: string) => (
	sendValidatedJson(
		res,
		previewErrorResponseSchema,
		{ error },
		{
			label: 'link preview error response',
			status,
			errorStatus: status,
			errorBody: { error }
		}
	)
);

const resolvePreviewImageUrl = (image: string | undefined, baseUrl: URL): string | undefined => {
	if (!image)
		return undefined;

	try {
		const resolved = new URL(image, baseUrl);
		return isAllowedPreviewTargetUrl(resolved) ? resolved.toString() : undefined;
	} catch {
		return undefined;
	}
};

const buildLinkPreviewResponse = ({
	targetUrl,
	title,
	description,
	image,
	siteName
}: {
	targetUrl: URL;
	title?: string | undefined;
	description?: string | undefined;
	image?: string | undefined;
	siteName?: string | undefined;
}): LinkPreviewResponse => ({
	url: targetUrl.toString(),
	...(title !== undefined ? { title } : {}),
	...(description !== undefined ? { description } : {}),
	...(image !== undefined ? { image } : {}),
	...(siteName !== undefined ? { siteName } : {})
});

const META_TAG_PATTERN = /<meta\b[^>]*>/gi;
const HTML_ATTRIBUTE_PATTERN = /\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*["']([^"']*)["']/g;

type MetaAttributes = {
	content?: string;
	name?: string;
	property?: string;
};

const getHtmlAttributes = (tag: string): MetaAttributes => {
	const attributes: MetaAttributes = {};
	for (const match of tag.matchAll(HTML_ATTRIBUTE_PATTERN)) {
		const [, name, value] = match;
		if (name === undefined || value === undefined)
			continue;

		const normalizedName = name.toLowerCase();
		if (normalizedName === 'content') {
			attributes.content = value;
		} else if (normalizedName === 'name') {
			attributes.name = value;
		} else if (normalizedName === 'property') {
			attributes.property = value;
		}
	}

	return attributes;
};

const getMetaLookupValue = (attributes: MetaAttributes, attr: 'property' | 'name'): string | undefined =>
	attr === 'property' ? attributes.property : attributes.name;

const extractMeta = (html: string, attr: 'property' | 'name', key: string): string | undefined => {
	for (const match of html.matchAll(META_TAG_PATTERN)) {
		const [tag] = match;
		const attributes = getHtmlAttributes(tag);
		const content = attributes.content?.trim();
		if (getMetaLookupValue(attributes, attr) === key && content !== undefined && content.length > 0)
			return content;
	}

	return undefined;
};

const extractTitle = (html: string): string | undefined => {
	const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
	return match?.[1]?.trim();
};

linkPreviewRouter.get('/', async (req, res) => {
	const targetResult = getPreviewTargetUrl(req.query['url']);
	if (!targetResult.ok)
		return sendPreviewError(res, targetResult.status, targetResult.error);

	const { targetUrl } = targetResult;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const response = await fetch(targetUrl.toString(), {
			redirect: 'follow',
			signal: controller.signal,
			headers: {
				'User-Agent': 'PrivateCommPreview/1.0'
			}
		});

		if (!response.ok) {
			return sendPreviewError(res, 502, 'Failed to fetch URL');
		}

		const contentType = response.headers.get('content-type') ?? '';
		if (!contentType.includes('text/html')) {
			return sendPreviewError(res, 415, 'Unsupported content type');
		}

		let html = await response.text();
		if (html.length > MAX_CHARS) {
			html = html.slice(0, MAX_CHARS);
		}

		const title =
			extractMeta(html, 'property', 'og:title') ??
			extractTitle(html) ??
			undefined;
		const description =
			extractMeta(html, 'property', 'og:description') ??
			extractMeta(html, 'name', 'description') ??
			undefined;
		const image = extractMeta(html, 'property', 'og:image') ?? undefined;
		const siteName = extractMeta(html, 'property', 'og:site_name') ?? undefined;
		const resolvedImage = resolvePreviewImageUrl(image, targetUrl);

		return sendValidatedJson(
			res,
			linkPreviewResponseSchema,
			buildLinkPreviewResponse({
				targetUrl,
				title,
				description,
				image: resolvedImage,
				siteName
			}),
			{ label: 'link preview response' }
		);
	} catch (error) {
		logger.error('Link preview error', {
			error: error instanceof Error ? error.message : 'Unknown error'
		});
		return sendPreviewError(res, 502, 'Preview fetch failed');
	} finally {
		clearTimeout(timeout);
	}
});

linkPreviewRouter.get('/image', async (req, res) => {
	const targetResult = getPreviewTargetUrl(req.query['url']);
	if (!targetResult.ok)
		return sendPreviewError(res, targetResult.status, targetResult.error);

	const { targetUrl } = targetResult;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const response = await fetch(targetUrl.toString(), {
			redirect: 'follow',
			signal: controller.signal,
			headers: {
				'User-Agent': 'PrivateCommPreview/1.0'
			}
		});

		if (!response.ok) {
			return sendPreviewError(res, 502, 'Failed to fetch image');
		}

		const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
		if (!contentType.toLowerCase().startsWith('image/')) 
			return sendPreviewError(res, 415, 'Unsupported image content type');

		res.setHeader('Content-Type', contentType);
		res.setHeader('Cache-Control', 'public, max-age=86400');

		const arrayBuffer = await response.arrayBuffer();
		return res.status(200).send(Buffer.from(arrayBuffer));
	} catch (error) {
		logger.error('Link preview image error', {
			error: error instanceof Error ? error.message : 'Unknown error'
		});
		return sendPreviewError(res, 502, 'Image fetch failed');
	} finally {
		clearTimeout(timeout);
	}
});

export { linkPreviewRouter };
