import createClient from 'openapi-fetch';
import { API_URL } from '@/config';
import type { paths } from './schema';

/** Unauthenticated client, for the session code itself (login, refresh). */
export const publicApi = createClient<paths>({ baseUrl: API_URL });
