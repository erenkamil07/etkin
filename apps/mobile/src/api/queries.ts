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
