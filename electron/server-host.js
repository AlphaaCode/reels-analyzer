// Runs the bundled Next.js server in Electron's own Node (main.js starts it with
// ELECTRON_RUN_AS_NODE). main.js holds this process's stdin open, so when the
// app exits or crashes the pipe closes and the server goes with it.
delete process.env.ELECTRON_RUN_AS_NODE;
process.stdin.on('end', () => process.exit(0)).resume();
require('./server/server.js');
