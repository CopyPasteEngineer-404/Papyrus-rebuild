import { useState, useCallback } from 'react';
import { Upload, FileText, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card';
import { Button } from '@components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select';
import { cn } from '@shared/utils';

const OUTPUT_FORMATS = [
  { value: 'pdf', label: 'PDF' },
  { value: 'md', label: 'Markdown' },
  { value: 'txt', label: 'Plain Text' },
  { value: 'html', label: 'HTML' },
  { value: 'docx', label: 'Word Document' },
  { value: 'xlsx', label: 'Excel Spreadsheet' },
  { value: 'pptx', label: 'PowerPoint' },
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'epub', label: 'EPUB' },
  { value: 'rtf', label: 'Rich Text' },
];

type ConvertStatus = 'idle' | 'dropped' | 'converting' | 'done';

export default function ConvertView() {
  const [file, setFile] = useState<File | null>(null);
  const [targetFormat, setTargetFormat] = useState<string>('');
  const [status, setStatus] = useState<ConvertStatus>('idle');
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      setStatus('dropped');
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setStatus('dropped');
    }
  }, []);

  const handleConvert = useCallback(async () => {
    if (!file || !targetFormat) return;
    setStatus('converting');

    if (window.api?.convertFile) {
      await window.api.convertFile((file as any).path, targetFormat);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    setStatus('done');
    setTimeout(() => setStatus('idle'), 3000);
  }, [file, targetFormat]);

  const reset = useCallback(() => {
    setFile(null);
    setTargetFormat('');
    setStatus('idle');
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Convert File</h2>
        <p className="text-muted-foreground">
          Drop a file or browse to select, then choose your output format.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors',
              isDragOver
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
            )}
          >
            {file ? (
              <div className="flex flex-col items-center gap-3">
                <FileText className="h-12 w-12 text-primary" />
                <div className="text-center">
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={reset}>
                  Choose different file
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <Upload className="h-12 w-12 text-muted-foreground/50" />
                <div className="text-center">
                  <p className="font-medium">Drop your file here</p>
                  <p className="text-sm text-muted-foreground">or click to browse</p>
                </div>
                <label>
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <Button variant="outline" size="sm" asChild>
                    <span>Browse Files</span>
                  </Button>
                </label>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {file && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Output Format</CardTitle>
            <CardDescription>Select the target format for conversion</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                {file.name.split('.').pop()?.toUpperCase()}
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <Select value={targetFormat} onValueChange={setTargetFormat}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  {OUTPUT_FORMATS.map((fmt) => (
                    <SelectItem key={fmt.value} value={fmt.value}>
                      {fmt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {file && targetFormat && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {file.name} → {targetFormat.toUpperCase()}
                </p>
                <p className="text-sm text-muted-foreground">
                  {status === 'converting' && 'Converting...'}
                  {status === 'done' && 'Conversion complete!'}
                  {status === 'dropped' && 'Ready to convert'}
                </p>
              </div>
              <div className="flex gap-2">
                {status === 'done' ? (
                  <Button onClick={reset} className="gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Done
                  </Button>
                ) : (
                  <Button
                    onClick={handleConvert}
                    disabled={status === 'converting'}
                    className="gap-2"
                  >
                    {status === 'converting' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                    {status === 'converting' ? 'Converting...' : 'Convert'}
                  </Button>
                )}
              </div>
            </div>
            {status === 'converting' && (
              <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
