// dashboards/electron/renderer/src/components/LogViewer.jsx
import { useEffect, useMemo, useRef } from 'react';
import { useBotStore } from '../store/botStore';

export default function LogViewer() {
  const logs = useBotStore((state) => state.getSelectedLogs());
  const selectedBot = useBotStore((state) => state.selectedBot);
  const autoScroll = useBotStore((state) => state.autoScroll);
  const richHighlighting = useBotStore((state) => state.richHighlighting);
  const showDeltas = useBotStore((state) => state.showDeltas);
  const logsEndRef = useRef(null);
  const containerRef = useRef(null);

  const scrollToBottom = () => {
    if (!autoScroll) return;
    const el = containerRef.current;
    if (el) {
      // Avoid page-level scroll jitter; scroll the container directly
      el.scrollTop = el.scrollHeight;
    } else {
      // Fallback
      logsEndRef.current?.scrollIntoView({ block: 'end' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs, autoScroll]);

  const getLevelColor = (level) => {
    switch (level) {
      case 'error':
        return 'text-red-400';
      case 'warn':
        return 'text-yellow-400';
      case 'success':
        return 'text-green-400';
      case 'info':
        return 'text-blue-400';
      default:
        return 'text-gray-300';
    }
  };

  const getMessageColor = (level) => {
    switch (level) {
      case 'error':
        return 'text-red-300';
      case 'warn':
        return 'text-yellow-300';
      case 'success':
        return 'text-green-300';
      case 'info':
        return 'text-gray-200';
      case 'debug':
        return 'text-purple-300';
      default:
        return 'text-gray-300';
    }
  };

  // Tokenize message for username + command highlighting
  const renderMessage = (msg) => {
    if (!richHighlighting) return msg;
    if (!msg) return null;
    const parts = [];
    let lastIndex = 0;
    // Patterns:
    const bracketUser = /\[(?<bot>[^\]]+)\]/g; // [BotName]
    const angleUser = /<(?<user>[^>]+)>/g; // <Username>
    const command = /(^|\s)([!\/][\w-]+)(?=\b)/g; // !cmd or /cmd
  const coordinates = /\b(-?\d{1,6})[, ](-?\d{1,6})[, ](-?\d{1,6})\b/g; // x,y,z or x y z
  const coordinatesLabeled = /\b(?:x\s*[:=]\s*(-?\d{1,6}))[\s,;]+(?:y\s*[:=]\s*(-?\d{1,6}))[\s,;]+(?:z\s*[:=]\s*(-?\d{1,6}))\b/gi;
    // Basic item name highlighting from categories (subset); words with underscore or known patterns
    const itemName = /\b([a-z_]{3,30})\b/g;

    // Minimal in-memory item dictionary (could be cached externally for performance)
    const ITEM_SET = new Set([
      'coal','raw_iron','iron_ingot','raw_gold','gold_ingot','raw_copper','copper_ingot','diamond','emerald','lapis_lazuli','redstone','nether_quartz','ancient_debris','netherite_scrap',
      'oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log','bamboo_block','crimson_stem','warped_stem','stick','charcoal',
      'cobblestone','stone','andesite','diorite','granite','tuff','deepslate','cobbled_deepslate','blackstone','basalt','netherrack','end_stone',
      'wheat','wheat_seeds','carrot','potato','beetroot','beetroot_seeds','melon','melon_slice','pumpkin','pumpkin_seeds','sugar_cane','cocoa_beans','bamboo',
      'bread','cooked_beef','cooked_chicken','cooked_porkchop','cooked_mutton','baked_potato','cooked_cod','cooked_salmon','golden_carrot','apple','cooked_rabbit','rabbit_stew','beetroot_soup','mushroom_stew',
      'rotten_flesh','bone','string','spider_eye','gunpowder','ender_pearl','blaze_rod','ghast_tear','slime_ball','magma_cream','leather','feather','egg'
    ]);

    // Combine patterns pass by pass for simplicity
    const applyPattern = (text, regex, wrap) => {
      let idx = 0;
      const out = [];
      let m;
      while ((m = regex.exec(text)) !== null) {
        if (m.index > idx) out.push(text.slice(idx, m.index));
        out.push(wrap(m));
        idx = m.index + m[0].length;
      }
      if (idx < text.length) out.push(text.slice(idx));
      return out;
    };

    // Apply username highlighting
    let stage = applyPattern(msg, bracketUser, (m) => (
      <span key={`b-${m.index}`} className="text-purple-300">{m[0]}</span>
    ));

    // Flatten and join for next regex pass
    stage = stage.map((seg, i) => typeof seg === 'string' ? seg : { __jsx: seg });
    const rebuild = () => stage.map(s => typeof s === 'string' ? s : '∎').join('');
    let flat = rebuild();

    // Angle usernames
    const stage2 = [];
    let offset = 0;
    let match;
    while ((match = angleUser.exec(flat)) !== null) {
      const before = flat.slice(offset, match.index);
      if (before) stage2.push(before);
      stage2.push({ __jsx: <span key={`a-${match.index}`} className="text-blue-300">{match[0]}</span> });
      offset = match.index + match[0].length;
    }
    if (offset < flat.length) stage2.push(flat.slice(offset));

    stage = stage2;
    flat = stage.map(s => typeof s === 'string' ? s : '∎').join('');

    // Commands
    const stage3 = [];
    offset = 0;
    while ((match = command.exec(flat)) !== null) {
      const before = flat.slice(offset, match.index);
      if (before) stage3.push(before);
      const space = match[1];
      const cmd = match[2];
      stage3.push(space);
      stage3.push({ __jsx: <span key={`c-${match.index}`} className="text-emerald-300 font-semibold">{cmd}</span> });
      offset = match.index + match[0].length;
    }
    if (offset < flat.length) stage3.push(flat.slice(offset));

    // Convert tokens back to JSX, keeping whitespace
    // Stage 4: labeled coordinates first (x:..., y:..., z:...)
    const combined = stage3.map(s => typeof s === 'string' ? s : s.__jsx);
    const coordProcessed = [];
    combined.forEach((segment, idx) => {
      if (typeof segment !== 'string') { coordProcessed.push(segment); return; }
      // Labeled format
      let last = 0; let m2;
      while ((m2 = coordinatesLabeled.exec(segment)) !== null) {
        if (m2.index > last) coordProcessed.push(segment.slice(last, m2.index));
        coordProcessed.push(<span key={`coordl-${idx}-${m2.index}`} className="text-orange-300">{m2[0]}</span>);
        last = m2.index + m2[0].length;
      }
      // Generic triples
      let remainder = last === 0 ? segment : segment.slice(last);
      if (last !== 0) {
        // already pushed up to last
      }
      let last2 = 0; let m2b;
      while ((m2b = coordinates.exec(remainder)) !== null) {
        if (m2b.index > last2) coordProcessed.push(remainder.slice(last2, m2b.index));
        coordProcessed.push(<span key={`coord-${idx}-${m2b.index}`} className="text-orange-300">{m2b[0]}</span>);
        last2 = m2b.index + m2b[0].length;
      }
      if (last2 < remainder.length) coordProcessed.push(remainder.slice(last2));
    });

    // Stage 5: item names
    const finalOut = [];
    coordProcessed.forEach((segment, idx) => {
      if (typeof segment !== 'string') { finalOut.push(segment); return; }
      let last = 0; let m3;
      while ((m3 = itemName.exec(segment)) !== null) {
        const token = m3[1];
        if (m3.index > last) finalOut.push(segment.slice(last, m3.index));
        if (ITEM_SET.has(token)) {
          finalOut.push(<span key={`item-${idx}-${m3.index}`} className="text-sky-300">{token}</span>);
        } else {
          finalOut.push(token);
        }
        last = m3.index + m3[0].length;
      }
      if (last < segment.length) finalOut.push(segment.slice(last));
    });

    return finalOut.map((seg, i) => typeof seg === 'string' ? <span key={`tfinal-${i}`}>{seg}</span> : seg);
  };

  const formatTimestamp = (ts) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', { hour12: false });
  };

  // Compute time deltas between consecutive entries for readability
  const logsWithDelta = useMemo(() => {
    let prev = null;
    return logs.map((l) => {
      const curTs = new Date(l.timestamp).getTime();
      const delta = prev != null ? curTs - prev : 0;
      prev = curTs;
      return { ...l, _deltaMs: delta };
    });
  }, [logs]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-900">
      <div className="px-4 py-2 bg-gray-800 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-gray-100">
          Logs {selectedBot !== 'ALL' && `- ${selectedBot}`}
        </h2>
      </div>
      
      <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto p-4 font-mono text-sm">
        {logsWithDelta.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            No logs yet. Waiting for bot activity...
          </div>
        ) : (
          logsWithDelta.map((log) => (
            <div key={log.id} className="group mb-1 flex gap-2">
              <span className="text-gray-500 text-xs">
                {formatTimestamp(log.timestamp)}
              </span>
              {showDeltas && log._deltaMs > 0 && (
                <span className="text-gray-600 text-[10px]">(+{Math.round(log._deltaMs)}ms)</span>
              )}
              <span className={`uppercase text-xs font-bold ${getLevelColor(log.level)}`}>
                [{log.level}]
              </span>
              {log.botId && log.botId !== 'ALL' && (
                <span className="text-purple-400 text-xs">[{log.botId}]</span>
              )}
              <span className={`${getMessageColor(log.level)} whitespace-pre-wrap break-words flex-1`}>{renderMessage(log.message)}</span>
              <button
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(`${log.timestamp} [${log.level}]${log.botId && log.botId !== 'ALL' ? ' ['+log.botId+']' : ''} ${log.message}`);
                  } catch (_) {}
                }}
                title="Copy line"
                className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 text-[10px] bg-gray-700 hover:bg-gray-600 rounded text-gray-200"
              >Copy</button>
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
