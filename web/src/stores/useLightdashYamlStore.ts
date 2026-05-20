import type {
  LightdashYamlLog,
  LightdashYamlNode,
} from '@shared/lightdash/types';
import { create } from 'zustand';

export type LightdashYamlTab = 'download' | 'explorer' | 'upload';

export type LightdashYamlDownloadScope = 'all' | 'specific';

export type LightdashYamlDownloadOptions = {
  scope: LightdashYamlDownloadScope;
  /** Dashboard slugs / UUIDs / URLs, one per row. */
  dashboards: string[];
  /** Chart slugs / UUIDs / URLs, one per row. */
  charts: string[];
  project: string;
  /**
   * When true, persist the current path as the new default via
   * `lightdash-yaml-set-default-path`; otherwise it is a one-off override.
   */
  setAsDefault: boolean;
};

export type LightdashYamlUploadOptions = {
  force: boolean;
  includeCharts: boolean;
  project: string;
};

export type LightdashYamlPostUploadAction =
  | 'refresh'
  | 'clear-local'
  | 'keep-as-is';

/**
 * Identifies which workflow is currently producing streamed CLI output so
 * that the global `lightdash-yaml-log` listener can route entries to the
 * correct log channel.
 */
export type LightdashYamlLogChannel = 'download' | 'upload';

interface LightdashYamlState {
  // Path
  defaultPath: string;
  currentPath: string;
  absolutePath: string;
  isLoadingPath: boolean;

  // File tree
  tree: LightdashYamlNode[];
  isLoadingTree: boolean;

  // Explorer
  selectedFile: string | null;
  selectedFileContent: string;
  isLoadingFileContent: boolean;
  searchTerm: string;

  // Upload search (separate so it doesn't fight with Explorer search)
  uploadSearchTerm: string;

  // Download
  downloadOptions: LightdashYamlDownloadOptions;
  downloadLogs: LightdashYamlLog[];
  isDownloading: boolean;

  // Upload
  uploadOptions: LightdashYamlUploadOptions;
  selectedUploadFiles: Set<string>;
  uploadLogs: LightdashYamlLog[];
  isUploading: boolean;
  showPostUploadDialog: boolean;
  lastUploadedFiles: string[];

  /**
   * Which workflow is actively streaming logs. The global webview message
   * listener uses this to append into the correct channel; `null` means
   * no Lightdash CLI invocation is in flight.
   */
  activeLogChannel: LightdashYamlLogChannel | null;

  // Tabs
  activeTab: LightdashYamlTab;

  // Actions
  setDefaultPath: (p: string) => void;
  setCurrentPath: (p: string) => void;
  setAbsolutePath: (p: string) => void;
  setIsLoadingPath: (v: boolean) => void;

  setTree: (tree: LightdashYamlNode[]) => void;
  setIsLoadingTree: (v: boolean) => void;

  setSelectedFile: (p: string | null) => void;
  setSelectedFileContent: (content: string) => void;
  setIsLoadingFileContent: (v: boolean) => void;
  setSearchTerm: (s: string) => void;
  setUploadSearchTerm: (s: string) => void;

  setDownloadOption: <K extends keyof LightdashYamlDownloadOptions>(
    key: K,
    value: LightdashYamlDownloadOptions[K],
  ) => void;
  setUploadOption: <K extends keyof LightdashYamlUploadOptions>(
    key: K,
    value: LightdashYamlUploadOptions[K],
  ) => void;

  toggleUploadFile: (path: string) => void;
  setUploadFiles: (paths: string[]) => void;
  clearUploadFiles: () => void;

  addDownloadLog: (log: LightdashYamlLog) => void;
  clearDownloadLogs: () => void;
  addUploadLog: (log: LightdashYamlLog) => void;
  clearUploadLogs: () => void;
  /** Append to whichever channel is currently active (no-op if `null`). */
  appendLogToActiveChannel: (log: LightdashYamlLog) => void;
  setActiveLogChannel: (channel: LightdashYamlLogChannel | null) => void;

