import { BrowserWindow, app } from 'electrobun';
import { registerAllParsers } from '../../core/parsers';
import { registerAllWorkers } from '../../core/workers';
import { APP_NAME, APP_VERSION } from '../../shared/constants';
import { logger } from '../../shared/utils';
import {
  handleConvert,
  handleFormats,
  handleWatch,
  handleStatus,
  stopAllWatchers,
} from './rpc';
import type {
  ConvertRequest,
  ConvertResponse,
  FormatsResponse,
  WatchRequest,
  WatchResponse,
  StatusResponse,
} from '../shared/rpc-types';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = logger.child('desktop');

// ---------------------------------------------------------------------------
// Window Management
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    title: `${APP_NAME} v${APP_VERSION}`,
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile('views/main-ui/index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  log.info('Main window created');
}

// ---------------------------------------------------------------------------
// RPC Registration
// ---------------------------------------------------------------------------

function registerRPC(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (app as any).rpc;

  if (!rpc) {
    log.warn('Electrobun RPC not available — desktop RPC handlers not registered');
    return;
  }

  rpc.on('convert', async (req: ConvertRequest): Promise<ConvertResponse> => {
    log.debug(`RPC convert: ${req.files.length} file(s) → ${req.format}`);
    return handleConvert(req);
  });

  rpc.on('formats', (): FormatsResponse => {
    log.debug('RPC formats');
    return handleFormats();
  });

  rpc.on('watch', (req: WatchRequest): WatchResponse => {
    log.debug(`RPC watch: ${req.directory} → ${req.format}`);
    return handleWatch(req);
  });

  rpc.on('status', (): StatusResponse => {
    log.debug('RPC status');
    return handleStatus();
  });

  log.info('RPC handlers registered');
}

// ---------------------------------------------------------------------------
// App Lifecycle
// ---------------------------------------------------------------------------

app.on('ready', () => {
  log.info(`${APP_NAME} v${APP_VERSION} starting`);

  // Register all parsers and workers
  registerAllParsers();
  registerAllWorkers();

  const parserCount = (app as any).rpc
    ? 'available'
    : 'registered';
  log.info(`Parsers ${parserCount}, workers registered`);

  // Set up RPC handlers
  registerRPC();

  // Create the main window
  createMainWindow();
});

app.on('activate', () => {
  if (!mainWindow) {
    createMainWindow();
  } else {
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  stopAllWatchers();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopAllWatchers();
  log.info('Shutting down');
});
