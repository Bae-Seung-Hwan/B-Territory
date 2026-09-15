import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';
import { APP_PERMISSIONS } from '@/constants/app-permissions';

/**
 * **고지한 접근권한과 실제 APK에 선언되는 접근권한이 어긋나지 않는지** 본다.
 *
 * 이 어긋남이 원스토어 반려 사유 1번의 실제 내용이다. 그리고 손으로 관리할 수 없는
 * 종류의 어긋남이다 — 권한은 우리가 app.config.js에 적어서가 아니라, 자동링크된
 * 네이티브 모듈이 **자기 AndroidManifest.xml에 적어둔 것이 병합돼** 들어온다.
 * 실제로 expo-file-system은 직접 의존성도 아니고 src/ 어디에서도 import하지 않는데
 * READ/WRITE_EXTERNAL_STORAGE를 끌고 들어왔다(그래서 app.config.js가 막는다).
 *
 * 그러므로 의존성을 추가·갱신할 때 자동으로 걸리는 그물이 필요하다. 라이브러리가
 * 선언하는 모든 권한은 셋 중 하나여야 한다.
 *   1. `APP_PERMISSIONS`에 고지돼 있거나
 *   2. `app.config.js`의 `blockedPermissions`로 제거되거나
 *   3. 아래 일반권한(normal permission) 목록에 있거나
 * 셋 다 아니면 테스트가 깨지고, 그때 "고지할 것인가 막을 것인가"를 결정하게 된다.
 */

// 단말기의 정보·기능에 접근하는 권한이 아니라 OS가 설치 시점에 자동 부여하는 일반권한.
// 가이드가 고지를 요구하는 "접근권한"이 아니다(이용자에게 동의를 묻지도 않는다).
// 여기에 항목을 추가할 때는 그것이 정말 normal permission인지 확인할 것 —
// https://developer.android.com/reference/android/Manifest.permission
const NORMAL_PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.WAKE_LOCK',
  'android.permission.VIBRATE',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.RECEIVE_BOOT_COMPLETED',
];

/**
 * node_modules 1-depth(스코프 패키지는 2-depth)에서 표준 위치의 AndroidManifest를 모은다.
 *
 * react-native 코어처럼 다른 경로(`ReactAndroid/src/main`)에 두는 예외까지 쫓지는 않는다 —
 * 이 그물이 잡으려는 것은 무심코 추가한 Expo/RN 커뮤니티 모듈이고, 그쪽은 전부 이 규약을
 * 따른다. 코어의 권한은 바뀌는 일이 없어 손으로 확인하는 편이 맞다.
 */
function collectLibraryPermissions(): Map<string, string[]> {
  const root = join(__dirname, '..', '..', '..', 'node_modules');
  const byPermission = new Map<string, string[]>();

  const packageDirs: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      const scopeRoot = join(root, entry);
      for (const scoped of readdirSync(scopeRoot)) packageDirs.push(join(scopeRoot, scoped));
      continue;
    }
    packageDirs.push(join(root, entry));
  }

  for (const dir of packageDirs) {
    const manifest = join(dir, 'android', 'src', 'main', 'AndroidManifest.xml');
    if (!existsSync(manifest)) continue;
    const xml = readFileSync(manifest, 'utf8');
    for (const match of xml.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)) {
      const owners = byPermission.get(match[1]) ?? [];
      owners.push(relative(root, dir).split(sep).join('/'));
      byPermission.set(match[1], owners);
    }
  }
  return byPermission;
}

describe('선언되는 접근권한과 고지 목록', () => {
  // app.config.js는 지도 API 키를 환경변수에서 강제로 읽는다(없으면 throw) — 여기서는
  // 권한 목록만 보므로 자리값을 채워 로드한다.
  process.env.GOOGLE_MAPS_ANDROID_API_KEY ??= 'test-key';
  const { expo } = require('../../../app.config.js');
  const blocked: string[] = expo.android.blockedPermissions ?? [];
  const disclosed = APP_PERMISSIONS.flatMap((p) => p.androidPermissions);

  it('라이브러리가 선언하는 권한은 모두 고지됐거나, 차단됐거나, 일반권한이다', () => {
    const undisclosed: string[] = [];
    for (const [permission, owners] of collectLibraryPermissions()) {
      if (disclosed.includes(permission)) continue;
      if (blocked.includes(permission)) continue;
      if (NORMAL_PERMISSIONS.includes(permission)) continue;
      undisclosed.push(`${permission} (${owners.join(', ')})`);
    }

    // 실패하면 새 의존성이 고지하지 않은 접근권한을 APK에 넣은 것이다. 고지 목록
    // (constants/app-permissions.ts + i18n + ONEconsole 권한 설명)에 추가하거나,
    // 쓰지 않는 권한이면 app.config.js의 blockedPermissions로 막는다.
    expect(undisclosed).toEqual([]);
  });

  it('고지한 권한을 차단하지는 않았는지 — 둘 다 걸리면 권한 없이 기능이 죽는다', () => {
    expect(disclosed.filter((p) => blocked.includes(p))).toEqual([]);
  });

  it('위치 권한은 실제로 어떤 라이브러리가 선언하고 있어야 한다 — 고지만 하고 선언이 없으면 반대 방향의 거짓이다', () => {
    const declared = collectLibraryPermissions();
    for (const permission of disclosed) {
      expect(declared.has(permission)).toBe(true);
    }
  });
});
