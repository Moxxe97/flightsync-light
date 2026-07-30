// Mobile has no folder picker; local backup targets a fixed subfolder of the
// app's Documents directory. On iOS, UIFileSharingEnabled makes it visible in
// the Files app under "On My iPhone > FlightSync Light".
import { documentDir } from '@tauri-apps/api/path';

export async function mobileBackupRoot() {
  const docs = await documentDir();
  return `${docs.replace(/\/$/, '')}/FlightSync Light Backups`;
}
