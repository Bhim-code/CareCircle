import type { ReactNode } from 'react';
import type { Permission } from '../../domain/policies/IRolePolicy';
import { useAuth } from '../providers/AuthProvider';
import { AccessRestricted } from './AccessRestricted';

interface CanProps {
  permission: Permission;
  children: ReactNode;
  /** Shown instead when the role lacks the permission. */
  fallback?: ReactNode;
  /** Shows an "Access restricted" box instead of nothing. A custom fallback wins. */
  showMessage?: boolean;
}

/** Shows its children only if the signed-in role holds the permission. */
export function Can({ permission, children, fallback = null, showMessage = false }: CanProps) {
  const { status, policy } = useAuth();

  if (status === 'loading') return null;
  if (policy?.can(permission)) return <>{children}</>;

  if (fallback) return <>{fallback}</>;
  if (showMessage) return <AccessRestricted yourRole={policy?.displayName ?? 'None'} />;
  return null;
}
