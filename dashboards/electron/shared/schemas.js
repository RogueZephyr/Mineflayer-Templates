// dashboards/electron/shared/schemas.js
import { z } from 'zod';

// Runtime → Renderer events
export const LogEventSchema = z.object({
  botId: z.string().optional(),
  level: z.enum(['info', 'warn', 'error', 'success', 'debug']),
  message: z.string(),
  timestamp: z.string(),
});

export const BotStatusSchema = z.object({
  id: z.string(),
  username: z.string(),
  online: z.boolean(),
  health: z.number().optional(),
  hunger: z.number().optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
  }).optional(),
  currentTask: z.string().optional(),
});

export const CommandMetaSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  args: z.array(z.object({
    name: z.string(),
    hint: z.string().optional(),
  })).optional(),
});

export const RuntimeReadySchema = z.object({
  bots: z.array(BotStatusSchema),
  commands: z.array(CommandMetaSchema),
});

// Renderer → Runtime commands
export const ExecuteCommandSchema = z.object({
  botId: z.string().optional(),
  command: z.string(),
});

export const ListCommandsSchema = z.object({
  filter: z.string().optional(),
});
