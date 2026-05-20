import { signedFetch } from '@/helpers/messages/http-auth';
import { parseJsonResponse } from '@/helpers/validation';
import { clientLogger } from '@/services/logger';
import type { AttachmentErrorCode, AttachmentKind, AttachmentPolicy } from '@/types';

let runtimeAttachmentPolicies: AttachmentPolicy[] = [];
const attachmentPolicyListeners = new Set<() => void>();
const ATTACHMENT_POLICY_CACHE_KEY = 'attachment-policy-cache';
const ATTACHMENT_POLICY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ATTACHMENT_KINDS = ['audio', 'image', 'video', 'document', 'other'] as const;

type AttachmentMimePolicy = {
	rule: string;
	kind: AttachmentKind;
};

type AttachmentPolicyResponse = {
	version: string;
	maxFileBytes: number;
	maxByKind: {
		audio: number;
		image: number;
		video: number;
		document: number;
	};
	allowedMimeTypes: string[];
	mimePolicies?: AttachmentMimePolicy[];
};

type AttachmentPolicyCache = {
	policy: AttachmentPolicyResponse;
	cachedAt: number;
};

type AttachmentPolicyRecordKey =
	| 'allowedMimeTypes'
	| 'audio'
	| 'cachedAt'
	| 'document'
	| 'image'
	| 'kind'
	| 'maxByKind'
	| 'maxFileBytes'
	| 'mimePolicies'
	| 'policy'
	| 'rule'
	| 'version'
	| 'video';

type AttachmentPolicyRecord = Record<string, unknown> & Partial<Record<AttachmentPolicyRecordKey, unknown>>;

