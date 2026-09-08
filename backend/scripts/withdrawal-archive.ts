/**
 * 탈퇴 보관 기록 열람·파기 — 개인정보처리방침 제7조 4항의 운영 경로.
 *
 * 조항은 이용자가 자기 동의 이력의 **열람과 파기를 요구**할 수 있다고 정한다. 그 요구를
 * 실행할 수단이 없으면 조항이 거짓이 되므로 여기에 둔다.
 *
 * **HTTP로 열지 않는다.** 이메일만 넣으면 가입·제재 이력이 드러나는 조회라, 공개되는 순간
 * 방침 제3조 3항이 스스로 금지한 용도(탈퇴자 식별·재가입 제한)의 도구가 된다. 서버에 접근
 * 가능한 운영자만 실행할 수 있는 스크립트로 두는 것이 접근 권한을 "증명이 필요한 경우로
 * 제한한다"(제9조 4항)에 맞는 형태다.
 *
 * 사용:
 *   npm run archive:show  -- someone@example.com
 *   npm run archive:erase -- someone@example.com
 *
 * 서비스 로직을 그대로 쓴다 — 이메일 정규화나 CASCADE 전제를 스크립트가 다시 구현하면
 * 그때부터 프로덕션과 다르게 동작할 수 있다.
 */
import dataSource from '../src/data-source';
import { WithdrawalArchiveService } from '../src/account/withdrawal-archive.service';
import { WithdrawnAccount } from '../src/account/entities/withdrawn-account.entity';
import { ConsentArchive } from '../src/account/entities/consent-archive.entity';
import { Report } from '../src/moderation/entities/report.entity';

type Command = 'show' | 'erase';

function parseArgs(argv: string[]): { command: Command; email: string } {
  const [command, email] = argv.slice(2);
  if ((command !== 'show' && command !== 'erase') || !email) {
    throw new Error(
      '사용법: withdrawal-archive.ts <show|erase> <email>\n' +
        '  show  — 보관된 동의 사실과 신고 이력을 출력한다\n' +
        '  erase — 그 이용자의 보관 건을 파기한다 (되돌릴 수 없다)',
    );
  }
  return { command, email };
}

async function main() {
  const { command, email } = parseArgs(process.argv);

  await dataSource.initialize();
  try {
    const service = new WithdrawalArchiveService(
      dataSource.getRepository(WithdrawnAccount),
      dataSource.getRepository(ConsentArchive),
      dataSource.getRepository(Report),
    );

    if (command === 'show') {
      const records = await service.findByEmail(email);
      if (records.length === 0) {
        console.log('보관된 기록이 없습니다.');
        return;
      }
      // 한 주소로 여러 건이 나올 수 있다 — 탈퇴 후 재가입해 다시 탈퇴한 경우다.
      for (const [i, record] of records.entries()) {
        console.log(
          `\n[${i + 1}/${records.length}] 탈퇴 ${record.withdrawnAt.toISOString()}`,
        );
        console.log('  동의:');
        for (const c of record.consents) {
          console.log(
            `    - ${c.document} (개정일 ${c.version}) @ ${c.agreedAt.toISOString()}`,
          );
        }
        console.log(`  신고 접수 ${record.reports.length}건:`);
        for (const r of record.reports) {
          console.log(
            `    - #${r.id} ${r.reason} / ${r.status} @ ${r.createdAt.toISOString()}`,
          );
        }
      }
      return;
    }

    // 파기는 되돌릴 수 없고, 실행 이후로는 그 이용자에게 동의를 받았다는 사실을 증명할 수
    // 없다(제7조 4항). 요구를 접수할 때 그 점을 안내했는지 확인하고 실행할 것.
    const removed = await service.deleteByEmail(email);
    console.log(
      removed > 0
        ? `보관 건 ${removed}건을 파기했습니다. 이 이용자의 동의 사실은 더 이상 증명할 수 없습니다.`
        : '파기할 보관 건이 없습니다.',
    );
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
