// dashboards/electron/renderer/src/components/BotSelector.jsx
import { useState, useEffect, useRef } from 'react';
import { useBotStore } from '../store/botStore';

export default function BotSelector() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [username, setUsername] = useState('');
  const inputRef = useRef(null);
  const bots = useBotStore((state) => state.getBotList());
  const selectedBot = useBotStore((state) => state.selectedBot);
  const setSelectedBot = useBotStore((state) => state.setSelectedBot);
  const updateBots = useBotStore((state) => state.updateBots);
  const appendLog = useBotStore((state) => state.appendLog);
  const ready = useBotStore((state) => state.ready);

  const getStatusColor = (bot) => {
    if (!bot.online) return 'bg-gray-500';
    if (bot.health < 6) return 'bg-red-500';
    if (bot.health < 12) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const sidebar = (
    <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      <div className="px-4 py-3 bg-gray-900 border-b border-gray-700">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-100">Bots</h2>
          <button
            onClick={() => {
              if (!ready) {
                appendLog({ level: 'warn', message: 'Runtime not ready - cannot add bot yet' });
                return;
              }
              setShowAddModal(true);
            }}
            title="Add Bot"
            className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded"
          >Add</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* All bots view */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setSelectedBot('ALL')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedBot('ALL'); }}
          className={`w-full px-4 py-3 text-left border-b border-gray-700 transition-colors cursor-pointer ${
            selectedBot === 'ALL'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-750'
          }`}
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="font-medium">All Bots</span>
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Combined view ({bots.length} {bots.length === 1 ? 'bot' : 'bots'})
          </div>
  </div>

        {/* Individual bots */}
        {bots.map((bot) => (
          <div
            key={bot.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedBot(bot.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedBot(bot.id); }}
            className={`w-full px-4 py-3 text-left border-b border-gray-700 transition-colors cursor-pointer ${
              selectedBot === bot.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-750'
            }`}
          >
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${getStatusColor(bot)}`} />
              <span className="font-medium flex-1">{bot.username}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!ready) {
                    appendLog({ level: 'warn', message: 'Runtime not ready - cannot remove bot yet' });
                    return;
                  }
                  appendLog({ level: 'info', message: `Requested remove: ${bot.username}` });
                  window.dashboardAPI?.removeBot?.(bot.id);
                }}
                title="Remove Bot"
                className="px-2 py-0.5 text-[10px] bg-red-600 hover:bg-red-500 text-white rounded"
              >Remove</button>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {bot.online ? (
                <>
                  ❤️ {bot.health}/20 | 🍗 {bot.hunger}/20
                  {bot.position && (
                    <div className="mt-0.5">
                      📍 {Math.floor(bot.position.x)}, {Math.floor(bot.position.y)}, {Math.floor(bot.position.z)}
                    </div>
                  )}
                </>
              ) : (
                <span className="text-red-400">Offline</span>
              )}
            </div>
          </div>
        ))}

        {bots.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500 text-sm">
            No bots connected yet
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {sidebar}
      {showAddModal && (
        <AddBotModal
          username={username}
          setUsername={setUsername}
          onClose={() => { setShowAddModal(false); setUsername(''); }}
          onSpawn={() => {
            if (!ready) {
              appendLog({ level: 'warn', message: 'Runtime not ready - cannot add bot yet' });
            } else {
              appendLog({ level: 'info', message: `Requested spawn: ${username || '(auto)'}` });
              window.dashboardAPI?.addBot?.(username || undefined);
            }
            setUsername('');
            setShowAddModal(false);
          }}
          inputRef={inputRef}
        />
      )}
    </>
  );
}

function AddBotModal({ username, setUsername, onClose, onSpawn, inputRef }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
      if (e.key === 'Enter') {
        onSpawn();
      }
    };
    window.addEventListener('keydown', handler);
    // Focus input after mount
    setTimeout(() => { inputRef.current?.focus(); }, 20);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, onSpawn, inputRef]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-850 border border-gray-700 rounded-lg shadow-xl w-[320px] p-4 animate-fade-in">
        <h3 className="text-lg font-semibold text-gray-100 mb-2">Spawn Bot</h3>
        <p className="text-xs text-gray-400 mb-3">Optionally choose a username or leave blank for auto assignment.</p>
        <input
          ref={inputRef}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username (optional)"
          className="w-full mb-3 px-2 py-2 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
          >Cancel</button>
          <button
            onClick={onSpawn}
            className="px-3 py-1.5 text-sm rounded bg-green-600 hover:bg-green-500 text-white"
          >Spawn</button>
        </div>
      </div>
    </div>
  );
}
