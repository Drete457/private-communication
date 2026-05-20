import type { AttachmentErrorCode, AttachmentErrorDetails, AttachmentKind, AttachmentMimePolicy, AttachmentPolicyLimits } from '../types';

const MB = 1024 * 1024;

const parseMegabytesToBytes = (value: string | undefined, fallbackMb: number): number => {
  const parsed = Number(value ?? fallbackMb);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMb * MB;
  }

  return Math.floor(parsed * MB);
};

const ATTACHMENT_MIME_TYPE_ENV_CONFIG: Array<{ kind: AttachmentKind; value: string | undefined }> = [
  { kind: 'audio', value: process.env['ATTACHMENTS_ALLOWED_AUDIO_MIME_TYPES'] },
  { kind: 'image', value: process.env['ATTACHMENTS_ALLOWED_IMAGE_MIME_TYPES'] },
  { kind: 'video', value: process.env['ATTACHMENTS_ALLOWED_VIDEO_MIME_TYPES'] },
  { kind: 'document', value: process.env['ATTACHMENTS_ALLOWED_DOCUMENT_MIME_TYPES'] },
  { kind: 'other', value: process.env['ATTACHMENTS_ALLOWED_FILE_MIME_TYPES'] }
];

const parseAllowedMimeTypes = (value: string | undefined): string[] => {
  if (!value) 
    return [];

  const parsed = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return parsed;
};

const buildMimePoliciesFromTypedConfiguration = (): AttachmentMimePolicy[] => {
  const nextPolicies: AttachmentMimePolicy[] = [];

  for (const { kind, value } of ATTACHMENT_MIME_TYPE_ENV_CONFIG) {
    const configuredRules = parseAllowedMimeTypes(value);

    for (const rule of configuredRules) {
      nextPolicies.push({ kind, rule });
    }
  }

  return nextPolicies;
};

const buildAttachmentMimePolicies = (): AttachmentMimePolicy[] => {
  const rawPolicies = buildMimePoliciesFromTypedConfiguration();

  const dedupedPolicies = new Map<string, AttachmentMimePolicy>();
  for (const policy of rawPolicies) {
    dedupedPolicies.set(`${policy.kind}:${policy.rule}`, policy);
  }

  return Array.from(dedupedPolicies.values());
};

const attachmentMimePolicies = buildAttachmentMimePolicies();

export const attachmentPolicyLimits: AttachmentPolicyLimits = {
  fileMaxBytes: parseMegabytesToBytes(process.env['ATTACHMENTS_MAX_FILE_MB'], 120),
  audioMaxBytes: parseMegabytesToBytes(process.env['ATTACHMENTS_MAX_AUDIO_MB'], 10),
  imageMaxBytes: parseMegabytesToBytes(process.env['ATTACHMENTS_MAX_IMAGE_MB'], 25),
  videoMaxBytes: parseMegabytesToBytes(process.env['ATTACHMENTS_MAX_VIDEO_MB'], 120),
  documentMaxBytes: parseMegabytesToBytes(process.env['ATTACHMENTS_MAX_DOCUMENT_MB'], 25),
  mimePolicies: attachmentMimePolicies,
  allowedMimeTypes: attachmentMimePolicies.map((policy) => policy.rule)
};

const startsWithMimeRule = (mimeType: string, rule: string): boolean => {
  if (rule.endsWith('/')) {
    return mimeType.startsWith(rule);
  }
  return mimeType === rule;
};

export const isMimeTypeAllowed = (mimeType: string): boolean => {
  if (!mimeType) {
    return false;
  }

  return attachmentPolicyLimits.mimePolicies.some((policy) => startsWithMimeRule(mimeType, policy.rule));
};

export const getAttachmentKindFromMimeType = (mimeType: string): AttachmentKind => {
  const configuredPolicy = attachmentPolicyLimits.mimePolicies.find((policy) => startsWithMimeRule(mimeType, policy.rule));
  if (configuredPolicy)
    return configuredPolicy.kind;

  return 'other';
};

export const getMaxBytesForAttachmentKind = (kind: AttachmentKind): number => {
  switch (kind) {
    case 'audio':
      return attachmentPolicyLimits.audioMaxBytes;
    case 'image':
      return attachmentPolicyLimits.imageMaxBytes;
    case 'video':
      return attachmentPolicyLimits.videoMaxBytes;
    case 'document':
      return attachmentPolicyLimits.documentMaxBytes;
    case 'other':
    default:
      return attachmentPolicyLimits.fileMaxBytes;
  }
};

const getSizeErrorCodeForKind = (kind: AttachmentKind): AttachmentErrorCode => {
  switch (kind) {
    case 'audio':
      return 'FILE_TOO_LARGE_AUDIO';
    case 'image':
      return 'FILE_TOO_LARGE_IMAGE';
    case 'video':
      return 'FILE_TOO_LARGE_VIDEO';
    case 'document':
      return 'FILE_TOO_LARGE_DOCUMENT';
    case 'other':
      return 'FILE_TOO_LARGE_FILE';
    default:
      return 'FILE_TOO_LARGE_FILE';
  }
};

export const getAttachmentSizeError = (
  kind: AttachmentKind,
  sizeBytes: number
): { code: AttachmentErrorCode; details: AttachmentErrorDetails } | null => {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return {
      code: 'INVALID_FILE_METADATA',
      details: {
        actualBytes: sizeBytes
      }
    };
  }

  const kindLimit = getMaxBytesForAttachmentKind(kind);
  if (sizeBytes > kindLimit) {
    return {
      code: getSizeErrorCodeForKind(kind),
      details: {
        kind,
        maxBytes: kindLimit,
        actualBytes: sizeBytes
      }
    };
  }

  return null;
};

export const getMaxAttachmentUploadBytes = (): number => Math.max(
  attachmentPolicyLimits.fileMaxBytes,
  attachmentPolicyLimits.audioMaxBytes,
  attachmentPolicyLimits.imageMaxBytes,
  attachmentPolicyLimits.videoMaxBytes,
  attachmentPolicyLimits.documentMaxBytes
);
