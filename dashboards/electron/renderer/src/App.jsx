// dashboards/electron/renderer/src/App.jsx
import { useEffect } from 'react';
import { useBotStore } from './store/botStore';
import BotSelector from './components/BotSelector';
import LogViewer from './components/LogViewer';
import LogControls from './components/LogControls';
import CommandInput from './components/CommandInput';

export default function App() {
  const ready = useBotStore((state) => state.ready);
  const setReady = useBotStore((state) => state.setReady);
  const updateBots = useBotStore((state) => state.updateBots);
  const appendLog = useBotStore((state) => state.appendLog);
  const setItemNames = useBotStore((state) => state.setItemNames);

  useEffect(() => {
    // Load item list once for highlighting
    (async () => {
      try {
        if (window?.dashboardAPI?.getItems) {
          const items = await window.dashboardAPI.getItems();
          setItemNames(Array.isArray(items) ? items : []);
        }
      } catch (_) {}
    })();

    // Setup IPC listeners
    const unsubReady = window.dashboardAPI.onReady((data) => {
      console.log('[Dashboard] Runtime ready:', data);
      setReady(data);
    });

    const unsubLog = window.dashboardAPI.onLog((log) => {
      appendLog(log);
    });

    const unsubInbox = window.dashboardAPI.onInbox((data) => {
      // Show inbound JSON as a debug log so users can see what reached the runtime
      appendLog({ level: 'debug', message: `INBOX: ${JSON.stringify(data)}`, timestamp: new Date().toISOString() });
    });

    const unsubBots = window.dashboardAPI.onBots((bots) => {
      updateBots(bots);
    });

    const unsubError = window.dashboardAPI.onError((error) => {
      console.error('[Dashboard] Runtime error:', error);
      appendLog({
        level: 'error',
        message: `Runtime error: ${error.message}`,
        timestamp: new Date().toISOString(),
      });
    });

    return () => {
      unsubReady();
      unsubLog();
      unsubBots();
      unsubError();
      unsubInbox();
    };
  }, [setReady, updateBots, appendLog, setItemNames]);

  if (!ready) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🤖</div>
          <h1 className="text-2xl font-bold text-gray-100 mb-2">
            Mineflayer Dashboard
          </h1>
          <p className="text-gray-400">Connecting to bots...</p>
          <div className="mt-4">
            <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      {/* Header */}
      <div className="px-6 py-4 bg-gray-800 border-b border-gray-700">
        <h1 className="text-2xl font-bold text-gray-100">
          🤖 Mineflayer Dashboard
        </h1>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <BotSelector />
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <LogControls />
          <LogViewer />
          <CommandInput />
        </div>
      </div>
    </div>
  );
}
