export interface PapyrusAPI {
  convertFile: (inputPath: string, outputFormat: string) => Promise<{ success: boolean; outputPath?: string; error?: string }>;
  batchConvert: (inputPaths: string[], outputFormat: string) => Promise<{ success: boolean; results: Array<{ path: string; success: boolean; outputPath?: string; error?: string }> }>;
  selectDirectory: () => Promise<string | null>;
  selectFile: () => Promise<string | null>;
  getRecentConversions: () => Promise<Array<{ path: string; timestamp: number; format: string }>>;
  openInExplorer: (path: string) => Promise<void>;
  getPlatform: () => Promise<string>;
  getVersion: () => Promise<string>;
}

declare global {
  interface Window {
    api?: PapyrusAPI;
  }
}

export {};
