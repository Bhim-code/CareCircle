import React, { createContext, useContext, type ReactNode } from 'react';
import type { IMedicineService } from '../../domain/services/IMedicineService';
import { useMedicines } from '../hooks/useMedicines';
import { useAuth } from './AuthProvider';

type MedicinesValue = ReturnType<typeof useMedicines>;

const MedicinesContext = createContext<MedicinesValue | null>(null);

/**
 * Loads the signed-in patient's medicines once, so the Medications list and the
 * add form always agree. Today's doses and the alarms reload when it changes.
 */
export function MedicinesProvider({ service, children }: { service: IMedicineService; children: ReactNode }) {
  const { user, policy } = useAuth();
  const value = useMedicines(service, user?.id ?? '', Boolean(user && policy?.can('reminders.manage')));
  return <MedicinesContext.Provider value={value}>{children}</MedicinesContext.Provider>;
}

export function useMedicineList(): MedicinesValue {
  const context = useContext(MedicinesContext);
  if (!context) throw new Error('useMedicineList must be used inside <MedicinesProvider>.');
  return context;
}
