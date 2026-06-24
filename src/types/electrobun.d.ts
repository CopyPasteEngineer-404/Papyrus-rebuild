declare module 'electrobun' {
  interface BrowserWindowOptions {
    title?: string;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    titleBarStyle?: string;
    webPreferences?: {
      nodeIntegration?: boolean;
      contextIsolation?: boolean;
    };
  }

  class BrowserWindow {
    constructor(options: BrowserWindowOptions);
    loadFile(path: string): void;
    focus(): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
  }

  const app: {
    on(event: 'ready', callback: () => void): void;
    on(event: 'activate', callback: () => void): void;
    on(event: 'window-all-closed', callback: () => void): void;
    on(event: 'before-quit', callback: () => void): void;
    quit(): void;
    rpc?: {
      on(event: string, callback: (...args: unknown[]) => unknown): void;
    };
  };

  export { BrowserWindow, app };
}
