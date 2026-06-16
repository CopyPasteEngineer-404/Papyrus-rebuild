import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Save, X, ArrowLeftRight, FileText, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface FileEditorProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

function getFileExt(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

/**
 * FileEditor — Split pane editor with live preview.
 *
 * Left side = styled textarea, right side = live preview.
 * Option to swap sides. Debounced live preview. Save via IPC.
 */
export const FileEditor: React.FC<FileEditorProps> = ({ filePath, fileName, onClose }) => {
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorOnRight, setEditorOnRight] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Load file content
  useEffect(() => {
    setLoading(true);
    setError(null);

    window.papyrus?.readFileContent(filePath)
      .then((result: string) => {
        setContent(result);
        setSavedContent(result);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message || 'Failed to read file');
        setLoading(false);
      });
  }, [filePath]);

  // Track dirty state
  useEffect(() => {
    setIsDirty(content !== savedContent);
  }, [content, savedContent]);

  // Debounced content update for preview
  const [previewContent, setPreviewContent] = useState('');
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreviewContent(content);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!isDirty) return;
    setSaving(true);
    try {
      await window.papyrus?.writeFileContent(filePath, content);
      setSavedContent(content);
      toast.success('File saved');
    } catch (err: any) {
      toast.error('Failed to save file', { description: err?.message || 'Unknown error' });
    } finally {
      setSaving(false);
    }
  }, [filePath, content, isDirty]);

  // Keyboard shortcut: Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  // Close with dirty check
  const handleClose = useCallback(() => {
    if (isDirty) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  const confirmClose = useCallback(() => {
    setShowCloseConfirm(false);
    onClose();
  }, [onClose]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
        <span className="text-sm ml-2" style={{ color: 'var(--fg-muted)' }}>Loading file...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
        <AlertTriangle size={24} style={{ color: 'var(--status-error)' }} />
        <p className="text-sm" style={{ color: 'var(--status-error)' }}>{error}</p>
        <button
          className="mt-2 px-4 py-2 rounded-md text-sm"
          style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--fg-primary)' }}
          onClick={onClose}
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Editor header */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-2">
          <FileText size={14} style={{ color: 'var(--accent-primary)' }} />
          <span className="text-sm font-medium truncate max-w-[300px]" style={{ color: 'var(--fg-primary)' }}>{fileName}</span>
          {isDirty && (
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--status-warning, #f59e0b)' }} title="Unsaved changes" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors"
            style={{ color: 'var(--fg-dim)' }}
            onClick={() => setEditorOnRight(prev => !prev)}
            title="Swap editor position"
          >
            <ArrowLeftRight size={12} />
            Swap
          </button>
          <button
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors"
            style={{
              color: isDirty ? 'var(--accent-primary)' : 'var(--fg-dim)',
              backgroundColor: isDirty ? 'var(--accent-primary-muted)' : 'transparent',
            }}
            onClick={handleSave}
            disabled={!isDirty || saving}
            title="Save (Ctrl+S)"
          >
            <Save size={12} />
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors"
            style={{ color: 'var(--fg-dim)' }}
            onClick={handleClose}
            title="Close editor"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Split pane: Editor + Preview */}
      <div className="flex flex-1 min-h-0">
        {/* Editor side */}
        <div
          className="flex-1 min-w-0 flex flex-col border-r"
          style={{
            borderColor: 'var(--border-default)',
            order: editorOnRight ? 2 : 1,
          }}
        >
          <div className="px-2 py-1 border-b text-xs" style={{ borderColor: 'var(--border-default)', color: 'var(--fg-dim)', backgroundColor: 'var(--bg-secondary)' }}>
            Editor
          </div>
          <textarea
            ref={textareaRef}
            className="flex-1 min-h-0 p-3 text-sm font-mono leading-relaxed resize-none outline-none"
            style={{
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--fg-secondary)',
              border: 'none',
              tabSize: 2,
            }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* Preview side */}
        <div
          className="flex-1 min-w-0 flex flex-col"
          style={{
            order: editorOnRight ? 1 : 2,
          }}
        >
          <div className="px-2 py-1 border-b text-xs" style={{ borderColor: 'var(--border-default)', color: 'var(--fg-dim)', backgroundColor: 'var(--bg-secondary)' }}>
            Preview
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            <FilePreview content={previewContent} fileName={fileName} ext={ext} />
          </div>
        </div>
      </div>

      {showCloseConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <div className="p-4 rounded-lg shadow-lg" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-default)', maxWidth: 360 }}>
            <div className="text-sm mb-3" style={{ color: 'var(--fg-primary)' }}>You have unsaved changes. Close anyway?</div>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs rounded-md"
                style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--fg-primary)' }}
                onClick={() => setShowCloseConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 text-xs rounded-md"
                style={{ backgroundColor: 'var(--accent-primary)', color: '#fff' }}
                onClick={confirmClose}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── File Preview Component ───────────────────────────────────────────────────

const FilePreview: React.FC<{ content: string; fileName: string; ext: string }> = ({ content, fileName, ext }) => {
  // Markdown preview
  if (ext === 'md' || ext === 'markdown') {
    return <MarkdownPreview content={content} />;
  }

  // HTML preview
  if (ext === 'html' || ext === 'htm') {
    return (
      <iframe
        srcDoc={content}
        className="w-full border-0 rounded"
        style={{ minHeight: '300px', backgroundColor: '#fff' }}
        title="HTML Preview"
        sandbox="allow-scripts"
      />
    );
  }

  // CSV preview
  if (ext === 'csv') {
    return <CsvPreview content={content} />;
  }

  // Default: plain text
  return (
    <pre
      className="text-xs whitespace-pre-wrap font-mono leading-relaxed"
      style={{ color: 'var(--fg-secondary)' }}
    >
      {content}
    </pre>
  );
};

/** Simple CSV preview */
const CsvPreview: React.FC<{ content: string }> = ({ content }) => {
  const rows = content.trim().split('\n').map(row =>
    row.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''))
  );
  if (rows.length === 0) return null;

  const headers = rows[0];
  const dataRows = rows.slice(1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th key={i} className="px-2 py-1 text-left font-semibold border-b" style={{ borderColor: 'var(--border-default)', color: 'var(--accent-primary)', backgroundColor: 'var(--bg-secondary)' }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.slice(0, 50).map((row, rowIdx) => (
            <tr key={rowIdx}>
              {headers.map((_, colIdx) => (
                <td key={colIdx} className="px-2 py-1 border-b" style={{ borderColor: 'var(--border-default)', color: 'var(--fg-secondary)' }}>
                  {row[colIdx] || ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Simple Markdown preview */
const MarkdownPreview: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-xs font-bold mt-2 mb-1" style={{ color: 'var(--fg-primary)' }}>{trimmed.slice(4)}</h3>);
      i++; continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-sm font-bold mt-3 mb-1" style={{ color: 'var(--fg-primary)' }}>{trimmed.slice(3)}</h2>);
      i++; continue;
    }
    if (trimmed.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-base font-bold mt-4 mb-1" style={{ color: 'var(--fg-primary)' }}>{trimmed.slice(2)}</h1>);
      i++; continue;
    }

    if (trimmed === '---' || trimmed === '***') {
      elements.push(<hr key={i} className="my-2" style={{ borderColor: 'var(--border-default)' }} />);
      i++; continue;
    }

    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      elements.push(
        <div key={`code-${i}`} className="my-2 p-2 rounded text-xs font-mono overflow-x-auto" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--fg-secondary)', border: '1px solid var(--border-default)' }}>
          {lang && <div className="text-xs mb-1 font-sans" style={{ color: 'var(--fg-dim)' }}>{lang}</div>}
          <pre className="whitespace-pre-wrap">{codeLines.join('\n')}</pre>
        </div>
      );
      continue;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(<div key={i} className="pl-3 py-0.5 text-xs">• {trimmed.slice(2)}</div>);
      i++; continue;
    }

    if (trimmed === '') {
      elements.push(<div key={i} className="h-2" />);
      i++; continue;
    }

    elements.push(<p key={i} className="py-0.5 text-xs" style={{ color: 'var(--fg-secondary)' }}>{trimmed}</p>);
    i++;
  }

  return <div className="text-xs leading-relaxed">{elements}</div>;
};

export default FileEditor;
