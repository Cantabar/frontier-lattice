/**
 * Session-scoped notification store.
 *
 * Provides a React context + hook that any component can use to push
 * errors, warnings, or info messages. Notifications persist in memory
 * for the lifetime of the browser session.
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  createElement,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationLevel = "error" | "warning" | "info";

export interface SessionNotification {
  id: string;
  level: NotificationLevel;
  title: string;
  message: string;
  timestamp: number;
  /** Component or subsystem that produced this notification */
  source: string;
  dismissed: boolean;
}

export interface NotificationStore {
  notifications: SessionNotification[];
  /** Push a new notification. Returns its generated ID. */
  push: (n: Omit<SessionNotification, "id" | "timestamp" | "dismissed">) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  /** Remove all notifications whose source matches the given prefix. */
  clearBySource: (sourcePrefix: string) => void;
  unreadCount: number;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type Action =
  | { type: "PUSH"; notification: SessionNotification }
  | { type: "DISMISS"; id: string }
  | { type: "DISMISS_ALL" }
  | { type: "CLEAR_BY_SOURCE"; sourcePrefix: string };

function reducer(state: SessionNotification[], action: Action): SessionNotification[] {
  switch (action.type) {
    case "PUSH":
      return [...state, action.notification];
    case "DISMISS":
      return state.map((n) => (n.id === action.id ? { ...n, dismissed: true } : n));
    case "DISMISS_ALL":
      return state.map((n) => ({ ...n, dismissed: true }));
    case "CLEAR_BY_SOURCE":
      return state.filter((n) => !n.source.startsWith(action.sourcePrefix));
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const noop = () => "";
const defaultStore: NotificationStore = {
  notifications: [],
  push: noop,
  dismiss: noop as unknown as (id: string) => void,
  dismissAll: noop as unknown as () => void,
  clearBySource: noop as unknown as (s: string) => void,
  unreadCount: 0,
};

export const NotificationContext = createContext<NotificationStore>(defaultStore);

export function useNotifications() {
  return useContext(NotificationContext);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

let nextId = 1;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, dispatch] = useReducer(reducer, []);

  const push = useCallback(
    (n: Omit<SessionNotification, "id" | "timestamp" | "dismissed">) => {
      const id = `notif-${nextId++}`;
      dispatch({
        type: "PUSH",
        notification: { ...n, id, timestamp: Date.now(), dismissed: false },
      });
      return id;
    },
    [],
  );

  const dismiss = useCallback((id: string) => {
    dispatch({ type: "DISMISS", id });
  }, []);

  const dismissAll = useCallback(() => {
    dispatch({ type: "DISMISS_ALL" });
  }, []);

  const clearBySource = useCallback((sourcePrefix: string) => {
    dispatch({ type: "CLEAR_BY_SOURCE", sourcePrefix });
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.dismissed).length,
    [notifications],
  );

  const value = useMemo<NotificationStore>(
    () => ({ notifications, push, dismiss, dismissAll, clearBySource, unreadCount }),
    [notifications, push, dismiss, dismissAll, clearBySource, unreadCount],
  );

  return createElement(NotificationContext.Provider, { value }, children);
}
