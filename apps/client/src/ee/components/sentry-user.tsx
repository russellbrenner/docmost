import * as Sentry from '@sentry/react';
import { useEffect } from 'react';
import { useAtom } from 'jotai';
import { currentUserAtom } from '@/features/user/atoms/current-user-atom.ts';

export function SentryUser() {
  const [currentUser] = useAtom(currentUserAtom);

  useEffect(() => {
    if (currentUser?.user) {
      Sentry.setUser({ id: currentUser.user.id, email: currentUser.user.email });
    } else {
      Sentry.setUser(null);
    }
  }, [currentUser]);

  return null;
}
