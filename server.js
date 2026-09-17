const express = require("express");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const OpenAI = require("openai");
const { google } = require("googleapis");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));

const PORT = process.env.PORT || 3000;
const jobs = new Map();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function logError(...args) {
  console.error(new Date().toISOString(), ...args);
}

function env(name) {
  return String(process.env[name] || "").trim();
}

function run(cmd, args, { cwd, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    log(`[COMMAND] ${cmd} ${args.join(" ")}`);

    const p = spawn(cmd, args, { cwd });

    let out = "";
    let err = "";
    let settled = false;

    p.stdout.on("data", (d) => {
      out += d.toString();
    });

    p.stderr.on("data", (d) => {
      err += d.toString();
    });

    const timer = timeout
      ? setTimeout(() => {
          logError(`[TIMEOUT] ${cmd}`);
          p.kill("SIGKILL");
        }, timeout)
      : null;

    p.on("error", (e) => {
      if (timer) clearTimeout(timer);

      if (!settled) {
        settled = true;
        logError(`[SPAWN ERROR] ${cmd}:`, e.message);
        reject(
          new Error(
            `${cmd} could not start: ${e.message}. ` +
              `The executable may not be installed in the Railway container.`
          )
        );
      }
    });

    p.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (settled) return;

      settled = true;

      if (code === 0) {
        log(`[COMMAND OK] ${cmd}`);
        resolve({ out, err });
      } else {
        const details = (err || out || "").slice(-6000);

        logError(`[COMMAND FAILED] ${cmd}
