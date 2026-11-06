// The bit of Google Identity Services the sign-in uses (loaded at runtime from accounts.google.com/gsi/client).
export {};
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(cfg: { client_id: string; callback: (r: { credential?: string }) => void }): void;
          prompt(): void;
        };
      };
    };
  }
}
