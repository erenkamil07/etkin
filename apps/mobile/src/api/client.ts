import createClient from 'openapi-fetch';
import { accessToken, endSession } from '@/auth/session';
import { API_URL } from '@/config';
import type { paths } from './schema';

/** Typed client generated from the API's OpenAPI document (pnpm api:types). */
export const api = createClient<paths>({ baseUrl: API_URL });

api.use({
  async onRequest({ request }) {
    const token = await accessToken();
    if (token) request.headers.set('authorization', `Bearer ${token}`);
    return request;
  },
  async onResponse({ request, response }) {
    // A 401 on a request that carried a token means the session is over
    // (revoked, or the refresh failed): send the user back to sign in.
    if (response.status === 401 && request.headers.has('authorization')) await endSession();
    return response;
  },
});