const isRecord = (value: unknown): value is AttachmentPolicyRecord => (
	typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isAttachmentKind = (value: unknown): value is AttachmentKind => (
	typeof value === 'string' && ATTACHMENT_KINDS.includes(value as AttachmentKind)
);

const parseMimePolicies = (value: unknown): AttachmentMimePolicy[] | null | undefined => {
	if (value === undefined)
		return undefined;

	if (!Array.isArray(value))
		return null;

	const policies: AttachmentMimePolicy[] = [];
	for (const entry of value) {
		if (!isRecord(entry))
			return null;

		const { rule, kind } = entry;
		if (typeof rule !== 'string' || rule.length === 0 || !isAttachmentKind(kind))
			return null;

		policies.push({ rule, kind });
	}

	return policies;
};

const parseAttachmentPolicyResponse = (value: unknown): AttachmentPolicyResponse | null => {
	if (!isRecord(value))
		return null;

	const { version, maxFileBytes, maxByKind, allowedMimeTypes, mimePolicies } = value;
	if (typeof version !== 'string' || version.length === 0)
		return null;

	if (typeof maxFileBytes !== 'number' || !Number.isFinite(maxFileBytes) || maxFileBytes <= 0)
		return null;

	if (!isRecord(maxByKind))
		return null;

	const { audio, image, video, document } = maxByKind;
	if (
		typeof audio !== 'number'
		|| typeof image !== 'number'
		|| typeof video !== 'number'
		|| typeof document !== 'number'
		|| !Number.isFinite(audio)
		|| !Number.isFinite(image)
		|| !Number.isFinite(video)
		|| !Number.isFinite(document)
		|| audio <= 0
		|| image <= 0
		|| video <= 0
		|| document <= 0
	)
		return null;

	if (!Array.isArray(allowedMimeTypes) || !allowedMimeTypes.every((rule): rule is string => typeof rule === 'string' && rule.length > 0))
		return null;

	const parsedMimePolicies = parseMimePolicies(mimePolicies);
	if (parsedMimePolicies === null)
		return null;

	return {
		version,
		maxFileBytes,
		maxByKind: {
			audio,
			image,
			video,
			document
		},
		allowedMimeTypes,
		...(parsedMimePolicies !== undefined ? { mimePolicies: parsedMimePolicies } : {})
	};
};

const parseAttachmentPolicyCache = (value: unknown): AttachmentPolicyCache | null => {
	if (!isRecord(value))
		return null;

	const policy = parseAttachmentPolicyResponse(value.policy);
	const cachedAt = value.cachedAt;
	if (!policy || typeof cachedAt !== 'number' || !Number.isFinite(cachedAt))
		return null;

	return { policy, cachedAt };
};

const getMaxBytesForKind = (policy: AttachmentPolicyResponse, kind: AttachmentKind): number => {
	switch (kind) {
		case 'audio':
			return policy.maxByKind.audio;
		case 'image':
			return policy.maxByKind.image;
		case 'video':
			return policy.maxByKind.video;
		case 'document':
			return policy.maxByKind.document;
		case 'other':
		default:
			return policy.maxFileBytes;
	}
};

const notifyAttachmentPolicyListeners = (): void => {
	for (const listener of attachmentPolicyListeners) 
		listener();
};

const setRuntimeAttachmentPolicies = (policies: AttachmentPolicy[]): void => {
	runtimeAttachmentPolicies = policies;
	notifyAttachmentPolicyListeners();
};

const matchesMimeRule = (mimeType: string, rule: string): boolean => {
	if (rule.endsWith('/')) 
		return mimeType.startsWith(rule);

	return mimeType === rule;
};

const resolvePolicyForMimeType = (mimeType: string): AttachmentPolicy | null => {
	for (const policy of runtimeAttachmentPolicies) {
		if (policy.mimeRules.some((rule) => matchesMimeRule(mimeType, rule))) 
			return policy;
	}

	return null;
};

const getAttachmentKindByMimeType = (mimeType: string): AttachmentKind => {
	const policy = resolvePolicyForMimeType(mimeType);
	return policy?.kind ?? 'other';
};

const mapBackendPolicy = (policy: AttachmentPolicyResponse): AttachmentPolicy[] => {
	if (Array.isArray(policy.mimePolicies) && policy.mimePolicies.length > 0) {
		const groupedRules = new Map<AttachmentKind, string[]>();

		for (const mimePolicy of policy.mimePolicies) {
			const existing = groupedRules.get(mimePolicy.kind) ?? [];
			existing.push(mimePolicy.rule);
			groupedRules.set(mimePolicy.kind, existing);
		}

		const nextPolicies: AttachmentPolicy[] = [];
		for (const [kind, mimeRules] of groupedRules.entries()) {
			nextPolicies.push({
				kind,
				mimeRules,
				maxBytes: getMaxBytesForKind(policy, kind)
			});
		}

		return nextPolicies;
	}

	return [];
};

const applyAttachmentPolicy = (policy: AttachmentPolicyResponse): boolean => {
	const mapped = mapBackendPolicy(policy);
	if (mapped.length === 0) {
		if (runtimeAttachmentPolicies.length > 0) 
			setRuntimeAttachmentPolicies([]);

		return false;
	}
	
	setRuntimeAttachmentPolicies(mapped);
	return true;
};

const readCachedAttachmentPolicy = (): AttachmentPolicyResponse | null => {
	if (typeof window === 'undefined') 
		return null;

	try {
		const raw = window.localStorage.getItem(ATTACHMENT_POLICY_CACHE_KEY);
		if (!raw) 
			return null;

		const parsed = parseAttachmentPolicyCache(JSON.parse(raw));
		if (!parsed) {
			window.localStorage.removeItem(ATTACHMENT_POLICY_CACHE_KEY);
			return null;
		}

		if (Date.now() - parsed.cachedAt > ATTACHMENT_POLICY_CACHE_TTL_MS) {
			window.localStorage.removeItem(ATTACHMENT_POLICY_CACHE_KEY);
			return null;
		}

		return parsed.policy;
	} catch {
		window.localStorage.removeItem(ATTACHMENT_POLICY_CACHE_KEY);
		return null;
	}
};

const writeCachedAttachmentPolicy = (policy: AttachmentPolicyResponse): void => {
	if (typeof window === 'undefined') 
		return;

	try {
		const payload: AttachmentPolicyCache = {
			policy,
			cachedAt: Date.now()
		};
		window.localStorage.setItem(ATTACHMENT_POLICY_CACHE_KEY, JSON.stringify(payload));
	} catch (error) {
		clientLogger.debug('Failed to write attachment policy cache:', error);
	}
};

const fetchAttachmentPolicyFromServer = async (): Promise<AttachmentPolicyResponse | null> => {
	try {
		const response = await signedFetch('/api/attachments/policy');
		if (!response.ok) {
			return null;
		}

		return await parseJsonResponse(response, parseAttachmentPolicyResponse, 'attachment policy');
	} catch {
		return null;
	}
};

const loadAttachmentPolicy = async (): Promise<boolean> => {
	const cachedPolicy = readCachedAttachmentPolicy();
	if (cachedPolicy && applyAttachmentPolicy(cachedPolicy))
		return true;

	const policy = await fetchAttachmentPolicyFromServer();
	if (!policy) 
		return false;

	if (!applyAttachmentPolicy(policy)) 
		return false;

	writeCachedAttachmentPolicy(policy);
	return true;
};

const getAttachmentPoliciesSnapshot = (): ReadonlyArray<AttachmentPolicy> => runtimeAttachmentPolicies;

const subscribeAttachmentPolicies = (listener: () => void): (() => void) => {
	attachmentPolicyListeners.add(listener);

	return () => {
		attachmentPolicyListeners.delete(listener);
	};
};

type FileValidationResult = {
	ok: true;
	kind: AttachmentKind;
	policy: AttachmentPolicy;
} | {
	ok: false;
	errorCode: AttachmentErrorCode;
	errorMessage: string;
};

const validateAttachmentFile = (file: File): FileValidationResult => {
	if (file.name.length === 0 || file.type.length === 0 || !Number.isFinite(file.size) || file.size <= 0) 
		return {
			ok: false,
			errorCode: 'INVALID_FILE_METADATA',
			errorMessage: 'Invalid file metadata.'
		};

	const policy = resolvePolicyForMimeType(file.type);
	if (!policy && runtimeAttachmentPolicies.length > 0) 
		return {
			ok: false,
			errorCode: 'FILE_TYPE_NOT_ALLOWED',
			errorMessage: 'This file type is not allowed.'
		};

	const effectivePolicy: AttachmentPolicy = policy ?? {
		kind: getAttachmentKindByMimeType(file.type),
		mimeRules: [file.type],
		maxBytes: undefined
	};

	return {
		ok: true,
		kind: effectivePolicy.kind,
		policy: effectivePolicy
	};
};

export {
	getAttachmentPoliciesSnapshot,
	getAttachmentKindByMimeType,
	loadAttachmentPolicy,
	subscribeAttachmentPolicies,
	validateAttachmentFile
};

export type { FileValidationResult };
