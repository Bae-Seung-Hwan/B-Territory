import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppPermissionNotice } from '@/components/permissions/AppPermissionNotice';
import { APP_PERMISSIONS, PERMISSION_NOTICE_VERSION } from '@/constants/app-permissions';
import { i18n } from '@/i18n';
import {
  acknowledgePermissionNotice,
  getPermissionNoticeState,
} from '@/lib/permission-notice';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

/**
 * 접근권한 사전 고지 화면(정보통신망법 제22조의2 / 원스토어 반려 사유 1번).
 *
 * 문구 하나하나를 문자열로 박아 비교하지는 않는다 — 그건 i18n 파일을 두 번 적는 것에
 * 불과하다. 대신 **법이 요구하는 구성요소가 빠지지 않았는지**를 본다: 필수/선택 구분,
 * 항목별 이유, 그리고 철회 방법.
 */
describe('AppPermissionNotice', () => {
  beforeEach(() => {
    i18n.locale = 'ko';
  });

  it('필수/선택을 구분해 고지하고, 항목마다 이유와 철회 방법을 함께 보여준다', async () => {
    const { getByText } = await render(<AppPermissionNotice />);

    getByText(i18n.t('permissions.requiredSection'));
    getByText(i18n.t('permissions.optionalSection'));
    // 선택 권한이 하나도 없는 지금은 "없음"을 명시해야 한다 — 구분 자체를 생략하면
    // 필수만 적은 고지와 구별되지 않는다.
    getByText(i18n.t('permissions.noOptional'));
    getByText(i18n.t('permissions.withdraw'));

    for (const permission of APP_PERMISSIONS) {
      getByText(i18n.t(`permissions.items.${permission.key}.name`));
      getByText(i18n.t(`permissions.items.${permission.key}.purpose`));
    }
  });

  it('APP_PERMISSIONS에 등록된 항목은 ko·en 양쪽에 문구가 있어야 한다', () => {
    for (const locale of ['ko', 'en'] as const) {
      i18n.locale = locale;
      for (const permission of APP_PERMISSIONS) {
        expect(i18n.t(`permissions.items.${permission.key}.name`)).not.toMatch(/^\[missing/);
        expect(i18n.t(`permissions.items.${permission.key}.purpose`)).not.toMatch(/^\[missing/);
      }
    }
  });

  it('확인을 누르면 고지 기록이 남아 다음 실행부터는 뜨지 않는다', async () => {
    const { getByText } = await render(<AppPermissionNotice />);

    await act(async () => {
      fireEvent.press(getByText(i18n.t('permissions.confirm')));
    });

    await waitFor(() => expect(getPermissionNoticeState()).toBe('acknowledged'));
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('permission-notice', PERMISSION_NOTICE_VERSION);
  });

  it('확인한 뒤에는 화면이 닫힌다', async () => {
    await acknowledgePermissionNotice();
    const { queryByText } = await render(<AppPermissionNotice />);
    expect(queryByText(i18n.t('permissions.requiredSection'))).toBeNull();
  });
});
