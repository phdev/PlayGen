export const PLAYCANVAS_MCP_SERVER_NAME = 'playcanvas' as const;

export interface McpStdioServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface PlayCanvasMcpOptions {
  serverPath?: string;
  port?: string;
}

export function playcanvasMcpServerConfig(
  opts: PlayCanvasMcpOptions = {},
): McpStdioServer {
  const port = opts.port ?? process.env.PLAYCANVAS_MCP_PORT ?? '52000';
  const serverPath = opts.serverPath ?? process.env.PLAYCANVAS_MCP_SERVER_PATH;

  if (serverPath) {
    return {
      command: 'npx',
      args: ['tsx', serverPath],
      env: { PORT: port },
    };
  }

  return {
    command: 'npx',
    args: ['-y', '@playcanvas/editor-mcp-server'],
    env: { PORT: port },
  };
}

export function isPlayCanvasMcpEnabled(): boolean {
  return process.env.PLAYGEN_DISABLE_PLAYCANVAS_MCP !== '1';
}
