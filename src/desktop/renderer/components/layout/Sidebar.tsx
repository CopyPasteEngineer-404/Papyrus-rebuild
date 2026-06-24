import { FileText, ArrowRightLeft, Layers, Settings, Home } from 'lucide-react';
import { cn } from '@shared/utils';
import { Button } from '@components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip';
import type { View } from '../../App';

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
}

const navItems: { id: View; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'convert', label: 'Convert', icon: ArrowRightLeft },
  { id: 'batch', label: 'Batch', icon: Layers },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ currentView, onNavigate }: SidebarProps) {
  return (
    <aside className="flex h-full w-16 flex-col items-center border-r bg-muted/40 py-4">
      <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <FileText className="h-5 w-5" />
      </div>
      <nav className="flex flex-1 flex-col items-center gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <Button
                  variant={isActive ? 'secondary' : 'ghost'}
                  size="icon"
                  className={cn('h-10 w-10', isActive && 'bg-accent')}
                  onClick={() => onNavigate(item.id)}
                >
                  <Icon className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </aside>
  );
}
