import { useState } from 'react';
import { Moon, Sun, Bell, FolderOpen, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card';
import { Button } from '@components/ui/button';
import { Switch } from '@components/ui/switch';
import { Separator } from '@components/ui/separator';

export default function SettingsView() {
  const [autoOpen, setAutoOpen] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [overwriteExisting, setOverwriteExisting] = useState(false);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Configure Papyrus to fit your workflow.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sun className="h-4 w-4" />
            Appearance
          </CardTitle>
          <CardDescription>Customize the look and feel</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Dark Mode</p>
              <p className="text-xs text-muted-foreground">
                Toggle between light and dark themes
              </p>
            </div>
            <Switch />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="h-4 w-4" />
            Conversion
          </CardTitle>
          <CardDescription>Default conversion behavior</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Open output folder after conversion</p>
              <p className="text-xs text-muted-foreground">
                Automatically open the folder containing converted files
              </p>
            </div>
            <Switch checked={autoOpen} onCheckedChange={setAutoOpen} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Overwrite existing files</p>
              <p className="text-xs text-muted-foreground">
                Replace files with the same name in the output directory
              </p>
            </div>
            <Switch checked={overwriteExisting} onCheckedChange={setOverwriteExisting} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            Notifications
          </CardTitle>
          <CardDescription>Control when you get notified</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Conversion complete</p>
              <p className="text-xs text-muted-foreground">
                Show a notification when batch conversion finishes
              </p>
            </div>
            <Switch checked={notifications} onCheckedChange={setNotifications} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4" />
            About
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">Papyrus v2.0.0</p>
          <p className="text-sm text-muted-foreground">
            Offline-first document transformation engine
          </p>
          <p className="text-xs text-muted-foreground">MIT License</p>
        </CardContent>
      </Card>
    </div>
  );
}
