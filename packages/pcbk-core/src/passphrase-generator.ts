import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

import {
	PCBK_BIP39_ENTROPY_BITS,
	PCBK_BIP39_WORD_COUNT
} from './constants';

import type { GeneratedPassphraseResult } from './types';

const generateBackupPassphrase = (): GeneratedPassphraseResult => {
	const value = generateMnemonic(wordlist, PCBK_BIP39_ENTROPY_BITS);
	const words = value.split(' ');

	if (words.length !== PCBK_BIP39_WORD_COUNT)
		throw new Error(`Generated mnemonic must contain ${PCBK_BIP39_WORD_COUNT} words`);

	return {
		standard: 'bip39',
		language: 'english',
		wordCount: PCBK_BIP39_WORD_COUNT,
		words,
		value
	};
};

export { generateBackupPassphrase };