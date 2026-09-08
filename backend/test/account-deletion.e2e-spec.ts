import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from '../src/app-setup';
import { FirebaseService } from '../src/common/firebase/firebase.service';
import { User } from '../src/users/entities/user.entity';
import { Duel, DuelStatus } from '../src/duels/entities/duel.entity';
import {
  ScoreEvent,
  ScoreEventType,
} from '../src/scores/entities/score-event.entity';
import { UserConsent } from '../src/consents/entities/user-consent.entity';
import { Report, ReportReason } from '../src/moderation/entities/report.entity';
import { WithdrawnAccount } from '../src/account/entities/withdrawn-account.entity';
import { ConsentArchive } from '../src/account/entities/consent-archive.entity';
import { WithdrawalArchiveService } from '../src/account/withdrawal-archive.service';

const deleted: string[] = [];
const mockFirebaseService = {
  verifyIdToken: (token: string) => Promise.resolve({ uid: token }),
  deleteUser: (uid: string) => {
    deleted.push(uid);
    return Promise.resolve();
  },
};

/**
 * 계정 삭제(탈퇴) — 앱스토어·플레이스토어 필수 요건.
 *
 * 핵심 회귀 가드는 "결투 이력이 있는 유저의 탈퇴"다. duels의 참가자 FK가 NO ACTION이던
 * 시절에는 이 경우가 FK 위반(23503)으로 실패해, 결투를 한 번이라도 한 유저는 탈퇴할 수
 * 없었다. 마이그레이션(DuelUserFkSetNull)이 실제 DB에 반영됐는지를 여기서 검증한다.
 */
