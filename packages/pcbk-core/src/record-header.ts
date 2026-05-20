import { decodeCbor, encodeCanonicalCbor } from './cbor';
import { PCBK_RECORD_VERSION } from './constants';
import { isCborRecord, isNonNegativeSafeInteger, isPositiveSafeInteger } from './validation';

import type {
	BuildRecordHeaderInput,
	PCBKRecordEncoding,
	PCBKRecordHeader,
	PCBKRecordType
} from './types';

const RECORD_TYPES = new Set([
	'identity',
	'peer-keys-batch',
	'messages-batch',
	'link-previews-batch',
	'outbox-batch',
	'attachment-meta',
	'attachment-chunk',
	'transfer-queue-meta',
	'transfer-queue-chunk',
	'remote-media-meta',
	'remote-media-chunk',
	'manifest'
]);

const RECORD_ENCODINGS = new Set(['cbor', 'bytes']);

const OBJECT_ID_RECORD_TYPES = new Set([
	'attachment-meta',
	'attachment-chunk',
	'transfer-queue-meta',
	'transfer-queue-chunk',
	'remote-media-meta',
	'remote-media-chunk'
]);

const CHUNK_RECORD_TYPES = new Set([
	'attachment-chunk',
	'transfer-queue-chunk',
	'remote-media-chunk'
]);

type RecordHeaderField = 'cipherLength' | 'chunkCount' | 'chunkIndex' | 'encoding' | 'index' | 'objectId' | 'plainLength' | 'recordVersion' | 'type';
type RecordHeaderRecord = Record<string, unknown> & Partial<Record<RecordHeaderField, unknown>>;

const isRecord = (value: unknown): value is RecordHeaderRecord => {
	return isCborRecord(value);
};

const assertCondition: (condition: unknown, message: string) => asserts condition = (condition, message) => {
	if (!condition)
		throw new Error(message);
};

const isRecordType = (value: unknown): value is PCBKRecordType => {
	return typeof value === 'string' && RECORD_TYPES.has(value);
};

const isRecordEncoding = (value: unknown): value is PCBKRecordEncoding => {
	return typeof value === 'string' && RECORD_ENCODINGS.has(value);
};

const validateRecordHeader = (value: unknown): PCBKRecordHeader => {
	assertCondition(isRecord(value), 'record header must be an object');
	assertCondition(value.recordVersion === PCBK_RECORD_VERSION, `recordVersion must be ${PCBK_RECORD_VERSION}`);
	assertCondition(isRecordType(value.type), 'record type is not supported');
	assertCondition(isRecordEncoding(value.encoding), 'record encoding must be "cbor" or "bytes"');
	assertCondition(isNonNegativeSafeInteger(value.index), 'index must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.plainLength), 'plainLength must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.cipherLength), 'cipherLength must be a non-negative safe integer');

	const type = value.type;
	const objectId = value.objectId;
	const chunkIndex = value.chunkIndex;
	const chunkCount = value.chunkCount;

	if (OBJECT_ID_RECORD_TYPES.has(type))
		assertCondition(typeof objectId === 'string' && objectId.length > 0, `${type} requires objectId`);
	else if (objectId !== undefined)
		assertCondition(typeof objectId === 'string' && objectId.length > 0, 'objectId must be a non-empty string');

	if (CHUNK_RECORD_TYPES.has(type))
		assertCondition(chunkIndex !== undefined && chunkCount !== undefined, `${type} requires chunkIndex and chunkCount`);

	assertCondition((chunkIndex === undefined) === (chunkCount === undefined), 'chunkIndex and chunkCount must be provided together');

	if (chunkIndex !== undefined) {
		assertCondition(isNonNegativeSafeInteger(chunkIndex), 'chunkIndex must be a non-negative safe integer');
		assertCondition(isPositiveSafeInteger(chunkCount), 'chunkCount must be a positive safe integer');
		assertCondition(chunkIndex < chunkCount, 'chunkIndex must be lower than chunkCount');
		assertCondition(typeof objectId === 'string' && objectId.length > 0, 'chunked records require objectId');
	}

	const header: PCBKRecordHeader = {
		recordVersion: PCBK_RECORD_VERSION,
		type,
		index: value.index,
		encoding: value.encoding,
		plainLength: value.plainLength,
		cipherLength: value.cipherLength
	};

	if (typeof objectId === 'string')
		header.objectId = objectId;

	if (typeof chunkIndex === 'number')
		header.chunkIndex = chunkIndex;

	if (typeof chunkCount === 'number')
		header.chunkCount = chunkCount;

	return header;
};

const decodeRecordHeader = (headerBytes: Uint8Array): PCBKRecordHeader => {
	if (!(headerBytes instanceof Uint8Array) || headerBytes.length === 0)
		throw new Error('headerBytes must be a non-empty Uint8Array');

	return validateRecordHeader(decodeCbor(headerBytes));
};

const buildRecordHeader = (input: BuildRecordHeaderInput): Uint8Array => {
	const {
		recordVersion,
		type,
		index,
		encoding,
		plainLength,
		cipherLength,
		objectId,
		chunkIndex,
		chunkCount
	} = input;

	if (recordVersion !== PCBK_RECORD_VERSION)
		throw new Error(`recordVersion must be ${PCBK_RECORD_VERSION}`);

	if (!isNonNegativeSafeInteger(index))
		throw new Error('index must be a non-negative safe integer');

	if (!isNonNegativeSafeInteger(plainLength))
		throw new Error('plainLength must be a non-negative safe integer');

	if (!isNonNegativeSafeInteger(cipherLength))
		throw new Error('cipherLength must be a non-negative safe integer');

	if ((chunkIndex === undefined) !== (chunkCount === undefined))
		throw new Error('chunkIndex and chunkCount must be provided together');

	if (chunkIndex !== undefined && !isNonNegativeSafeInteger(chunkIndex))
		throw new Error('chunkIndex must be a non-negative safe integer');

	if (chunkCount !== undefined && !isPositiveSafeInteger(chunkCount))
		throw new Error('chunkCount must be a positive safe integer');

	if (chunkIndex !== undefined && chunkCount !== undefined && chunkIndex >= chunkCount)
		throw new Error('chunkIndex must be lower than chunkCount');

	const header: RecordHeaderRecord = {
		recordVersion,
		type,
		index,
		encoding,
		plainLength,
		cipherLength
	};

	if (objectId)
		header.objectId = objectId;

	if (chunkIndex !== undefined)
		header.chunkIndex = chunkIndex;

	if (chunkCount !== undefined)
		header.chunkCount = chunkCount;

	return encodeCanonicalCbor(header);
};

export {
	buildRecordHeader,
	decodeRecordHeader,
	validateRecordHeader
};