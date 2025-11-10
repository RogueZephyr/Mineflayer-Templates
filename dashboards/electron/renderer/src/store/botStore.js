// dashboards/electron/renderer/src/store/botStore.js
import { create } from 'zustand';

// Retention + UI defaults
const MAX_LOGS_PER_BOT = 1000; // Slightly higher retention for richer session context
const DEFAULT_LEVEL_FILTERS = {
  error: true,
  warn: true,
  info: true,
  success: true,
  debug: true,
};

export const useBotStore = create((set, get) => ({
  // State
  bots: {}, // { botId: { id, username, online, health, hunger, position, currentTask } }
  logs: {}, // { botId: [...logs], 'ALL': [...combinedLogs] }
  commands: [], // Available commands metadata
  selectedBot: 'ALL', // Currently selected bot ID or 'ALL'
  ready: false,
  levelFilters: DEFAULT_LEVEL_FILTERS, // Which levels are currently visible
  searchQuery: '', // Free-text search across message & botId
  pauseLogging: false, // If true, incoming logs are ignored (not stored)
  autoScroll: true, // UI hint for log viewer tailing behavior
  richHighlighting: true, // Enable advanced token highlighting in LogViewer
  showDeltas: true, // Show (+Xms) deltas between log entries
  itemNames: [], // Loaded via IPC from main

  // Actions
  setReady: (data) => {
    set({
      ready: true,
      bots: data.bots.reduce((acc, bot) => {
        acc[bot.id] = bot;
        return acc;
      }, {}),
      commands: data.commands || [],
    });
  },

  updateBots: (bots) => {
    set((state) => {
      const newMap = bots.reduce((acc, bot) => {
        acc[bot.id] = { ...(state.bots[bot.id] || {}), ...bot };
        return acc;
      }, {});
      // Ensure selectedBot is valid
      const selected = state.selectedBot;
      const nextSelected = selected === 'ALL' || newMap[selected] ? selected : 'ALL';
      return { bots: newMap, selectedBot: nextSelected };
    });
  },

  appendLog: (log) => {
    set((state) => {
      if (state.pauseLogging) return {}; // Ignore while paused
      const { botId = 'ALL', level, message, timestamp } = log;
      const entry = {
        id: `${Date.now()}_${Math.random()}`,
        botId,
        level,
        message,
        timestamp: timestamp || new Date().toISOString(),
      };

      const newLogs = { ...state.logs };

      // Add to specific bot's logs
      if (botId !== 'ALL') {
        newLogs[botId] = [...(newLogs[botId] || []), entry].slice(-MAX_LOGS_PER_BOT);
      }

      // Add to combined logs
      newLogs['ALL'] = [...(newLogs['ALL'] || []), entry].slice(-MAX_LOGS_PER_BOT);

      return { logs: newLogs };
    });
  },

  setSelectedBot: (botId) => {
    set({ selectedBot: botId });
  },

  setLevelFilter: (level, value) => {
    set((state) => ({ levelFilters: { ...state.levelFilters, [level]: value } }));
  },

  toggleLevelFilter: (level) => {
    set((state) => ({ levelFilters: { ...state.levelFilters, [level]: !state.levelFilters[level] } }));
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q });
  },

  clearSearch: () => set({ searchQuery: '' }),

  setPauseLogging: (paused) => set({ pauseLogging: paused }),
  togglePauseLogging: () => set((s) => ({ pauseLogging: !s.pauseLogging })),

  setAutoScroll: (enabled) => set({ autoScroll: enabled }),
  toggleAutoScroll: () => set((s) => ({ autoScroll: !s.autoScroll })),
  toggleRichHighlighting: () => set((s) => ({ richHighlighting: !s.richHighlighting })),
  toggleShowDeltas: () => set((s) => ({ showDeltas: !s.showDeltas })),

  setItemNames: (names) => set({ itemNames: Array.isArray(names) ? names : [] }),
  // loadItemNames is invoked from a useEffect in a component where window exists
  loadItemNames: async () => {},

  clearLogs: (botId = null) => {
    set((state) => {
      if (botId) {
        return { logs: { ...state.logs, [botId]: [] } };
      }
      return { logs: {} };
    });
  },

  // Selectors
  getSelectedLogs: () => {
    const { logs, selectedBot, levelFilters, searchQuery } = get();
    const raw = logs[selectedBot] || [];
    // Level filtering
    let filtered = raw.filter(l => levelFilters[l.level] !== false);
    // Search filtering (case-insensitive, simple contains)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(l =>
        (l.message && l.message.toLowerCase().includes(q)) ||
        (l.botId && l.botId.toLowerCase().includes(q)) ||
        (l.level && l.level.toLowerCase().includes(q))
      );
    }
    return filtered;
  },

  getBotList: () => {
    const { bots } = get();
    return Object.values(bots);
  },

  getLogStats: () => {
    const { logs, selectedBot } = get();
    const arr = logs[selectedBot] || [];
    return arr.reduce((acc, l) => {
      acc.total++;
      acc.levels[l.level] = (acc.levels[l.level] || 0) + 1;
      return acc;
    }, { total: 0, levels: {} });
  },
}));
