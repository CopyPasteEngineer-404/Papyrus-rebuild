import { FileText, ArrowRightLeft, Layers, Sparkles, Clock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card';
import { Button } from '@components/ui/button';

export default function HomeView() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Welcome to Papyrus</h2>
        <p className="text-muted-foreground">
          Offline-first document transformation engine — convert any format to any format.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="cursor-pointer transition-shadow hover:shadow-md">
          <CardHeader className="flex flex-row items-center gap-4 pb-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ArrowRightLeft className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-base">Quick Convert</CardTitle>
              <CardDescription>Convert a single file</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Drop a file and convert it to your desired format in seconds.
            </p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer transition-shadow hover:shadow-md">
          <CardHeader className="flex flex-row items-center gap-4 pb-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Layers className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-base">Batch Convert</CardTitle>
              <CardDescription>Convert entire directories</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Process hundreds of files at once with progress tracking.
            </p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer transition-shadow hover:shadow-md">
          <CardHeader className="flex flex-row items-center gap-4 pb-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-base">13 Formats</CardTitle>
              <CardDescription>Wide format support</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              MD, CSV, DOCX, PDF, HTML, EPUB, RTF, YAML, JSON, and more.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            Recent Conversions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Sparkles className="mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No recent conversions yet. Start by converting a file!
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
