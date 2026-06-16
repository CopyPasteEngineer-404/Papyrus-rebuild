/**
 * Initialization orchestration for Papyrus.
 *
 * When the app starts, this layer:
 * 1. Initializes IPC connection to main process
 * 2. Restores last workspace (if any) via electron-store
 * 3. Hydrates Zustand stores from main process state
 * 4. Loads user settings (persistent via electron-store)
 * 5. Applies saved theme
 * 6. Signals app is ready for rendering
 *
 * Gracefully handles running outside Electron (browser dev mode)
 * by skipping IPC-dependent steps and using localStorage fallbacks.
 */

export type InitPhase =
  | 'idle'
  | 'connecting'
  | 'restoring-workspace'
  | 'hydrating-stores'
  | 'loading-settings'
  | 'ready'
  | 'error';

export interface RestoredWorkspace {
  path: string;
  name: string;
  files: Array<{
    id: string;
    name: string;
    path: string;
    format: string;
    size: number;
    modifiedAt: number;
  }>;
}

export interface InitState {
  phase: InitPhase;
  error?: string;
  workspaceRestored: boolean;
  settingsLoaded: boolean;
  /** If a workspace was successfully restored, contains the workspace data including files */
  restoredWorkspace?: RestoredWorkspace;
}

/** Check if we're running inside Electron with IPC available */
function isElectron(): boolean {
  return !!(window as any).papyrus;
}

/**
 * Run the full application initialization sequence.
 * Returns the final state after all steps complete or fail.
 *
 * When running outside Electron (e.g., browser dev mode),
 * IPC-dependent steps are skipped with sensible defaults.
 */
export async function initializeApp(
  onPhaseChange: (phase: InitPhase) => void
): Promise<InitState> {
  const state: InitState = {
    phase: 'idle',
    workspaceRestored: false,
    settingsLoaded: false,
  };

  try {
    // Step 1: Verify IPC connection
    state.phase = 'connecting';
    onPhaseChange('connecting');

    if (!isElectron()) {
      // Running in browser (dev mode) — skip IPC steps, use localStorage fallbacks
      console.warn('[Papyrus] IPC bridge not available — running in browser mode. Some features will be unavailable.');

      // Theme is handled by ThemeProvider — don't set DOM attributes here to avoid
      // racing with React's ThemeProvider hydration. localStorage is read by ThemeProvider directly.

      state.settingsLoaded = true;

      // Skip to ready — app will show in limited mode
      state.phase = 'ready';
      onPhaseChange('ready');
      return state;
    }

    // Step 2: Restore workspace
    state.phase = 'restoring-workspace';
    onPhaseChange('restoring-workspace');

    try {
      // First, check if there's a lastWorkspace path saved in settings
      const lastWorkspacePath = await window.papyrus!.getStoredSetting('lastWorkspace') as string | null;

      if (lastWorkspacePath) {
        // Re-open the last workspace to reinitialize the database and index files.
        // This is necessary because the main process starts fresh on each launch
        // (db, currentWorkspace, exportManager are all null).
        // workspace:open with a non-empty path skips the dialog and does everything:
        // DB init → workspace record → indexing → file watcher → settings save.
        try {
          const result = await window.papyrus!.openWorkspace(lastWorkspacePath);
          if (result) {
            state.workspaceRestored = true;
            state.restoredWorkspace = {
              path: result.path,
              name: result.name,
              files: (result.files && Array.isArray(result.files))
                ? result.files.map((f: any) => ({
                    id: f.id,
                    name: f.name,
                    path: f.path,
                    format: f.format,
                    size: f.size ?? 0,
                    modifiedAt: f.modifiedAt || Date.now(),
                  }))
                : [],
            };
          }
        } catch (reopenErr) {
          // The last workspace path may no longer exist or be inaccessible.
          // That's fine — the user will open a new one.
          console.warn('[Papyrus] Failed to reopen last workspace:', reopenErr);
          state.workspaceRestored = false;
        }
      } else {
        // No lastWorkspace saved — check if there's an already-open workspace in the main process.
        // This is unlikely on a fresh launch but handles edge cases.
        const workspaces = await window.papyrus!.getWorkspaceInfo();
        if (workspaces && workspaces.length > 0) {
          state.workspaceRestored = true;
        }
      }
    } catch {
      // No workspace to restore — that's fine, user will open one
      state.workspaceRestored = false;
    }

    // Step 3: Hydrate stores
    state.phase = 'hydrating-stores';
    onPhaseChange('hydrating-stores');
    // Store hydration happens in Bootstrap.tsx after this resolves

    // Step 4: Load settings (persistent via electron-store)
    state.phase = 'loading-settings';
    onPhaseChange('loading-settings');

    try {
      const settings = await window.papyrus!.getSettings();
      if (settings) {
        state.settingsLoaded = true;

        // Apply saved theme
        if (settings.theme) {
          if (settings.theme === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
          } else {
            document.documentElement.setAttribute('data-theme', settings.theme);
          }
        }
      }
    } catch {
      state.settingsLoaded = false;
    }

    // Step 5: Ready
    state.phase = 'ready';
    onPhaseChange('ready');

    return state;
  } catch (error) {
    state.phase = 'error';
    state.error = error instanceof Error ? error.message : String(error);
    onPhaseChange('error');
    return state;
  }
}
