import { accessToken } from '@/auth/session';
import { API_URL } from '@/config';

/**
 * Sends a local JPEG (a poster, a profile photo) as the raw request body. The
 * generated client can't send binary bodies, so this is plain fetch; it throws
 * the API's problem details like the client does.
 */
export async function putJpeg<T>(path: string, uri: string): Promise<T> {
  const body = await (await fetch(uri)).blob();
  const token = await accessToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body,
  });
  if (!response.ok) throw await response.json().catch(() => ({ status: response.status }));
  return response.json() as Promise<T>;
}

/** An image path the API returned (/events/.../cover, /users/.../avatar) as a full URL. */
export const apiImage = (path: string) => `${API_URL}${path}`;
