import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { accessToken } from '@/auth/session';
import { API_URL } from '@/config';

/** A poster ready to upload: at most 1200 px wide, saved as JPEG. */
export interface Poster {
  uri: string;
  width: number;
  height: number;
}

const MAX_WIDTH = 1200;

/**
 * Opens the phone's own photo picker (it needs no storage permission) and
 * shrinks the pick to about 200 KB, so uploads are quick on campus Wi-Fi. The
 * API strips location and camera data from what arrives either way.
 */
export async function pickPoster(): Promise<Poster | null> {
  const result = await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  const context = ImageManipulator.manipulate(asset.uri);
  if (!asset.width || asset.width > MAX_WIDTH) context.resize({ width: MAX_WIDTH });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.75 });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/** Sends the poster as raw JPEG. The generated client can't send binary bodies, so this is plain fetch. */
export async function uploadPoster(orgId: string, eventId: string, poster: Poster) {
  const body = await (await fetch(poster.uri)).blob();
  const token = await accessToken();
  const response = await fetch(`${API_URL}/orgs/${orgId}/events/${eventId}/cover`, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body,
  });
  if (!response.ok) throw await response.json().catch(() => ({ status: response.status }));
}
