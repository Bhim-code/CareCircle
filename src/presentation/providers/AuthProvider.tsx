import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { ACCOUNT_UPDATED_NOTICE, checkApproval, type ApprovalCheck } from '../../application/approval';
import { checkSession, SESSION_CHECK_INTERVAL_MS, SESSION_CHECK_MIN_GAP_MS } from '../../application/permissions';
import { policyFor } from '../../application/policies/policyFor';
import type { DemoAccount } from '../../infrastructure/demo/DemoAuthService';
import { isApproved, type ApprovedUser, type AuthUser } from '../../domain/entities/AuthUser';
import type { IRolePolicy } from '../../domain/policies/IRolePolicy';
import type { Role } from '../../domain/entities/Role';
import type { IAuthService, SignUpInput, SignUpResult } from '../../domain/services/IAuthService';
import type { IDevControls } from '../../domain/services/IDevControls';

/** "pending": signed in, but a supervisor has not approved the account yet. */
export type AuthStatus = 'loading' | 'signedOut' | 'pending' | 'signedIn';

/** Development-only helpers. The whole object is null in release builds. */
export interface DevTools {
  readonly isActive: boolean;
  enable(role?: Role): void;
  switchRole(role: Role): void;
  disable(): Promise<void>;
}

export interface AuthContextValue {
  readonly status: AuthStatus;
  /** The signed-in person, once their account has a role. Null while signed out or waiting. */
  readonly user: ApprovedUser | null;
  /** The person who signed in but is still waiting for a supervisor. */
  readonly pendingUser: AuthUser | null;
  /** A sentence for the sign-in screen when the backend ended a waiting person's sign-in. */
  readonly signedOutNotice: string | null;
  /** What the signed-in user may do. Null when signed out. */
  readonly policy: IRolePolicy | null;
  readonly isDemo: boolean;
  readonly demoAccounts: readonly DemoAccount[];
  readonly dev: DevTools | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: SignUpInput): Promise<SignUpResult>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  /** Asks the backend again whether a waiting account has been approved. */
  checkApproval(): Promise<ApprovalCheck>;
  /** Shows a name the person just saved, without signing in again. */
  applyName(name: string): void;
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
  const [account, setAccount] = useState<AuthUser | null>(null);
  const [signedOutNotice, setSignedOutNotice] = useState<string | null>(null);
  const [, setDevTick] = useState(0);

  const apply = useCallback((next: AuthUser | null) => {
    setAccount(next);
    setStatus(next === null ? 'signedOut' : isApproved(next) ? 'signedIn' : 'pending');
    // A new sign-in or a new sign-out makes an old notice out of date.
    if (next !== null) setSignedOutNotice(null);
  }, []);

  // While someone is signed in, look again from time to time at what they may do, so a change a
  // supervisor makes reaches an app that is already open. A failed look changes nothing.
  const accountRef = useRef(account);
  accountRef.current = account;
  const lastLook = useRef(0);
  const looking = useRef(false);
  const signedIn = status === 'signedIn';
  useEffect(() => {
    if (!signedIn) return;
    lastLook.current = Date.now();
    async function look() {
      const current = accountRef.current;
      if (looking.current || current === null) return;
      looking.current = true;
      lastLook.current = Date.now();
      try {
        const result = await checkSession(service, current);
        if (result.kind === 'changed') apply(result.user);
        else if (result.kind === 'signedOut') {
          setSignedOutNotice(ACCOUNT_UPDATED_NOTICE);
          apply(null);
        }
      } finally {
        looking.current = false;
      }
    }
    const timer = setInterval(() => void look(), SESSION_CHECK_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastLook.current >= SESSION_CHECK_MIN_GAP_MS) void look();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [signedIn, service, apply]);

  const user = account !== null && isApproved(account) ? account : null;
  const pendingUser = account !== null && !isApproved(account) ? account : null;

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
      pendingUser,
      signedOutNotice,
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
        setSignedOutNotice(null);
        apply(null);
      },
      requestPasswordReset: (email) => service.requestPasswordReset(email),
      applyName: (name) => setAccount((current) => (current === null ? current : { ...current, name })),
      checkApproval: async () => {
        const result = await checkApproval(service);
        if (result.kind === 'signedOut') {
          // The backend signs a person out when a supervisor gives them a role.
          setSignedOutNotice(ACCOUNT_UPDATED_NOTICE);
          apply(null);
        } else if (result.kind === 'approved') {
          apply(result.user);
        }
        return result;
      },
    }),
    [status, user, pendingUser, signedOutNotice, isDemo, demoAccounts, devControls, service, apply],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
