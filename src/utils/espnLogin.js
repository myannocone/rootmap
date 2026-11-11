import { registerPlugin } from '@capacitor/core';

export const ESPN_LOGIN_URL = 'https://www.espn.com/login';

const EspnLogin = registerPlugin('EspnLogin');

export function openNativeEspnLogin() {
  return EspnLogin.login();
}
