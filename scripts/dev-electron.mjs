import { spawn } from "node:child_process";
import process from "node:process";

const port = 5174;
const isWindows = process.platform === "win32";
const viteCmd = "npm";
const viteArgs = ["run", "dev"];
const electronCmd = isWindows ? "npx" : "npx";
const electronArgs = ["electron", ".", "--no-sandbox"];

const killed = new Set();

function spawnProc(name, cmd, args) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: isWindows,
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code} signal ${signal}`);
    }
    shutdown();
  });
  return child;
}

const children = [];
const vite = spawnProc("vite", viteCmd, viteArgs);
children.push(vite);

// wait-on Vite server before launching electron
const wait = spawn(isWindows ? "npx" : "npx", ["wait-on", `tcp:${port}`], {
  stdio: "inherit",
  shell: isWindows,
  env: process.env,
});
wait.on("exit", () => {
  const electron = spawnProc("electron", electronCmd, electronArgs);
  children.push(electron);
});

function shutdown() {
  for (const c of children) {
    if (!c || c.killed) continue;
    try {
      c.kill("SIGTERM");
    } catch (e) {}
    killed.add(c.pid);
  }
  // Give processes a moment then exit
  setTimeout(() => process.exit(0), 200);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", shutdown);
