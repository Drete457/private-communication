type SetupHeroStat = {
	label: string;
	value: string;
};

type SetupBullet = {
	text: string;
};

type SetupOption = {
	id: 'create' | 'restore';
	eyebrow: string;
	title: string;
	description: string;
	chooseWhen: string;
	consequence: string;
	pathLabel: string;
	helper: string;
	buttonLabel: string;
};

const setupDecisionIntro = {
	eyebrow: 'Choose your path',
	title: 'Start fresh or continue from a backup',
	description: 'Both paths stay local to this device. The difference is whether you want a new identity here or continuity with one you already trust.'
} as const;

const setupHero = {
	eyebrow: 'Private setup',
	title: 'Start a private identity on this device',
	description: 'There is no account to recover from a server and no central inbox to unlock. On this screen you either create a new local identity or restore one you already backed up.'
} as const;

const setupHeroStats: ReadonlyArray<SetupHeroStat> = [
	{ label: 'Identity', value: 'Lives on this device' },
	{ label: 'Privacy', value: 'No central account' },
	{ label: 'Continuity', value: 'Backups keep you moving' }
];

const setupHowItWorks: ReadonlyArray<SetupBullet> = [
	{ text: 'Your identity is created or restored on this device, not issued by a central service.' },
	{ text: 'Messages are encrypted before they leave the device and stay readable only to the intended contact.' },
	{ text: 'A backup is what lets you continue with the same identity on a new or reset device.' }
];

const setupImportantNote = 'Create a new identity only when you want a new start on this device. If you already have a trusted backup, restore it instead so you keep continuity.';

const setupOptions: ReadonlyArray<SetupOption> = [
	{
		id: 'create',
		eyebrow: 'Option 1',
		title: 'Create a new identity',
		description: 'Choose this when this is your first device or when you deliberately want a fresh private identity.',
		chooseWhen: 'Use this path when you are starting from zero on this device and do not want to continue an older identity.',
		consequence: 'A brand new local identity is created here, and afterwards you should export a backup so you can recover it later.',
		pathLabel: 'New start',
		helper: 'Starts a new local identity for this device.',
		buttonLabel: 'Create Your Secure Identity'
	},
	{
		id: 'restore',
		eyebrow: 'Option 2',
		title: 'Restore an existing backup',
		description: 'Choose this when you already exported a trusted backup and want the same identity to continue here.',
		chooseWhen: 'Use this path when you already have an identity backup or a full device backup that you trust.',
		consequence: 'The same identity continues on this device, which avoids splitting contacts, trust history, and future backups across multiple identities.',
		pathLabel: 'Keep continuity',
		helper: 'Brings back an identity you already trust.',
		buttonLabel: 'Restore from Backup'
	}
];

export { setupDecisionIntro, setupHero, setupHeroStats, setupHowItWorks, setupImportantNote, setupOptions };
export type { SetupBullet, SetupHeroStat, SetupOption };