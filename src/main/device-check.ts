/**
 * Remote-device probe identity. checkDevice coalesces in-flight work per id;
 * updateDevice / removeDevice bump an epoch so a probe that started against
 * host A cannot paint "online" onto host B (or a removed row).
 */

export type DeviceConnection = {
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
};

/** Stable key for the SSH endpoint a probe actually talked to. */
export function deviceConnectionKey(device: DeviceConnection): string {
  return `${device.host}|${device.user ?? ""}|${device.port ?? 22}|${device.identityFile ?? ""}`;
}

/**
 * True when the in-flight probe may still write its result onto `device`.
 * A bumped epoch, a removed row, or a host/user/port/key edit all invalidate.
 */
export function deviceCheckStillCurrent(options: {
  epoch: number;
  currentEpoch: number;
  device: DeviceConnection | undefined;
  expectedKey: string;
}): boolean {
  if (options.currentEpoch !== options.epoch) {
    return false;
  }
  if (!options.device) {
    return false;
  }
  return deviceConnectionKey(options.device) === options.expectedKey;
}
