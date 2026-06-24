import type { View, Theme } from '../../App';
import Sidebar from './Sidebar';
import Header from './Header';
import HomeView from '../../views/HomeView';
import ConvertView from '../../views/ConvertView';
import BatchView from '../../views/BatchView';
import SettingsView from '../../views/SettingsView';

interface AppShellProps {
  currentView: View;
  onNavigate: (view: View) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

function ViewRouter({ currentView }: { currentView: View }) {
  switch (currentView) {
    case 'home':
      return <HomeView />;
    case 'convert':
      return <ConvertView />;
    case 'batch':
      return <BatchView />;
    case 'settings':
      return <SettingsView />;
    default:
      return <HomeView />;
  }
}

export default function AppShell({ currentView, onNavigate, theme, onToggleTheme }: AppShellProps) {
  return (
    <div className="flex h-full">
      <Sidebar currentView={currentView} onNavigate={onNavigate} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          title={currentView.charAt(0).toUpperCase() + currentView.slice(1)}
          theme={theme}
          onToggleTheme={onToggleTheme}
        />
        <main className="flex-1 overflow-auto p-6">
          <ViewRouter currentView={currentView} />
        </main>
      </div>
    </div>
  );
}
