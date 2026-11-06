// The bit of Google Identity Services the sign-in uses (loaded at runtime from accounts.google.com/gsi/client).
export {};
declare global {
  /** The One Tap prompt's moments; the methods may be missing in newer (FedCM) builds, so callers use ?.(). */
  interface GsiPromptNotification {
    isNotDisplayed?(): boolean;
    isSkippedMoment?(): boolean;
  }
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(cfg: { client_id: string; callback: (r: { credential?: string }) => void }): void;
          prompt(listener?: (n: GsiPromptNotification) => void): void;
          renderButton(parent: HTMLElement, options: { type?: 'standard' | 'icon'; theme?: 'outline' | 'filled_blue' | 'filled_black'; size?: 'small' | 'medium' | 'large'; text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'; shape?: 'rectangular' | 'pill'; width?: number }): void;
        };
      };
    };
  }
}
