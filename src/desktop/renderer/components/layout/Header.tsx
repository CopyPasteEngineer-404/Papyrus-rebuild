import { Moon, Sun } from 'lucide-react';
import { Button } from '@components/ui/button';
import type { Theme } from '../../App';

interface HeaderProps {
  title: string;
  theme: Theme;
  onToggleTheme: () => void;
}

export default function Header({ title, theme, onToggleTheme }: HeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      <Button variant="ghost" size="icon" onClick={onToggleTheme}>
        {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
      </Button>
    </header>
  );
}
