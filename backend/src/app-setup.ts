import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

/**
 * `/api/docs`(Swagger UI)와 `/api/docs-json`을 붙일지.
 *
 * **개발·테스트로 알려진 환경에서만 붙인다.** 인증 없이 공개되면 전체 엔드포인트·DTO·에러
 * 코드가 그대로 드러나, 아직 열지 않은 경로까지 포함해 공격 표면을 손에 쥐여주는 셈이다.
 * 프론트 참고용으로 열어 두던 상태였고, 실사용자 가입이 열리는 시점에 닫기로 이미 적어
 * 두었다(docs/deployment.md).
 *
 * 판정은 allow-list다 — `NODE_ENV !== 'production'`으로 뒤집으면 staging처럼 나중에 생기는
 * 배포 경로가 값을 정확히 맞추지 못했을 때 문서가 조용히 다시 열린다. 알 수 없는 값은
 * 닫힌 쪽으로 떨어뜨린다.
 *
 * 예외는 NODE_ENV가 비어 있는 경우다. `nest start`처럼 아무것도 설정하지 않고 손으로
 * 띄우는 로컬 실행이 여기 해당해, 개발로 본다. 배포 경로는 NODE_ENV를 명시하므로
 * 이 분기로 내려오지 않는다.
 *
 * `ENABLE_API_DOCS=true`로 한시적으로 열 수 있다. 운영 중 스펙을 확인해야 할 때를 위한
 * 탈출구이며, **기본값이 꺼짐이라 켜는 것은 항상 의도적인 행위**다. 켜 두고 잊지 말 것.
 */
export function apiDocsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ENABLE_API_DOCS === 'true') return true;
  const nodeEnv = env.NODE_ENV;
  if (nodeEnv === undefined || nodeEnv === '') return true;
  return nodeEnv === 'development' || nodeEnv === 'test';
}

/**
 * 전역 프리픽스·파이프·필터 등 앱 공통 구성.
 * main.ts와 e2e 테스트가 함께 사용해, 부트스트랩 구성이 바뀌어도
 * 테스트가 실제 앱과 다른 설정으로 돌지 않도록 한 곳에서 관리한다.
 */
export function configureApp<T extends INestApplication>(app: T): T {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // 모든 HTTP 에러 응답을 { statusCode, code, message, error }로 통일한다.
  app.useGlobalFilters(new HttpExceptionFilter());
  return app;
}
