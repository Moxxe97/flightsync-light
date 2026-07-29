// Which Tauri platform are we on? Backed by the `platform_name` Rust command
// so we don't need the os plugin. Cached: the answer can't change at runtime.
import { invoke } from '@tauri-apps/api/core';

let _platform = null;

export async function getPlatform() {
  if (!_platform) _platform = await invoke('platform_name');
  return _platform;
}

export async function isMobilePlatform() {
  const p = await getPlatform();
  return p === 'android' || p === 'ios';
}
