// dashboards/electron/renderer/src/components/CommandInput.jsx
import { useState } from 'react';

export default function CommandInput() {
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!command.trim()) return;

    // Send command via Electron IPC
    window.dashboardAPI.sendCommand({
      command: command.trim(),
    });

    // Add to history
    setHistory((prev) => [...prev, command].slice(-50));
    setCommand('');
    setHistoryIndex(-1);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex < history.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setCommand(history[history.length - 1 - newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCommand(history[history.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCommand('');
      }
    }
  };

  return (
    <div className="px-4 py-3 bg-gray-800 border-t border-gray-700">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter command (e.g., !say hello, !manager status)"
          className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-100 focus:outline-none focus:border-blue-500"
          autoFocus
        />
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
        >
          Send
        </button>
      </form>
      <div className="mt-2 text-xs text-gray-500">
        Use ↑/↓ arrows for command history
      </div>
    </div>
  );
}
