export * from './constants';
export type * from './types';

export {
	decodeCbor,
	encodeCanonicalCbor
} from './cbor';
export { deriveRootKey } from './argon2';
export { deriveSubkey } from './hkdf';
export { randomBytes } from './random';
export {
	parsePrelude,
	readUint32LittleEndian
} from './prelude';
export {
	authenticateHeader,
	buildClearHeader,
	buildKeyWrapAadHeader,
	decodeClearHeader,
	unwrapContentKey,
	validateClearHeader,
	verifyHeaderAuthentication,
	wrapContentKey
} from './header';
export {
	buildRecordHeader,
	decodeRecordHeader,
	validateRecordHeader
} from './record-header';
export {
	buildRecordNonce,
	decryptRecord,
	encryptRecord
} from './record-encryption';
export {
	assertManifestMatchesExpected,
	createManifestBuilder,
	validateManifestPayload
} from './manifest';
export {
	normalizeBackupPassphrase,
	validateBackupPassphrase
} from './passphrase-policy';
export { generateBackupPassphrase } from './passphrase-generator';