  setIsDownloading: (v: boolean) => void;
  setIsUploading: (v: boolean) => void;
  setShowPostUploadDialog: (v: boolean) => void;
  setLastUploadedFiles: (files: string[]) => void;

  setActiveTab: (tab: LightdashYamlTab) => void;

  reset: () => void;
}

const initialState = {
  defaultPath: 'lightdash',
  currentPath: 'lightdash',
  absolutePath: '',
  isLoadingPath: false,

  tree: [] as LightdashYamlNode[],
  isLoadingTree: false,

  selectedFile: null as string | null,
  selectedFileContent: '',
  isLoadingFileContent: false,
  searchTerm: '',
  uploadSearchTerm: '',

  downloadOptions: {
    scope: 'all' as LightdashYamlDownloadScope,
    dashboards: [] as string[],
    charts: [] as string[],
    project: '',
    setAsDefault: false,
  },

  uploadOptions: {
    force: false,
    includeCharts: false,
    project: '',
  },
  selectedUploadFiles: new Set<string>(),

  downloadLogs: [] as LightdashYamlLog[],
  isDownloading: false,

  uploadLogs: [] as LightdashYamlLog[],
  isUploading: false,
  showPostUploadDialog: false,
  lastUploadedFiles: [] as string[],

  activeLogChannel: null as LightdashYamlLogChannel | null,

  activeTab: 'download' as LightdashYamlTab,
};

export const useLightdashYamlStore = create<LightdashYamlState>((set) => ({
  ...initialState,

  setDefaultPath: (p) => set({ defaultPath: p }),
  setCurrentPath: (p) => set({ currentPath: p }),
  setAbsolutePath: (p) => set({ absolutePath: p }),
  setIsLoadingPath: (v) => set({ isLoadingPath: v }),

  setTree: (tree) => set({ tree }),
  setIsLoadingTree: (v) => set({ isLoadingTree: v }),

  setSelectedFile: (p) => set({ selectedFile: p }),
  setSelectedFileContent: (content) => set({ selectedFileContent: content }),
  setIsLoadingFileContent: (v) => set({ isLoadingFileContent: v }),
  setSearchTerm: (s) => set({ searchTerm: s }),
  setUploadSearchTerm: (s) => set({ uploadSearchTerm: s }),

  setDownloadOption: (key, value) =>
    set((state) => ({
      downloadOptions: { ...state.downloadOptions, [key]: value },
    })),
  setUploadOption: (key, value) =>
    set((state) => ({
      uploadOptions: { ...state.uploadOptions, [key]: value },
    })),

  toggleUploadFile: (filePath) =>
    set((state) => {
      const next = new Set(state.selectedUploadFiles);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return { selectedUploadFiles: next };
    }),
  setUploadFiles: (paths) => set({ selectedUploadFiles: new Set(paths) }),
  clearUploadFiles: () => set({ selectedUploadFiles: new Set() }),

  addDownloadLog: (log) =>
    set((state) => ({ downloadLogs: [...state.downloadLogs, log] })),
  clearDownloadLogs: () => set({ downloadLogs: [] }),
  addUploadLog: (log) =>
    set((state) => ({ uploadLogs: [...state.uploadLogs, log] })),
  clearUploadLogs: () => set({ uploadLogs: [] }),
  appendLogToActiveChannel: (log) =>
    set((state) => {
      if (state.activeLogChannel === 'download') {
        return { downloadLogs: [...state.downloadLogs, log] };
      }
      if (state.activeLogChannel === 'upload') {
        return { uploadLogs: [...state.uploadLogs, log] };
      }
      return {};
    }),
  setActiveLogChannel: (channel) => set({ activeLogChannel: channel }),

  setIsDownloading: (v) => set({ isDownloading: v }),
  setIsUploading: (v) => set({ isUploading: v }),
  setShowPostUploadDialog: (v) => set({ showPostUploadDialog: v }),
  setLastUploadedFiles: (files) => set({ lastUploadedFiles: files }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  reset: () => set({ ...initialState, selectedUploadFiles: new Set() }),
}));
