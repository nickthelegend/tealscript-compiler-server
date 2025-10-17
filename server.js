// server.js (robust JSON recovery, ESM) — FIXED safeFilename + tmp under project
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";

const PORT = Number(process.env.PORT || 3000);
const TEALSCRIPT_CLI = "npx";
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
    const srcDir = path.join(tmpRoot, "src");
    const srcPath = path.join(srcDir, safeFilename);
    const outDir = path.join(tmpRoot, "artifacts");
    
    fs.mkdirSync(srcDir, { recursive: true });

    console.log("writing to:", srcPath);
    fs.mkdirSync(outDir, { recursive: true });
    
    // Copy pre-seeded template from /tmp/tealscript-template
    const templateDir = "/tmp/tealscript-template";
    if (fs.existsSync(templateDir)) {
      const templatePkg = path.join(templateDir, "package.json");
      const templateTsconfig = path.join(templateDir, "tsconfig.json");
      const templateNodeModules = path.join(templateDir, "node_modules");
      
      if (fs.existsSync(templatePkg)) {
        fs.copyFileSync(templatePkg, path.join(tmpRoot, "package.json"));
      }
      if (fs.existsSync(templateTsconfig)) {
        fs.copyFileSync(templateTsconfig, path.join(tmpRoot, "tsconfig.json"));
      }
      if (fs.existsSync(templateNodeModules)) {
        fs.cpSync(templateNodeModules, path.join(tmpRoot, "node_modules"), { recursive: true });
      }
    }
    
    // Write the source code after setting up the environment
    fs.writeFileSync(srcPath, sourceCode, "utf8");
    
    // Ensure tsconfig.json exists in temp directory
    const tsconfigPath = path.join(tmpRoot, "tsconfig.json");
    if (!fs.existsSync(tsconfigPath)) {
      const projectTsconfig = "/app/tsconfig.json";
      if (fs.existsSync(projectTsconfig)) {
        fs.copyFileSync(projectTsconfig, tsconfigPath);
      }
    }
    
    // Debug: Comprehensive debugging
    console.log("Template dir exists:", fs.existsSync(templateDir));
    console.log("Files in temp directory:", fs.readdirSync(tmpRoot));
    console.log("tsconfig.json exists in temp:", fs.existsSync(tsconfigPath));
    console.log("/app/tsconfig.json exists:", fs.existsSync("/app/tsconfig.json"));
    
    // Create tsconfig.json in nested temp directory that TealScript creates
    const nestedTmpDir = path.join(tmpRoot, "tmp", path.basename(tmpRoot));
    fs.mkdirSync(nestedTmpDir, { recursive: true });
    const nestedTsconfigPath = path.join(nestedTmpDir, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
      fs.copyFileSync(tsconfigPath, nestedTsconfigPath);
    }
    console.log("Created nested tsconfig at:", nestedTsconfigPath);
    console.log("Nested tsconfig exists:", fs.existsSync(nestedTsconfigPath));

    const args = [
      "@algorandfoundation/tealscript",
      "src/*.algo.ts",
      "artifacts"
    ];

    console.log("running:", TEALSCRIPT_CLI, args.join(" "));
    const result = await runCommand(TEALSCRIPT_CLI, args, { cwd: tmpRoot, env: process.env });
    console.log("TealScript stdout:", result.stdout);
    console.log("TealScript stderr:", result.stderr);

    // Read all generated files from output directory
    const allArtifacts = readAllFilesRecursively(outDir);
    console.log("Generated files:", Object.keys(allArtifacts));
    
    // Filter only .arc32.json and .arc4.json files
    const artifacts = {};
    for (const [filename, content] of Object.entries(allArtifacts)) {
      if (filename.endsWith('.arc32.json') || filename.endsWith('.arc4.json')) {
        artifacts[filename] = content;
      }
    }
    
    // Cleanup temp directory
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn("Cleanup warning:", cleanupErr.message);
    }

    if (Object.keys(artifacts).length === 0) {
      return res.status(500).json({ ok: false, error: "No .arc32.json or .arc4.json files produced" });
    }

    // Return only .arc32.json and .arc4.json files
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