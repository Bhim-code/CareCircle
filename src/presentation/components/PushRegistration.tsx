import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { createPushEvents, createPushRegistry } from '@/container';
import { PUSH_REGISTER_INTERVAL_MS } from '@/application/pushRegistration';
import { useAlarms } from '@/presentation/providers/AlarmProvider';
import { useAuth } from '@/presentation/providers/AuthProvider';

const events = createPushEvents();

/**
 * Keeps the server pointed at this phone for notifications, and opens the medicines when one
 * is tapped. Renders nothing. It never asks for permission: the person gives that on the
 * settings screen, and this notices when they do.
 */
export function PushRegistration() {
  const { user } = useAuth();
  const { permission } = useAlarms();
  const router = useRouter();
  const userId = user?.id ?? null;

  useEffect(() => {
    const registry = createPushRegistry();
    if (!registry || !userId) return;
    const run = () => void registry.register(userId);
    run();
    const timer = setInterval(run, PUSH_REGISTER_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
    // Registers again when the person allows or blocks notifications.
  }, [userId, permission]);

  useEffect(() => {
    if (!createPushRegistry() || !userId) return;
    return events.onTap(() => router.push('/medications'));
  }, [userId, router]);

  return null;
}
