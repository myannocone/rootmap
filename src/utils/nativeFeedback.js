import { Capacitor } from '@capacitor/core';

export async function tapHaptic(kind = 'light') {
  if (!Capacitor.isNativePlatform()) return;
  const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
  const style = kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light;
  await Haptics.impact({ style });
}

let notificationsReady = false;

export async function prepareCrossFireAlerts() {
  if (!Capacitor.isNativePlatform() || notificationsReady) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const perm = await LocalNotifications.requestPermissions();
  notificationsReady = perm.display === 'granted';
}

export async function notifyCrossFire({ name, delta, mine, opp }) {
  if (!Capacitor.isNativePlatform()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await prepareCrossFireAlerts();
  if (!notificationsReady) return;
  await LocalNotifications.schedule({
    notifications: [{
      id: Math.floor(Date.now() % 2147483647),
      title: 'Cross Fire Alert',
      body: `${name} scored! You gain +${delta} in ${mine}, but Opponent gains +${delta} in ${opp}.`,
      schedule: { at: new Date(Date.now() + 800) }
    }]
  });
}
