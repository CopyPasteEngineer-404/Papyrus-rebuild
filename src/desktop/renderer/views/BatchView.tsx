import { useState, useCallback } from 'react';
import { FolderOpen, FileText, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card';
import { Button } from '@components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select';
import { ScrollArea } from '@components/ui/scroll-area';
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

interface BatchFile {
  name: string;
  path: string;
  size: number;
  status: 'pending' | 'converting' | 'done' | 'error';
}

type BatchStatus = 'idle' | 'ready' | 'converting' | 'done';

export default function BatchView() {
  const [directory, setDirectory] = useState<string>('');
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [targetFormat, setTargetFormat] = useState<string>('');
  const [batchStatus, setBatchStatus] = useState<BatchStatus>('idle');
  const [completedCount, setCompletedCount] = useState(0);

  const handleSelectDirectory = useCallback(async () => {
    if (window.api?.selectDirectory) {
      const dir = await window.api.selectDirectory();
      if (dir) {
        setDirectory(dir);
        setBatchStatus('ready');
        setFiles([
          { name: 'document1.md', path: `${dir}/document1.md`, size: 2048, status: 'pending' },
          { name: 'report.csv', path: `${dir}/report.csv`, size: 4096, status: 'pending' },
          { name: 'notes.txt', path: `${dir}/notes.txt`, size: 1024, status: 'pending' },
          { name: 'presentation.pptx', path: `${dir}/presentation.pptx`, size: 8192, status: 'pending' },
          { name: 'data.json', path: `${dir}/data.json`, size: 512, status: 'pending' },
        ]);
      }
    } else {
      const mockDir = 'C:\\Users\\Documents\\project';
      setDirectory(mockDir);
      setBatchStatus('ready');
      setFiles([
        { name: 'document1.md', path: `${mockDir}/document1.md`, size: 2048, status: 'pending' },
        { name: 'report.csv', path: `${mockDir}/report.csv`, size: 4096, status: 'pending' },
        { name: 'notes.txt', path: `${mockDir}/notes.txt`, size: 1024, status: 'pending' },
        { name: 'presentation.pptx', path: `${mockDir}/presentation.pptx`, size: 8192, status: 'pending' },
        { name: 'data.json', path: `${mockDir}/data.json`, size: 512, status: 'pending' },
      ]);
    }
  }, []);

  const handleConvert = useCallback(async () => {
    if (!targetFormat || files.length === 0) return;
    setBatchStatus('converting');
    setCompletedCount(0);

    for (let i = 0; i < files.length; i++) {
      setFiles((prev) =>
        prev.map((f, idx) =>
          idx === i ? { ...f, status: 'converting' } : f
        )
      );

      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 500));

      const hasError = Math.random() < 0.1;
      setFiles((prev) =>
        prev.map((f, idx) =>
          idx === i ? { ...f, status: hasError ? 'error' : 'done' } : f
        )
      );
      setCompletedCount((prev) => prev + 1);
    }

    setBatchStatus('done');
  }, [files, targetFormat]);

  const reset = useCallback(() => {
    setDirectory('');
    setFiles([]);
    setTargetFormat('');
    setBatchStatus('idle');
    setCompletedCount(0);
  }, []);

  const successCount = files.filter((f) => f.status === 'done').length;
  const errorCount = files.filter((f) => f.status === 'error').length;
  const progress = files.length > 0 ? (completedCount / files.length) * 100 : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Batch Convert</h2>
        <p className="text-muted-foreground">
          Select a directory and convert all supported files at once.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Source Directory</CardTitle>
          <CardDescription>Choose a directory containing files to convert</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={handleSelectDirectory} className="gap-2">
              <FolderOpen className="h-4 w-4" />
              Select Directory
            </Button>
            {directory && (
              <p className="flex-1 truncate text-sm text-muted-foreground">{directory}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {files.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Output Format</CardTitle>
              <CardDescription>Select the target format for all files</CardDescription>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Files ({files.length})</CardTitle>
                <CardDescription>
                  {batchStatus === 'done'
                    ? `${successCount} converted, ${errorCount} failed`
                    : `${completedCount} of ${files.length} processed`}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {batchStatus === 'done' ? (
                  <Button onClick={reset} size="sm">Start Over</Button>
                ) : (
                  <Button
                    onClick={handleConvert}
                    disabled={!targetFormat || batchStatus === 'converting'}
                    size="sm"
                    className="gap-2"
                  >
                    {batchStatus === 'converting' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {batchStatus === 'converting' ? 'Converting...' : 'Convert All'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {batchStatus === 'converting' && (
                <div className="mb-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {files.map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(file.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {file.status === 'pending' && (
                          <span className="text-xs text-muted-foreground">Pending</span>
                        )}
                        {file.status === 'converting' && (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        )}
                        {file.status === 'done' && (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        )}
                        {file.status === 'error' && (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
