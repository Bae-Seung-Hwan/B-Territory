import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * 전역 프리픽스·파이프 등 앱 공통 구성.
 * main.ts와 e2e 테스트가 함께 사용해, 부트스트랩 구성이 바뀌어도
 * 테스트가 실제 앱과 다른 설정으로 돌지 않도록 한 곳에서 관리한다.
 */
export function configureApp<T extends INestApplication>(app: T): T {
  app.setGlobalPrefix('api');

  // 이메일 인증 매직 링크(FRONTEND_URL/verify?token=...)는 브라우저에서 열리므로,
  // 그 화면이 /api/email/verify-token을 호출하려면 CORS 허용이 필요하다.
  // (네이티브 앱은 CORS 대상이 아니라 지금까지 없어도 문제가 없었다.)
  // 인증은 Authorization 헤더(Bearer)로만 하므로 credentials는 켜지 않는다.
  const corsOrigins = (process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  return app;
}
