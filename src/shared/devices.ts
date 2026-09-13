/**
 * Paired-device helpers shared by the host snapshot path and the renderer
 * chrome (header / tray copy). No Node or Electron imports.
 */

export type DeviceLike = { role: string; online?: boolean };

/** Count online phones without allocating a filtered array. */
export function countOnlinePhones(devices: Iterable<DeviceLike>): number {
  let count = 0;
  for (const device of devices) {
    if (device.role === "phone" && device.online) {
      count += 1;
    }
  }
  return count;
}

/** "没有手机在线" / "N 台手机在线" — tray row and board header. */
export function phonesOnlineLabel(phones: number): string {
  return phones ? `${phones} 台手机在线` : "没有手机在线";
}
