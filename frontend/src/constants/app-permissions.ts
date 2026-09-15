/**
 * 앱이 요구하는 단말기 접근권한의 단일 소스.
 *
 * 정보통신망법 제22조의2는 접근권한을 **필수/선택으로 구분해** 항목과 이유를 고지하고
 * 동의를 받도록 요구한다(원스토어 검수 반려 사유 1번). 고지 화면
 * (`components/permissions/AppPermissionNotice.tsx`)과 스토어 등록정보의 권한 설명이
 * 서로 다른 목록을 들고 있으면 둘 중 하나는 반드시 거짓이 되므로, 화면은 이 배열을
 * 순회해서 그리고 스토어 문구는 `docs/onestore-review.md`가 이 파일을 가리킨다.
 *
 * `androidPermissions`는 장식이 아니라 대조용이다. 실제 APK에 선언되는 권한은 우리가
 * app.config.js에 적어서가 아니라 **자동링크된 라이브러리의 AndroidManifest가 병합돼**
 * 결정되고, 그래서 손으로는 관리되지 않는다 — 실제로 expo-image와 expo-file-system이
 * READ/WRITE_EXTERNAL_STORAGE를 끌고 들어왔다(둘 다 쓰지 않는 권한이라 app.config.js의
 * `blockedPermissions`로 제거한다). 고지하지 않은 권한이 매니페스트에 들어가는 것이 반려의
 * 실제 원인이므로, 그 대조는 사람이 아니라
 * `__tests__/constants/app-permissions-manifest.test.ts`가 한다 — node_modules의 매니페스트를
 * 훑어 "고지됐거나, 차단됐거나, 일반권한"이 아닌 항목이 하나라도 있으면 실패한다.
 */
export interface AppPermission {
  /** i18n 키(`permissions.items.` 뒤에 붙는 부분) */
  key: string;
  /** 필수적 접근권한이면 true. 선택적 접근권한은 거부해도 서비스를 이용할 수 있어야 한다. */
  required: boolean;
  /** 이 항목이 대응하는 안드로이드 매니페스트 권한 */
  androidPermissions: readonly string[];
}

export const APP_PERMISSIONS: readonly AppPermission[] = [
  {
    key: 'location',
    required: true,
    androidPermissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
    ],
  },
];

export const REQUIRED_PERMISSIONS = APP_PERMISSIONS.filter((p) => p.required);
export const OPTIONAL_PERMISSIONS = APP_PERMISSIONS.filter((p) => !p.required);

/**
 * 고지 내용의 개정일(YYYY-MM-DD). **항목·목적이 바뀌면 반드시 올린다.**
 *
 * 저장소에 확인 기록으로 남는 값이 이것이라, 올리면 이미 확인한 이용자에게도 다시 고지된다.
 * 권한을 추가하고 이 값을 그대로 두면 기존 이용자는 **새 권한을 고지받지 못한 채** 그
 * 권한이 요청된다 — 법이 막으려는 상황 그 자체다.
 */
export const PERMISSION_NOTICE_VERSION = '2026-09-15';
