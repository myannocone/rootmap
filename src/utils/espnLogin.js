import { registerPlugin } from '@capacitor/core';

const EspnLogin = registerPlugin('EspnLogin');

export function openNativeEspnLogin() {
  return EspnLogin.login();
}
