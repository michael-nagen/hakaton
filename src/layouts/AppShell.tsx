import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { Topbar } from '../components/Topbar';
import { Toast } from '../components/Toast';
import { AppShellProvider, useAppShell } from '../contexts/AppShellContext';

function ShellInner() {
  const { toast, showToast } = useAppShell();

  const handleLockedClick = (name: string) => showToast(`${name} is locked — coming soon`);
  const handleWorkspace = () => { console.log('[TODO] open LMS workspace'); showToast('LMS workspace — TODO: not wired up yet'); };
  const handleProfile = () => { console.log('[TODO] open profile'); showToast('Your profile — TODO: not wired up yet'); };
  const handleSearch = () => { console.log('[TODO] open search'); showToast('Search — TODO: not wired up yet'); };

  return (
    <div
      data-theme="dark"
      style={{
        display: 'flex',
        minHeight: '100vh',
        width: '100%',
        background: 'var(--bg-page)',
        color: 'var(--fg-1)',
        fontFamily: 'var(--font-text)',
      }}
    >
      <Sidebar
        onLockedClick={handleLockedClick}
        onWorkspaceClick={handleWorkspace}
        onProfileClick={handleProfile}
      />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Topbar onSearch={handleSearch} />
        <main style={{ flex: 1 }}>
          <Outlet />
        </main>
      </div>

      {toast && <Toast message={toast} />}
    </div>
  );
}

export function AppShell() {
  return (
    <AppShellProvider>
      <ShellInner />
    </AppShellProvider>
  );
}
