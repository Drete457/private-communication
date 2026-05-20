interface WPAState {
  readonly manifestLoaded: boolean;
  readonly serviceWorkerActive: boolean;
  readonly installAvailable: boolean;
  readonly standaloneMode: boolean;
}

export type { WPAState };