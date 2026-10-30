"use strict";
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "site-dist");
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, "05-演示站点"), out, { recursive: true });
fs.copyFileSync(path.join(out, "index.html"), path.join(out, "index-v3.html"));
fs.copyFileSync(path.join(out, "insurance.html"), path.join(out, "index.html"));
console.log("site-dist: insurance landing + V6 active pages + V5/V3 history");
