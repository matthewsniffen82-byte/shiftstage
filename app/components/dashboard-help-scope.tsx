"use client";

import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from "react";
import type { HelpContext } from "../../src/lib/dancr/dashboard-help-context";

type Scope = { id: string; context?: HelpContext; path: string[]; area: boolean };
type Registry = { scopes: Scope[]; register: (scope: Scope) => () => void };
const RegistryContext = createContext<Registry | null>(null);
const AreaContext = createContext<{ active: boolean; path: string[] }>({ active: true, path: [] });

export function DashboardHelpProvider({ children }: { children: ReactNode }) {
  const [scopes, setScopes] = useState<Scope[]>([]);
  const register = useCallback((scope: Scope) => {
    setScopes(current => [...current.filter(item => item.id !== scope.id), scope]);
    return () => setScopes(current => current.filter(item => item.id !== scope.id));
  }, []);
  return <RegistryContext.Provider value={{ scopes, register }}>{children}</RegistryContext.Provider>;
}

// Hidden, retained tabs unregister their entire help subtree. A newly opened
// sibling area takes priority, then its most specific visible child supplies help.
function useScope(context: HelpContext | undefined, active: boolean, area: boolean) {
  const registry = useContext(RegistryContext);
  const parent = useContext(AreaContext);
  const id = useId();
  const register = registry?.register;
  const pathKey = parent.path.join("|");
  useEffect(() => {
    if (register && (context || area) && active && parent.active) return register({ id, context, path: pathKey ? pathKey.split("|") : [], area });
  }, [register, id, context, active, parent.active, pathKey, area]);
  return id;
}

export function useDashboardHelpArea(context: HelpContext | undefined, active = true) {
  useScope(context, active, false);
}

export function DashboardHelpArea({ context, active = true, children }: { context?: HelpContext; active?: boolean; children: ReactNode }) {
  const parent = useContext(AreaContext);
  const id = useScope(context, active, true);
  return <AreaContext.Provider value={{ active: parent.active && active, path: [...parent.path, id] }}>{children}</AreaContext.Provider>;
}

export function useDashboardHelpContext(fallback: HelpContext): HelpContext {
  const registry = useContext(RegistryContext);
  const scopes = registry?.scopes || [];
  let path: string[] = [], context = fallback;
  for (let depth = 0; depth <= scopes.length; depth++) {
    const peers = scopes.filter(scope => scope.path.length === path.length && scope.path.every((id, index) => id === path[index]));
    const local = peers.findLast(scope => !scope.area && scope.context);
    if (local?.context) context = local.context;
    const area = peers.findLast(scope => scope.area);
    if (!area) break;
    if (area.context) context = area.context;
    path = [...path, area.id];
  }
  return context;
}
