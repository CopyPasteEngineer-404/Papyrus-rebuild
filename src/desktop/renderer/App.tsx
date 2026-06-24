import { useState, useCallback } from 'react';
import { TooltipProvider } from './components/ui/tooltip';
import { Toaster } from 'sonner';
import AppShell from './components/layout/AppShell';

export type View = 'home' | 'convert' | 'batch' | 'settings';
export type Theme = 'light' | 'dark';

export default function App() {
  const [currentView, setCurrentView] = useState<View>('home');
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('papyrus-theme') as Theme) || 'light';
    }
    return 'light';
  });

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('papyrus-theme', next);
      document.documentElement.setAttribute('data-theme', next);
      return next;
    });
  }, []);

  const navigateTo = useCallback((view: View) => {
    setCurrentView(view);
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-screen w-screen overflow-hidden">
        <AppShell
          currentView={currentView}
          onNavigate={navigateTo}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </div>
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  );
}
