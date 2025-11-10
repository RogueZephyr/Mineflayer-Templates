// dashboards/electron/renderer/src/components/LogControls.jsx
import { useState, useCallback } from 'react';
import { useBotStore } from '../store/botStore';

const LEVELS = [
  { key: 'error', label: 'Error', color: 'text-red-400' },
  { key: 'warn', label: 'Warn', color: 'text-yellow-400' },
  { key: 'info', label: 'Info', color: 'text-blue-400' },
  { key: 'success', label: 'Success', color: 'text-green-400' },
  { key: 'debug', label: 'Debug', color: 'text-purple-400' },
];

export default function LogControls() {
  const levelFilters = useBotStore((s) => s.levelFilters);
  const toggleLevelFilter = useBotStore((s) => s.toggleLevelFilter);
  const setSearchQuery = useBotStore((s) => s.setSearchQuery);
  const clearSearch = useBotStore((s) => s.clearSearch);
  const pauseLogging = useBotStore((s) => s.pauseLogging);
  const togglePauseLogging = useBotStore((s) => s.togglePauseLogging);
  const autoScroll = useBotStore((s) => s.autoScroll);
  const toggleAutoScroll = useBotStore((s) => s.toggleAutoScroll);
  const richHighlighting = useBotStore((s) => s.richHighlighting);
  const toggleRichHighlighting = useBotStore((s) => s.toggleRichHighlighting);
  const showDeltas = useBotStore((s) => s.showDeltas);
  const toggleShowDeltas = useBotStore((s) => s.toggleShowDeltas);
  const clearLogs = useBotStore((s) => s.clearLogs);
  const getSelectedLogs = useBotStore((s) => s.getSelectedLogs);
  const selectedBot = useBotStore((s) => s.selectedBot);
  const logStats = useBotStore((s) => s.getLogStats());

  const [localSearch, setLocalSearch] = useState('');

  const onSearchChange = (e) => {
    const v = e.target.value;
    setLocalSearch(v);
    setSearchQuery(v);
  };

  const exportLogs = useCallback((format = 'json') => {
    const logs = getSelectedLogs();
    if (!logs.length) return;
    const blob = new Blob([
      format === 'json'
        ? JSON.stringify(logs, null, 2)
        : logs.map(l => `[${l.timestamp}] [${l.level}]${l.botId && l.botId !== 'ALL' ? ` [${l.botId}]` : ''} ${l.message}`).join('\n')
    ], { type: format === 'json' ? 'application/json' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:]/g, '-');
    a.download = `logs_${selectedBot}_${stamp}.${format === 'json' ? 'json' : 'txt'}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [getSelectedLogs, selectedBot]);

  return (
    <div className="px-4 py-2 bg-gray-850 border-b border-gray-700 flex flex-wrap items-center gap-4 text-sm sticky top-0 z-10">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {LEVELS.map(l => (
          <label key={l.key} className={`flex items-center gap-1 cursor-pointer select-none ${!levelFilters[l.key] ? 'opacity-40' : ''}`}> 
            <input
              type="checkbox"
              checked={!!levelFilters[l.key]}
              onChange={() => toggleLevelFilter(l.key)}
              className="accent-blue-500"
            />
            <span className={`uppercase font-bold ${l.color} text-xs`}>{l.label}</span>
          </label>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <input
          value={localSearch}
          onChange={onSearchChange}
          placeholder="Search logs..."
          className="px-2 py-1 rounded bg-gray-900 border border-gray-700 text-gray-200 focus:outline-none focus:border-blue-500"
        />
        {localSearch && (
          <button
            onClick={() => { setLocalSearch(''); clearSearch(); }}
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-200"
          >Clear</button>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 ml-auto">
        <button
          onClick={() => toggleRichHighlighting()}
          className={`px-3 py-1 rounded font-medium transition-colors ${richHighlighting ? 'bg-teal-600 hover:bg-teal-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`}
        >Highlighting</button>
        <button
          onClick={() => togglePauseLogging()}
          className={`px-3 py-1 rounded font-medium transition-colors ${pauseLogging ? 'bg-orange-600 hover:bg-orange-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`}
        >{pauseLogging ? 'Paused' : 'Pause'}</button>
        <button
          onClick={() => toggleAutoScroll()}
          className={`px-3 py-1 rounded font-medium transition-colors ${autoScroll ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`}
        >Auto-Scroll</button>
        <button
          onClick={() => toggleShowDeltas()}
          className={`px-3 py-1 rounded font-medium transition-colors ${showDeltas ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`}
        >Δ ms</button>
        <button
          onClick={() => clearLogs(selectedBot)}
          className="px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-medium"
        >Clear</button>
        <div className="flex gap-1">
          <button
            onClick={() => exportLogs('json')}
            className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
          >Export JSON</button>
          <button
            onClick={() => exportLogs('text')}
            className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
          >Export TXT</button>
        </div>
      </div>

      {/* Stats */}
      <div className="basis-full text-xs text-gray-500 mt-1">
        <span className="mr-3">Visible: {logStats.total}</span>
        {Object.entries(logStats.levels).map(([lvl, count]) => (
          <span key={lvl} className="mr-2">{lvl}:{count}</span>
        ))}
      </div>
    </div>
  );
}
