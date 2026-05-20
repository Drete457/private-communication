import type { PassphraseValidationResult } from './types';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const BIP39_MIN_WORDS = 12;
const MIN_MANUAL_PASSPHRASE_LENGTH = 20;
const MAX_RECOMMENDED_UNICODE_LENGTH = 256;

const normalizeBackupPassphrase = (passphrase: string): string => {
	return passphrase.normalize('NFKC');
};

const validateBackupPassphrase = (passphrase: string): PassphraseValidationResult => {
	const normalizedPassphrase = normalizeBackupPassphrase(passphrase);
	const errors: string[] = [];
	const unicodeLength = Array.from(normalizedPassphrase).length;
	const trimmed = normalizedPassphrase.trim();
	const words = trimmed.length === 0 ? [] : trimmed.split(/ +/u);
	const hasTwelveWords = words.length >= BIP39_MIN_WORDS;
	const hasMinimumLength = unicodeLength >= MIN_MANUAL_PASSPHRASE_LENGTH;

	if (normalizedPassphrase !== trimmed)
		errors.push('Passphrase must not start or end with spaces.');

	if (CONTROL_CHARACTERS.test(normalizedPassphrase))
		errors.push('Passphrase must not contain control characters.');

	if (unicodeLength > MAX_RECOMMENDED_UNICODE_LENGTH)
		errors.push(`Passphrase must not exceed ${MAX_RECOMMENDED_UNICODE_LENGTH} Unicode characters.`);

	if (!hasMinimumLength && !hasTwelveWords)
		errors.push(`Passphrase must have at least ${MIN_MANUAL_PASSPHRASE_LENGTH} characters or ${BIP39_MIN_WORDS} space-separated words.`);

	return {
		valid: errors.length === 0,
		errors,
		normalizedPassphrase
	};
};

export {
	normalizeBackupPassphrase,
	validateBackupPassphrase
};