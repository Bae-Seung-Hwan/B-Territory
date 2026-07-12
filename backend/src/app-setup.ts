import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * 전역 프리픽스·파이프 등 앱 공통 구성.
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
  return app;
}
