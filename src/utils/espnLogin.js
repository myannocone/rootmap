import { registerPlugin } from '@capacitor/core';

export const ESPN_LOGIN_URL = 'https://registerdisney.go.com/jfc/v5/web/client/ESPN-ONESITE.WEB-PROD/guest/login?langPref=en-US';

const EspnLogin = registerPlugin('EspnLogin');

export function openNativeEspnLogin() {
  return EspnLogin.login();
}
