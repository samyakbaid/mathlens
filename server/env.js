// Load settings from .env before any other module reads them.
// (Imported first in server.js; ES module imports run in order.)
try {
  process.loadEnvFile();
} catch {
  // No .env file. That's fine: defaults apply and the AI tab shows a setup message.
}
