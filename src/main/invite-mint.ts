/**
 * Invite QR mint races: selectedHost can change (Settings pick / wifi hop)
 * while `QRCode.toDataURL` is awaiting. Epoch + host must still match before
 * publishing so url/host/apkUrl cannot tear across two adapters.
 */
export function inviteMintStillCurrent(input: {
  epoch: number;
  currentEpoch: number;
  host: string;
  selectedHost: string;
}): boolean {
  return (
    input.epoch === input.currentEpoch &&
    Boolean(input.host) &&
    input.host === input.selectedHost
  );
}
