import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

/**
 * `/api/docs`(Swagger UI)와 `/api/docs-json`을 붙일지.
 *
 * **프로덕션에서는 기본적으로 붙이지 않는다.** 인증 없이 공개되면 전체 엔드포인트·DTO·에러
 * 코드가 그대로 드러나, 아직 열지 않은 경로까지 포함해 공격 표면을 손에 쥐여주는 셈이다.
 * 프론트 참고용으로 열어 두던 상태였고, 실사용자 가입이 열리는 시점에 닫기로 이미 적어
 * 두었다(docs/deployment.md).
 *
 * `ENABLE_API_DOCS=true`로 한시적으로 열 수 있다. 운영 중 스펙을 확인해야 할 때를 위한
 * 탈출구이며, **기본값이 꺼짐이라 켜는 것은 항상 의도적인 행위**다. 켜 두고 잊지 말 것.
 */
export function apiDocsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ENABLE_API_DOCS === 'true') return true;
  return env.NODE_ENV !== 'production';
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
