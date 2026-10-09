import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { policyFor } from '../../application/policies/policyFor';
import type { DemoAccount } from '../../infrastructure/demo/DemoAuthService';
import type { AuthUser } from '../../domain/entities/AuthUser';
import type { IRolePolicy } from '../../domain/policies/IRolePolicy';
import type { Role } from '../../domain/entities/Role';
import type { IAuthService, SignUpInput, SignUpResult } from '../../domain/services/IAuthService';
import type { IDevControls } from '../../domain/services/IDevControls';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

/** Development-only helpers. The whole object is null in release builds. */
export interface DevTools {
  readonly isActive: boolean;
  enable(role?: Role): void;
  switchRole(role: Role): void;
  disable(): Promise<void>;
}

export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly user: AuthUser | null;
  /** What the signed-in user may do. Null when signed out. */
  readonly policy: IRolePolicy | null;
  readonly isDemo: boolean;
  readonly demoAccounts: readonly DemoAccount[];
  readonly dev: DevTools | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: SignUpInput): Promise<SignUpResult>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  /** Injected, so tests and the demo backend can replace the real service. */
  service: IAuthService;
  isDemo?: boolean;
  demoAccounts?: readonly DemoAccount[];
  devControls?: IDevControls | null;
  children: ReactNode;
}

export function AuthProvider({
  service,
  isDemo = false,
  demoAccounts = [],
  devControls = null,
  children,
}: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [, setDevTick] = useState(0);

  const apply = useCallback((next: AuthUser | null) => {
    setUser(next);
    setStatus(next ? 'signedIn' : 'signedOut');
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = service.onAuthChange((next) => {
      if (active) apply(next);
    });
    service
      .getCurrentUser()
      .then((current) => active && apply(current))
      .catch(() => active && apply(null));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [service, apply]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      policy: user ? policyFor(user.role) : null,
      isDemo,
      demoAccounts,
      dev: devControls
        ? {
            isActive: devControls.isDevMode,
            enable: (role) => {
              devControls.enableDevMode(role);
              setDevTick((tick) => tick + 1);
            },
            switchRole: (role) => {
              devControls.switchDevRole(role);
              setDevTick((tick) => tick + 1);
            },
            disable: async () => {
              await devControls.disableDevMode();
              setDevTick((tick) => tick + 1);
            },
          }
        : null,
      signIn: async (email, password) => apply(await service.signIn(email, password)),
      signUp: async (input) => {
        const result = await service.signUp(input);
        if (result.user) apply(result.user);
        return result;
      },
      signOut: async () => {
        await service.signOut();
        apply(null);
      },
      requestPasswordReset: (email) => service.requestPasswordReset(email),
    }),
    [status, user, isDemo, demoAccounts, devControls, service, apply],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
