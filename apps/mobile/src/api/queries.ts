import { useQuery } from '@tanstack/react-query';
import { api } from './client';

// Queries more than one screen reads, so they share a key and a cache entry.

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data, error } = await api.GET('/me');
      if (error) throw error;
      return data;
    },
  });
}

/** A club's public profile: its university and no-show rule, among others. */
export function useClub(orgId: string) {
  return useQuery({
    queryKey: ['orgs', orgId],
    queryFn: async () => {
      const { data, error } = await api.GET('/orgs/{orgId}', { params: { path: { orgId } } });
      if (error) throw error;
      return data;
    },
  });
}

/** Every university, for the pickers; the list only changes with an app release. */
export function useUniversities() {
  return useQuery({
    queryKey: ['universities'],
    queryFn: async () => {
      const { data, error } = await api.GET('/universities');
      if (error) throw error;
      return data;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export type University = NonNullable<ReturnType<typeof useUniversities>['data']>[number];

export function useMyTickets() {
  return useQuery({
    queryKey: ['me', 'tickets'],
    queryFn: async () => {
      const { data, error } = await api.GET('/me/tickets');
      if (error) throw error;
      return data;
    },
  });
}

export type MyTicket = NonNullable<ReturnType<typeof useMyTickets>['data']>[number];

/** Your role in a club's team, or undefined while loading or when you are not on it. */
export function useOrgRole(orgId: string) {
  const me = useMe();
  const membership = me.data?.memberships.find((item) => item.organizationId === orgId);
  return {
    membership,
    // Door scanners only scan; stats, attendee lists and manual admission are for organizers and owners.
    canManage: membership?.role === 'owner' || membership?.role === 'organizer',
  };
}
