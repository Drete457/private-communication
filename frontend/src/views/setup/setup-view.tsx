import { Suspense, lazy, useState } from 'react';

import { Backup, logoCompressed } from '@/assets';
import { GenericButton, SmallGenericButton } from '@/components/common/buttons/generic';
import { GenericLoader } from '@/components/common/loaders';
import { ErrorMessage } from '@/components/common/messages/error';
import { HealthCheck } from '@/components/health-check';
import { RenderIf } from '@/helpers/render-conditional';
import { clientLogger } from '@/services/logger';
import { useAuthStore } from '@/store/auth-store';
import { HealthStatus } from '@/types';

import { setupDecisionIntro, setupHero, setupHeroStats, setupHowItWorks, setupImportantNote, setupOptions } from './setup-content';

import type { FC } from 'react';

const RestoreBackupPanel = lazy(() => import('@/components/backup').then(module => ({ default: module.RestoreBackupPanel })));

const SetupView: FC = () => {
	const { generateIdentity } = useAuthStore();
	const [isGenerating, setIsGenerating] = useState<boolean>(false);
	const [restoreBackup, setRestoreBackup] = useState<boolean>(false);
	const [isRestoringBackup, setIsRestoringBackup] = useState<boolean>(false);
	const [error, setError] = useState<string | null>(null);
	const { serverStatus, HealthCheckView } = HealthCheck({ smallComponent: false });

	const isServerOnline = () => serverStatus === HealthStatus.ONLINE;

	const handleGenerateIdentity = async () => {
		if (!isServerOnline()) {
			setError('This device cannot reach your server right now. Try again in a moment.');
			return;
		}

		setIsGenerating(true);
		setError(null);

		try {
			await generateIdentity();
		} catch (err) {
			clientLogger.error('Failed to generate identity:', err);
			setError('Could not create a secure identity on this device. Please try again.');
		} finally {
			setIsGenerating(false);
		}
	};

	return (
		<div className="relative h-full overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_22%),radial-gradient(circle_at_85%_18%,rgba(251,191,36,0.08),transparent_18%),linear-gradient(180deg,rgba(6,10,18,1),rgba(4,8,15,1))]">
			<div className="pointer-events-none absolute inset-0 overflow-hidden">
				<div className="absolute left-1/2 -top-32 h-96 w-96 -translate-x-1/2 rounded-full bg-primary-500/12 blur-3xl" />
				<div className="absolute -right-20 top-32 h-72 w-72 rounded-full bg-amber-300/10 blur-3xl" />
				<div className="absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-primary-700/18 blur-3xl" />
			</div>

			<div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col gap-5 px-4 py-5 pb-[calc(var(--safe-area-bottom)+1.5rem)] sm:px-6 sm:py-7 sm:pb-[calc(var(--safe-area-bottom)+2rem)] lg:py-8">
				<section className="relative overflow-hidden rounded-4xl border border-white/10 bg-[linear-gradient(135deg,rgba(9,17,29,0.96),rgba(11,24,39,0.94)_55%,rgba(9,18,30,0.98))] shadow-[0_30px_90px_rgba(0,0,0,0.38)]">
					<div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.2),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.12),transparent_22%)]" />
					<div className="absolute inset-x-6 top-0 h-px bg-linear-to-r from-transparent via-white/16 to-transparent" />

					<div className="relative grid gap-6 px-5 py-5 sm:px-6 sm:py-6 lg:grid-cols-[minmax(0,1.2fr)_21rem] lg:gap-8 xl:px-8 xl:py-8">
						<div className="space-y-6">
							<div className="flex flex-wrap items-center gap-3 text-[0.72rem] font-semibold uppercase tracking-[0.22em]">
								<span className="rounded-full border border-primary-300/20 bg-primary-400/10 px-3 py-1.5 text-primary-100">{setupHero.eyebrow}</span>
								<span className="text-white/42">No login. No central recovery.</span>
							</div>

							<div className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
								<div className="relative mx-auto md:mx-0">
									<div className="absolute inset-[-0.9rem] rounded-[2.3rem] border border-white/8 bg-white/4" />
									<div className="relative flex h-28 w-28 items-center justify-center rounded-[1.8rem] border border-white/10 bg-white/7 p-3 shadow-[0_24px_60px_rgba(0,0,0,0.28)] sm:h-32 sm:w-32 lg:h-36 lg:w-36">
										<img src={logoCompressed} alt="App Logo" className="h-full w-full rounded-[1.4rem] object-cover" />
									</div>
								</div>

								<div className="text-center md:text-left">
									<h1 className="app-display-title text-3xl font-semibold text-white sm:text-4xl xl:text-[2.85rem] xl:leading-[1.02]">{setupHero.title}</h1>
									<p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/72 sm:text-base">{setupHero.description}</p>
									<div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
										{setupHeroStats.map((stat) => (
											<div key={stat.label} className="rounded-[1.35rem] border border-white/10 bg-black/16 px-4 py-3 text-left backdrop-blur-sm">
												<p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white/50">{stat.label}</p>
												<p className="mt-2 text-sm font-semibold text-white">{stat.value}</p>
											</div>
										))}
									</div>
								</div>
							</div>
						</div>

						<aside className="space-y-4 lg:pt-1">
							<section className="rounded-[1.7rem] border border-white/10 bg-[linear-gradient(180deg,rgba(13,28,44,0.92),rgba(8,17,29,0.94))] p-5 shadow-[0_18px_44px_rgba(0,0,0,0.22)]">
								<div className="flex items-center justify-between gap-3">
									<p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-primary-100">Setup status</p>
									<span className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${isServerOnline()
										? 'border-emerald-400/25 bg-emerald-400/12 text-emerald-100'
										: 'border-white/10 bg-white/5 text-white/58'}`}>
										<RenderIf condition={isServerOnline()}
											then="Server reachable"
											otherwise="Waiting for server"
										/>

									</span>
								</div>
								<div className="mt-4">
									<HealthCheckView />
								</div>
							</section>

							<section className="rounded-[1.7rem] border border-white/8 bg-black/16 p-5 text-sm text-white/66 backdrop-blur-sm">
								<p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-white/46">Before you choose</p>
								<p className="mt-3 leading-relaxed text-white/72">{setupImportantNote}</p>
							</section>
						</aside>
					</div>
				</section>

				<RenderIf condition={error !== null}
					then={<ErrorMessage message={error ?? ''} />}
					otherwise={null}
				/>

				<section className="relative overflow-hidden rounded-4xl border border-white/10 bg-[linear-gradient(180deg,rgba(10,19,32,0.95),rgba(7,14,25,0.98))] px-5 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.3)] sm:px-6 sm:py-6 xl:px-8 xl:py-8">
					<div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.1),transparent_26%)]" />
					<div className="relative">
						<div className="max-w-3xl">
							<p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-primary-100">{setupDecisionIntro.eyebrow}</p>
							<h2 className="app-display-title mt-2 text-2xl font-semibold text-white sm:text-[2rem] sm:leading-tight">{setupDecisionIntro.title}</h2>
							<p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/66 sm:text-[0.96rem]">{setupDecisionIntro.description}</p>
						</div>

						<div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.85fr)] xl:items-start">
							<div className="order-2 grid gap-4 lg:grid-cols-2 lg:items-start xl:order-1">
								{setupOptions.map((option) => {
									const isRestoreOption = option.id === 'restore';
									const isActivePath = isRestoreOption && restoreBackup;
									const accentToneClassName = isRestoreOption
										? 'from-amber-300/20 via-amber-300/4 to-transparent'
										: 'from-primary-300/22 via-primary-300/5 to-transparent';
									const accentLineClassName = isRestoreOption ? 'from-amber-300 to-amber-500/40' : 'from-primary-300 to-primary-500/40';
									const detailToneClassName = isRestoreOption
										? 'border-amber-300/10 bg-amber-300/6'
										: 'border-primary-300/10 bg-primary-300/6';

									return (
										<section
											key={option.id}
											className={`relative overflow-hidden rounded-[1.9rem] border p-5 shadow-[0_18px_42px_rgba(0,0,0,0.2)] sm:p-6 ${isActivePath
												? 'border-primary-300/24 bg-[linear-gradient(180deg,rgba(15,30,46,0.98),rgba(8,17,28,0.98))] shadow-[0_24px_54px_rgba(6,182,212,0.14)]'
												: 'border-white/10 bg-[linear-gradient(180deg,rgba(13,25,40,0.95),rgba(8,16,28,0.96))]'}`.trim()}
										>
											<div className={`absolute inset-x-0 top-0 h-20 bg-linear-to-b ${accentToneClassName}`} />
											<div className={`absolute inset-x-5 top-0 h-px bg-linear-to-r ${accentLineClassName}`} />

											<div className="relative space-y-5">
												<div className="flex flex-wrap items-center justify-between gap-3">
													<p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-primary-100">{option.eyebrow}</p>
													<span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-[0.68rem] font-semibold text-white/76">{option.pathLabel}</span>
												</div>

												<div>
													<h3 className="app-display-title text-[1.55rem] font-semibold text-white sm:text-[1.7rem]">{option.title}</h3>
													<p className="mt-2 text-sm leading-relaxed text-white/68">{option.description}</p>
												</div>

												<div className={`space-y-3 rounded-[1.45rem] border p-4 ${detailToneClassName}`}>
													<div>
														<p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/46">Choose this when</p>
														<p className="mt-2 text-sm leading-relaxed text-white/74">{option.chooseWhen}</p>
													</div>
													<div>
														<p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/46">What happens next</p>
														<p className="mt-2 text-sm leading-relaxed text-white/74">{option.consequence}</p>
													</div>
												</div>

												<RenderIf
													condition={!isRestoreOption}
													then={
														<GenericButton
															onClick={() => void handleGenerateIdentity()}
															disabled={isGenerating || isRestoringBackup || !isServerOnline()}
														>
															<RenderIf
																condition={isGenerating}
																then={<span className="flex items-center justify-center gap-2">Generating Secure Keys...</span>}
																otherwise={option.buttonLabel}
															/>
														</GenericButton>
													}
													otherwise={
														<RenderIf
															condition={restoreBackup}
															then={
																<div className="space-y-3 rounded-3xl border border-primary-300/16 bg-[linear-gradient(180deg,rgba(10,21,34,0.96),rgba(8,16,27,0.98))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
																	<p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary-100">Restore your continuity</p>
																	<Suspense fallback={<div className="flex min-h-64 items-center justify-center"><GenericLoader /></div>}>
																		<RestoreBackupPanel
																			disabled={isGenerating}
																			onBusyChange={setIsRestoringBackup}
																			surface="embedded"
																			showHeader={false}
																		/>
																	</Suspense>
																	<SmallGenericButton
																		onClick={() => setRestoreBackup(false)}
																		disabled={isRestoringBackup}
																		className="w-full border-white/10 bg-white/5 text-white/72 enabled:hover:border-white/20 enabled:hover:bg-white/8"
																	>
																		Close the backup option
																	</SmallGenericButton>
																</div>
															}
															otherwise={
																<GenericButton onClick={() => setRestoreBackup(true)}>
																	<span className="flex items-center justify-center gap-2">
																		<Backup className="h-5 w-5" />
																		{option.buttonLabel}
																	</span>
																</GenericButton>
															}
														/>
													}
												/>

												<p className="text-xs leading-relaxed text-white/50">{option.helper}</p>
											</div>
										</section>
									);
								})}
							</div>

							<aside className="order-1 space-y-4 xl:order-2 xl:sticky xl:top-6">
								<section className="overflow-hidden rounded-[1.9rem] border border-white/10 bg-[linear-gradient(180deg,rgba(13,27,42,0.96),rgba(8,17,29,0.98))] p-5 shadow-[0_18px_44px_rgba(0,0,0,0.2)] sm:p-6 xl:p-5">
									<p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-primary-100">Security principles</p>
									<h3 className="app-display-title mt-2 text-xl font-semibold text-white xl:text-lg">This first screen stays focused on trust</h3>
									<div className="mt-5 space-y-3 xl:mt-4 xl:space-y-2.5">
										{setupHowItWorks.map((item, index) => (
											<div key={item.text} className="rounded-[1.35rem] border border-white/8 bg-white/4 p-4 xl:p-3.5">
												<div className="flex items-start gap-3 xl:gap-2.5">
													<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary-300/18 bg-primary-400/10 text-[0.72rem] font-semibold text-primary-100 xl:h-7 xl:w-7">
														{String(index + 1).padStart(2, '0')}
													</span>
													<p className="text-sm leading-relaxed text-white/72 xl:leading-6">{item.text}</p>
												</div>
											</div>
										))}
									</div>
								</section>
							</aside>
						</div>
					</div>
				</section>
			</div>
		</div>
	);
}

export default SetupView;