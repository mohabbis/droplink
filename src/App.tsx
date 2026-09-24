import { useEffect, useState, useSyncExternalStore } from 'react';
import { normalizeCode } from '../shared/codes';
import { Screen } from './components/Screen';
import { DropLinkSession } from './state/session';
import { activeTransfer } from './state/types';

/** Read `#join=CODE` from a shared link, then remove it so a reload doesn't reuse a stale code. */
function takeJoinCode(): string | null {
  const match = location.hash.match(/^#join=([A-Za-z0-9-]+)$/);
  if (!match) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return normalizeCode(match[1]) ?? match[1];
}

export function App() {
  const [session] = useState(() => new DropLinkSession());
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);

  useEffect(() => {
    const join = () => {
      const code = takeJoinCode();
      if (code) void session.joinRoom(code);
    };
    join();
    window.addEventListener('hashchange', join);
    const onPageHide = () => session.dispose();
    // Restored from the back/forward cache: the old connection is gone, so start fresh.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) session.reset();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('hashchange', join);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [session]);

  // Warn before closing the tab mid-transfer.
  const busy = activeTransfer(state) !== undefined;
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  return <Screen state={state} actions={session} />;
}
