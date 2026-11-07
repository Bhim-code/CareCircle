import { hasPermission } from '../../application/permissions';
import { useAuth } from '../providers/AuthProvider';

/** Whether the signed-in person may do something, by the permissions the backend gave. */
export function usePermission(permission: string): boolean {
  const { user } = useAuth();
  return hasPermission(user?.permissions, permission);
}
