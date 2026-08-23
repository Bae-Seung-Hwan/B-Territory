export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  spots: {
    busan: ['spots', 'busan'] as const,
    // lang이 응답 내용(description)에 영향을 주므로 키에 포함해 locale 전환 시 재조회되게 한다.
    detail: (id: number, lang: string) => ['spots', 'detail', id, lang] as const,
  },
  claims: {
    spot: (spotId: number, lang: string) => ['claims', 'spot', spotId, lang] as const,
    district: (sigunguCode: string) => ['claims', 'district', sigunguCode] as const,
  },
  districts: {
    detail: (sigunguCode: string) => ['districts', 'detail', sigunguCode] as const,
  },
  ranking: {
    teams: (season?: number) => ['ranking', 'teams', season ?? 'current'] as const,
    users: (season?: number) => ['ranking', 'users', season ?? 'current'] as const,
  },
} as const;
