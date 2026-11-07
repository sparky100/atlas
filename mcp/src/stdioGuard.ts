// Imported first by main.ts: stdout is the MCP channel, so anything else
// written there (a stray console.log in an imported module) would corrupt
// it. Route console output to stderr before anything else loads.
for (const key of ['log', 'info', 'debug'] as const) {
  console[key] = (...args: unknown[]) => {
    console.error(...args);
  };
}
