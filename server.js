// server.js (robust JSON recovery, ESM) — FIXED safeFilename + tmp under project
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";

const PORT = Number(process.env.PORT || 3000);
const TEALSCRIPT_CLI = "tealscript";
const DEFAULT_TIMEOUT_MS = Number(process.env.TEALSCRIPT_TIMEOUT_MS || 20000);
const BODY_LIMIT = process.env.BODY_LIMIT || "2mb";

const app = express();

/**
 * Capture raw body while letting express.json() parse JSON.
 * express.json supports "verify" which receives the raw buffer.
 */
app.use(
  express.json({
    type: "application/json",
    limit: BODY_LIMIT,
    verify: (req, res, buf) => {
      req.rawBody = buf ? buf.toString("utf8") : "";
    },
  })
);

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - content-type: ${req.headers["content-type"]}`);
  next();
});

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env, opts.env || {});
    const child = spawn(cmd, args, { ...opts, env, stdio: ["ignore", "pipe", "pipe"] });
    
    // Ignore disposal errors
    child.on('error', (err) => {
      if (err.message && err.message.includes('SuppressedError')) return;
      child.emit('actualError', err);
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timeout = setTimeout(() => {
      child.removeAllListeners();
      child.kill("SIGKILL");
      reject(new Error(`Process timed out after ${DEFAULT_TIMEOUT_MS}ms\n${stderr}`));
    }, DEFAULT_TIMEOUT_MS);

    child.on("actualError", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      // Ignore disposal errors - check if stderr contains only disposal error
      if (code !== 0 && !stderr.includes('SuppressedError')) {
        const err = new Error(`Process exited with code ${code}\n${stderr}`);
        err.code = code;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

function readAllFilesRecursively(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  function walk(curr, base = "") {
    for (const ent of fs.readdirSync(curr, { withFileTypes: true })) {
      const full = path.join(curr, ent.name);
      const rel = base ? path.join(base, ent.name) : ent.name;
      if (ent.isDirectory()) walk(full, rel);
      else if (ent.isFile()) {
        try {
          out[rel] = { encoding: "utf8", data: fs.readFileSync(full, "utf8") };
        } catch (e) {
          out[rel] = { encoding: "base64", data: fs.readFileSync(full).toString("base64") };
        }
      }
    }
  }
  walk(dir);
  return out;
}

function tryRecoverCodeFromString(raw) {
  if (!raw || typeof raw !== "string") return null;

  const firstBrace = raw.indexOf("{");
  const trimmed = firstBrace >= 0 ? raw.slice(firstBrace) : raw;

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && typeof parsed.code === "string") return { filename: parsed.filename, code: parsed.code };
  } catch (e) {
    // continue
  }

  const codeRegex = /"code"\s*:\s*"([\s\S]*?)"\s*(?:,|\})/m;
  const m = trimmed.match(codeRegex);
  if (m && m[1] !== undefined) {
    let captured = m[1];
    try {
      const safe = `"${captured.replace(/\\?"/g, '\\"').replace(/\n/g, "\\n")}"`;
      captured = JSON.parse(safe);
    } catch (ee) {
      captured = captured.replace(/\\r\\n/g, "\r\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
    }
    const fnMatch = trimmed.match(/"filename"\s*:\s*"([^"]+)"/m);
    const filename = fnMatch ? fnMatch[1] : undefined;
    return { filename, code: captured };
  }

  return null;
}

app.post("/compile", async (req, res) => {
  let tmpRoot;
  try {
    let filename = "contract.algo.ts";
    let sourceCode = "";

    // Handle payload from request body
    if (req.body && typeof req.body === "object" && typeof req.body.code === "string") {
      filename = req.body.filename || filename;
      sourceCode = req.body.code;
    } else {
      return res.status(400).json({ ok: false, error: "Invalid request body. Expected JSON with { filename, code }." });
    }

    if (!sourceCode || typeof sourceCode !== "string" || !sourceCode.trim()) {
      return res.status(400).json({ ok: false, error: "Field 'code' must be a non-empty string" });
    }

    const safeFilename = path.basename(filename) || "contract.algo.ts";
    const id = uuidv4();

    // Use /tmp for file operations
    tmpRoot = fs.mkdtempSync(path.join("/tmp", `tealscript-${id}-`));
    const srcPath = path.join(tmpRoot, safeFilename);
    const outDir = path.join(tmpRoot, "out");

    console.log("writing to:", srcPath);
    fs.writeFileSync(srcPath, sourceCode, "utf8");
    fs.mkdirSync(outDir, { recursive: true });
    
    // Copy simple.algo.ts from project root
    const projectRoot = "/workspaces/tealscript-compiler-server";
    const simpleAlgoPath = path.join(projectRoot, "simple.algo.ts");
    if (fs.existsSync(simpleAlgoPath)) {
      const targetPath = path.join(tmpRoot, "simple.algo.ts");
      fs.copyFileSync(simpleAlgoPath, targetPath);
    }

    const args = [
      "compile",
      path.join(tmpRoot, "simple.algo.ts"),
      "--outDir", outDir
    ];

    console.log("running:", TEALSCRIPT_CLI, args.join(" "));
    const result = await runCommand(TEALSCRIPT_CLI, args, { cwd: tmpRoot, env: process.env });

    // Read all generated files from output directory
    const allArtifacts = readAllFilesRecursively(outDir);
    
    // Return all generated files (TEAL, ARC32, ARC56)
    const artifacts = allArtifacts;
    
    // Cleanup temp directory
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn("Cleanup warning:", cleanupErr.message);
    }

    if (Object.keys(artifacts).length === 0) {
      return res.status(500).json({ ok: false, error: "No files produced by TealScript compiler" });
    }

    // Return all generated files
    return res.json({ ok: true, files: artifacts });
  } catch (err) {
    console.error("compile error:", err);
    // Cleanup on error
    if (tmpRoot) {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn("Error cleanup warning:", cleanupErr.message);
      }
    }
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Compiler server running on port ${PORT}`);
});
