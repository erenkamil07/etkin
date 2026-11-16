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
    // A new club prepares drafts until a platform admin approves it; then it can publish.
    approved: membership?.clubStatus === 'approved',
  };
}

/** Clubs waiting for approval; only platform admins ask (the tab bar shows how many). */
export function useClubApplications() {
  const me = useMe();
  return useQuery({
    queryKey: ['admin', 'club-applications'],
    queryFn: async () => {
      const { data, error } = await api.GET('/admin/club-applications');
      if (error) throw error;
      return data;
    },
    enabled: me.data?.platformRole === 'admin',
    refetchInterval: 5 * 60_000,
  });
}

export type ClubApplication = NonNullable<ReturnType<typeof useClubApplications>['data']>[number];

/** Your membership of a club (asked, member or refused), or undefined if you never asked or left. */
export function useClubMembership(orgId: string) {
  const me = useMe();
  return me.data?.clubs.find((club) => club.organizationId === orgId);
}

/** A club's waiting requests or its members, for organizers. */
export function useMembershipList(orgId: string, status: 'pending' | 'approved', enabled: boolean) {
  return useQuery({
    queryKey: ['orgs', orgId, 'memberships', status],
    queryFn: async () => {
      const { data, error } = await api.GET('/orgs/{orgId}/memberships', {
        params: { path: { orgId }, query: { status } },
      });
      if (error) throw error;
      return data;
    },
    enabled,
  });
}

export type ClubMember = NonNullable<ReturnType<typeof useMembershipList>['data']>[number];

/** What waits on the Profil tab: club applications (admins) and membership requests (organizers). */
export function useProfileBadge() {
  const me = useMe();
  const applications = useClubApplications().data?.length ?? 0;
  const requests = me.data?.memberships.reduce((sum, club) => sum + club.pendingRequests, 0) ?? 0;
  return applications + requests;
}
