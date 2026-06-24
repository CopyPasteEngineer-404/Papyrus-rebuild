// ============================================================================
// PAPYRUS Desktop — RPC Type Definitions
// ============================================================================

// ---------------------------------------------------------------------------
// Convert
// ---------------------------------------------------------------------------

export interface ConvertRequest {
  files: string[];
  format: string;
  outputDir: string;
}

export interface ConvertResponse {
  success: boolean;
  outputs?: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

export interface FormatInfo {
  id: string;
  name: string;
  extensions: string[];
}

export interface FormatsRequest {
  // void — no payload needed
}

export interface FormatsResponse {
  inputs: FormatInfo[];
  outputs: FormatInfo[];
}

// ---------------------------------------------------------------------------
// Watch
// ---------------------------------------------------------------------------

export interface WatchRequest {
  directory: string;
  format: string;
  outputDir: string;
}

export interface WatchResponse {
  watching: boolean;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface StatusRequest {
  // void — no payload needed
}

export interface StatusResponse {
  database: boolean;
  parsers: string[];
  workers: string[];
}
