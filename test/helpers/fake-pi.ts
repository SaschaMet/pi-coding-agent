export interface RegisteredTool {
  name: string;
  execute: (
    toolCallId: string,
    params: any,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: any) => void) | undefined,
    ctx: any,
  ) => Promise<any>;
}

export interface RegisteredCommand {
  description?: string;
  handler: (args: any, ctx: any) => Promise<any> | any;
}

export interface RegisteredShortcut {
  shortcut: string;
  options: { description?: string; handler: (ctx: any) => Promise<any> | any };
}

import { vi } from "vitest";

export interface FakePi {
  tools: Map<string, RegisteredTool>;
  commands: Map<string, RegisteredCommand>;
  shortcuts: RegisteredShortcut[];
  handlers: Map<string, Array<(event: any, ctx: any) => any>>;
  registerTool: (tool: RegisteredTool) => void;
  registerCommand: (name: string, command: RegisteredCommand) => void;
  registerShortcut: (shortcut: string, options: RegisteredShortcut["options"]) => void;
  on: (event: string, handler: (event: any, ctx: any) => any) => void;
}

export function createFakePi(): FakePi & Record<string, any> {
  const tools = new Map<string, RegisteredTool>();
  const commands = new Map<string, RegisteredCommand>();
  const shortcuts: RegisteredShortcut[] = [];
  const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
  const sentMessages: any[] = [];
  const sentUserMessages: any[] = [];
  const widgets: Array<{ key: string; content: any; options?: any }> = [];
  const statuses: Array<{ key: string; value: any }> = [];
  const notifications: Array<{ message: string; level?: string }> = [];
  const activeTools: string[] = [];

  return {
    tools,
    commands,
    shortcuts,
    handlers,
    sentMessages,
    sentUserMessages,
    widgets,
    statuses,
    notifications,
    activeTools,
    registerTool: (tool: RegisteredTool) => {
      tools.set(tool.name, tool);
    },
    registerCommand: (name: string, command: RegisteredCommand) => {
      commands.set(name, command);
    },
    registerShortcut: (shortcut: string, options: RegisteredShortcut["options"]) => {
      shortcuts.push({ shortcut, options });
    },
    on: (event: string, handler: (event: any, ctx: any) => any) => {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
    registerFlag: () => undefined,
    registerMessageRenderer: () => undefined,
    sendMessage: (message: any, options?: any) => {
      sentMessages.push({ message, options });
    },
    sendUserMessage: (message: any) => {
      sentUserMessages.push(message);
    },
    appendEntry: () => undefined,
    setSessionName: () => undefined,
    getSessionName: () => undefined,
    setLabel: () => undefined,
    getCommands: () => [],
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    getActiveTools: () => activeTools,
    getAllTools: () => [],
    setActiveTools: (toolsToSet: string[]) => {
      activeTools.splice(0, activeTools.length, ...toolsToSet);
    },
    setModel: async () => true,
    setThinkingLevel: () => undefined,
    getFlag: () => undefined,
    events: { on: () => undefined, off: () => undefined, emit: () => undefined },
    registerProvider: () => undefined,
    ui: undefined,
    setWidget: (key: string, content: any, options?: any) => {
      widgets.push({ key, content, options });
    },
    setStatus: (key: string, value: any) => {
      statuses.push({ key, value });
    },
    notify: (message: string, level?: string) => {
      notifications.push({ message, level });
    },
  };
}

export function createFakeUi() {
  return {
    theme: {
      fg: (_name: string, value: string) => value,
      bg: (_name: string, value: string) => value,
      bold: (value: string) => value,
      strikethrough: (value: string) => value,
    },
    select: vi.fn(async () => ""),
    editor: vi.fn(async () => ""),
    custom: vi.fn(),
    setWidget: vi.fn(),
    setStatus: vi.fn(),
    setHeader: vi.fn(),
    setFooter: vi.fn(),
    setEditorComponent: vi.fn(),
    notify: vi.fn(),
  };
}
