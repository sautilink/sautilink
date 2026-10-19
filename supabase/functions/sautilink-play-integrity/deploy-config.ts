/** Public configuration only. Never place a service-account key or API token here. */
export const EXPECTED_GOOGLE_PROJECT_ID = "sautilink";
export const DEFAULT_CLOUD_PROJECT_NUMBER = "93555813548";

// Monitor-only default. PLAY_INTEGRITY_MODE=off disables sampling.
// Runtime configuration and authentication remain required.
export const DEFAULT_MONITOR_ENABLED = true;

// Use the Play APP SIGNING certificate, not the upload-key certificate.
// Verified in Play Console's generated Digital Asset Links JSON on 2026-10-19.
export const DEFAULT_ALLOWED_CERTIFICATE_SHA256: readonly string[] = [
  "5E:2C:6C:AD:1B:37:E6:FC:B5:C4:73:87:38:4F:D4:6D:2D:D0:68:6C:D3:45:66:4D:10:81:11:8B:96:B6:62:9D",
];