describe('Account deletion (e2e)', () => {
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let duelRepo: Repository<Duel>;
  let scoreRepo: Repository<ScoreEvent>;
  let consentRepo: Repository<UserConsent>;
  let reportRepo: Repository<Report>;
  let withdrawalRepo: Repository<WithdrawnAccount>;
  let archiveRepo: Repository<ConsentArchive>;
  let archiveService: WithdrawalArchiveService;
  let dataSource: DataSource;

  const truncateAll = () =>
    dataSource.query(
      'TRUNCATE TABLE "score_events", "duels", "spot_claims", "reports", "consent_archives", "withdrawn_accounts", "users" RESTART IDENTITY CASCADE',
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FirebaseService)
      .useValue(mockFirebaseService)
      .compile();

    app = configureApp(moduleFixture.createNestApplication());
    await app.init();

    userRepo = moduleFixture.get(getRepositoryToken(User));
    duelRepo = moduleFixture.get(getRepositoryToken(Duel));
    scoreRepo = moduleFixture.get(getRepositoryToken(ScoreEvent));
    consentRepo = moduleFixture.get(getRepositoryToken(UserConsent));
    reportRepo = moduleFixture.get(getRepositoryToken(Report));
    withdrawalRepo = moduleFixture.get(getRepositoryToken(WithdrawnAccount));
    archiveRepo = moduleFixture.get(getRepositoryToken(ConsentArchive));
    archiveService = moduleFixture.get(WithdrawalArchiveService);
    dataSource = moduleFixture.get(DataSource);
  });

  afterAll(async () => {
    await truncateAll();
    await app.close();
  });

  beforeEach(async () => {
    deleted.length = 0;
    await truncateAll();
  });

  // 시즌 1 안의 임의 시각. hall-of-fame.e2e-spec.ts와 같은 기준을 쓴다.
  const IN_SEASON_1 = '2026-10-15T03:00:00.000Z';

  const insertScoreEvent = (
    userId: string,
    team: string,
    type: ScoreEventType,
    personalPoints: number,
    teamPoints: number,
  ) =>
    dataSource.query(
      `INSERT INTO score_events
         ("userId","team","type","personalPoints","teamPoints","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, team, type, personalPoints, teamPoints, IN_SEASON_1],
    );

  /** 탈퇴자(A)와 상대(B)를 만들고, 둘 사이의 완료된 결투 + A의 원장 행을 남긴다. */
  async function seed() {
    const [a, b] = await userRepo.save([
      {
        firebaseUid: 'uid-del-a',
        email: 'del-a@test.com',
        nickname: 'Del A',
        nationality: 'KR',
        team: 'KR',
      },
      {
        firebaseUid: 'uid-del-b',
        email: 'del-b@test.com',
        nickname: 'Del B',
        nationality: 'JP',
        team: 'JP',
      },
    ]);
    const duel = await duelRepo.save({
      challengerId: a.id,
      opponentId: b.id,
      status: DuelStatus.COMPLETED,
      winnerId: b.id,
    });
    // createdAt을 시즌 1 윈도우(2026-09-01 ~ 12-01 KST) 안으로 명시한다 — 기본값(now)은
    // pre-season일 수 있어 랭킹 집계에 잡히지 않는다. 엔티티는 @CreateDateColumn이라
    // save()로는 지정할 수 없어 raw insert를 쓴다.
    await insertScoreEvent(a.id, 'KR', ScoreEventType.CLAIM_NEW, 100, 100);
    await insertScoreEvent(b.id, 'JP', ScoreEventType.DUEL_WIN, 30, 0);
    return { a, b, duel };
  }

  it('결투 이력이 있어도 탈퇴가 성공한다 (FK 위반 회귀 가드)', async () => {
    const { a } = await seed();

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', 'Bearer uid-del-a')
      .expect(204);

    expect(await userRepo.findOne({ where: { id: a.id } })).toBeNull();
    expect(deleted).toContain('uid-del-a');
  });

  it('결투 행은 남고 탈퇴자 참조만 NULL이 된다 (상대 전적 보존)', async () => {
    const { b, duel } = await seed();

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', 'Bearer uid-del-a')
      .expect(204);

    const kept = await duelRepo.findOne({ where: { id: duel.id } });
    expect(kept).not.toBeNull();
    expect(kept?.challengerId).toBeNull();
    // 상대방과 승자 정보는 그대로여야 한다.
    expect(kept?.opponentId).toBe(b.id);
    expect(kept?.winnerId).toBe(b.id);
  });

  it('원장 행은 남고 팀 점수가 보존된다', async () => {
    await seed();

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', 'Bearer uid-del-a')
      .expect(204);

    const events = await scoreRepo.find();
    expect(events).toHaveLength(2);
    // 탈퇴자의 원장 행은 userId만 끊기고 team·점수는 유지된다.
    const orphan = events.find((e) => e.userId === null);
    expect(orphan).toBeDefined();
    expect(orphan?.team).toBe('KR');
    expect(orphan?.teamPoints).toBe(100);
  });

  it('탈퇴자는 개인 랭킹에서 사라지고 상대는 남는다', async () => {
    await seed();

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', 'Bearer uid-del-a')
      .expect(204);

    const res = await request(app.getHttpServer())
      .get('/api/hall-of-fame/users?season=1')
      .set('Authorization', 'Bearer uid-del-b')
      .expect(200);

    const nicknames = (
      res.body as { ranking: { nickname: string }[] }
    ).ranking.map((r) => r.nickname);
    expect(nicknames).not.toContain('Del A');
    expect(nicknames).toContain('Del B');
  });

  it('약관 동의·신고 제재·계정 식별자만 가명으로 남는다', async () => {
    const { a, b } = await seed();
    await consentRepo.insert([
      { userId: a.id, document: 'service', version: '2026-09-08' },
      { userId: a.id, document: 'age14', version: '2026-09-07' },
    ]);
    await reportRepo.insert({
      reporterId: b.id,
      targetUserId: a.id,
      targetNickname: 'Del A',
      reason: ReportReason.ABUSE,
    });

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${a.firebaseUid}`)
      .expect(204);

    // 원장은 CASCADE로 사라지고, 보관 표에만 남는다.
    expect(await consentRepo.count()).toBe(0);
    const [withdrawal] = await withdrawalRepo.find();
    expect(withdrawal).toBeDefined();
    // 보관 항목은 방침 제3조 3항이 정한 이메일뿐 — userId까지 옮기면 조항을 넘어선다.
    expect(withdrawal.email).toBe('del-a@test.com');
    expect(JSON.stringify(withdrawal)).not.toContain(a.id);

    const archived = await archiveRepo.find({ order: { id: 'ASC' } });
    expect(archived.map((row) => row.document)).toEqual(['service', 'age14']);
    expect(archived.every((row) => row.withdrawalId === withdrawal.id)).toBe(
      true,
    );

    // 신고 기록은 남되(SET NULL) 누구에 대한 것이었는지가 가명으로 되살아난다.
    const [report] = await reportRepo.find();
    expect(report.targetUserId).toBeNull();
    expect(report.withdrawnTargetId).toBe(withdrawal.id);
  });

  it('탈퇴자가 이메일을 제시하면 그 기록을 찾을 수 있다 (이의제기 대응)', async () => {
    const { a, b } = await seed();
    await consentRepo.insert({
      userId: a.id,
      document: 'service',
      version: '2026-09-08',
    });
    await reportRepo.insert({
      reporterId: b.id,
      targetUserId: a.id,
      reason: ReportReason.ABUSE,
    });

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${a.firebaseUid}`)
      .expect(204);

    // 이 표가 존재하는 이유 자체 — 탈퇴 후에도 "동의를 받았고, 어떤 신고가 있었는지"에
    // 답할 수 있어야 한다.
    const found = await archiveService.findByEmail('  DEL-A@TEST.COM  ');
    expect(found).toHaveLength(1);
    expect(found[0].consents).toEqual([
      expect.objectContaining({ document: 'service', version: '2026-09-08' }),
    ]);
    expect(found[0].reports).toHaveLength(1);

    // 다른 사람의 이메일로는 아무것도 나오지 않는다.
    await expect(archiveService.findByEmail('del-b@test.com')).resolves.toEqual(
      [],
    );
  });

  it('보존기간이 지난 보관 건은 파기되고 신고 연결도 끊긴다', async () => {
    const { a, b } = await seed();
    await consentRepo.insert({
      userId: a.id,
      document: 'service',
      version: '2026-09-08',
    });
    await reportRepo.insert({
      reporterId: b.id,
      targetUserId: a.id,
      reason: ReportReason.ABUSE,
    });

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${a.firebaseUid}`)
      .expect(204);

    // withdrawnAt은 @CreateDateColumn이라 save()로 지정할 수 없어 raw update로 되돌린다.
    await dataSource.query(
      `UPDATE "withdrawn_accounts" SET "withdrawnAt" = now() - interval '7 months'`,
    );

    await expect(archiveService.purgeExpired()).resolves.toBe(1);

    // 보관 건이 사라지면 동의 사실도 FK CASCADE로 함께 파기된다 — 방침 제3조 3항의
    // "그 이후에는 서비스도 동의 사실을 확인할 수 없습니다"가 실제로 성립해야 한다.
    expect(await withdrawalRepo.count()).toBe(0);
    expect(await archiveRepo.count()).toBe(0);

    // 신고 기록 자체는 제3조 4항에 따라 남고, 탈퇴자와의 연결만 끊긴다.
    const [report] = await reportRepo.find();
    expect(report).toBeDefined();
    expect(report.withdrawnTargetId).toBeNull();
  });

  it('탈퇴 후 같은 토큰으로 조회하면 404 (계정이 실제로 사라짐)', async () => {
    await seed();

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', 'Bearer uid-del-a')
      .expect(204);

    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', 'Bearer uid-del-a')
      .expect(404);
  });

  /**
   * 진행 중인 결투를 남긴 채 탈퇴하면 참가자 한쪽만 NULL인 활성 행이 남는다. 이 행은
   * requestDuel의 hasActiveDuel 체크에 계속 잡혀 남은 상대가 새 결투를 신청하지 못하게
   * 막고, lockKey가 NULL로 계산돼 엉뚱한 페어 락을 건드린다.
   */
  it.each([
    [DuelStatus.PENDING, DuelStatus.EXPIRED],
    [DuelStatus.ACCEPTED, DuelStatus.VOID],
  ])('진행 중인 결투(%s)를 %s로 끝내고 탈퇴한다', async (from, to) => {
    const { a, b } = await seed();
    const active = await duelRepo.save({
      challengerId: a.id,
      opponentId: b.id,
      status: from,
    });

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', 'Bearer uid-del-a')
      .expect(204);

    const closed = await duelRepo.findOne({ where: { id: active.id } });
    // 활성 상태로 남으면 상대가 새 결투를 신청하지 못한다.
    expect(closed?.status).toBe(to);
    expect(closed?.challengerId).toBeNull();
    expect(closed?.opponentId).toBe(b.id);
  });

  /**
   * DB 삭제 커밋 직후 크래시하면 Firebase 계정만 남는다. 여기서 404로 막으면 같은
   * 토큰으로 재시도해도 정리할 길이 없어 그 이메일로 영구 재가입이 불가능해진다.
   */
  it('DB 프로필이 없어도 탈퇴는 204로 끝나고 Firebase 계정을 정리한다', async () => {
    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', 'Bearer uid-never-registered')
      .expect(204);

    expect(deleted).toContain('uid-never-registered');
  });
});
