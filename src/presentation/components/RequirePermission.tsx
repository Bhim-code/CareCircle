import type { ReactNode } from 'react';
import { usePermission } from '../hooks/usePermission';
import { useAuth } from '../providers/AuthProvider';
import { AccessRestricted } from './AccessRestricted';

interface RequirePermissionProps {
  /** A permission code the backend gives, such as "documents.upload". */
  permission: string;
  children: ReactNode;
  /** Shown instead when the person lacks it. By default the "Access restricted" box. Pass null for nothing. */
  fallback?: ReactNode;
}

/** Shows its children only if the backend gave the signed-in person this permission. */
export function RequirePermission({ permission, children, fallback }: RequirePermissionProps) {
  const allowed = usePermission(permission);
  const { user } = useAuth();
  if (allowed) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;
  return <AccessRestricted yourRole={user?.role ?? 'None'} />;
}
