export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  spots: {
    busan: ['spots', 'busan'] as const,
    detail: (id: number) => ['spots', 'detail', id] as const,
  },
  claims: {
    spot: (spotId: number) => ['claims', 'spot', spotId] as const,
  },
} as const;
