require("dotenv").config();
const express = require("express");
const cors = require("cors");
const dbConnect = require("./config/dbConnect");
const { seed } = require("./data/seed");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const roleRoutes = require("./routes/roleRoutes");
const deleteRequestRoutes = require("./routes/deleteRequestRoutes");
const departmentRoutes = require("./routes/departmentRoutes");
const materialRequestRoutes = require("./routes/materialRequestRoutes");
const auditRoutes = require("./routes/auditRoutes");

const app = express();

function parseOrigins(...values) {
  const set = new Set();
  values
    .flatMap((value) => String(value || "").split(","))
    .map((item) => item.trim().replace(/\/$/, ""))
    .filter(Boolean)
    .forEach((item) => set.add(item));
  return Array.from(set);
}

const ALLOWED_ORIGINS = parseOrigins(
  process.env.CLIENT_ORIGINS,
  process.env.CLIENT_ORIGIN,
  "http://localhost:3000",
  "https://servhub-frontend1-v2ox.vercel.app",
  "http://servhub-frontend1-v2ox.vercel.app"
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use((err, req, res, next) => {
  if (err && String(err.message || "").startsWith("CORS blocked")) {
    return res.status(403).json({ message: "Origin not allowed" });
  }
  return next(err);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let dbReady = null;
function ensureDb() {
  if (!dbReady) {
    dbReady = dbConnect().then(async () => {
      await seed();
    });
  }
  return dbReady;
}

app.use(async (req, res, next) => {
  try {
    await ensureDb();
    next();
  } catch (error) {
    next(error);
  }
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/roles", roleRoutes);
app.use("/api/v1/delete-requests", deleteRequestRoutes);
app.use("/api/v1/departments", departmentRoutes);
app.use("/api/v1/material-requests", materialRequestRoutes);
app.use("/api/v1/audits", auditRoutes);

app.get("/api/v1/health", (req, res) => {
  res.json({ status: "ok", allowedOrigins: ALLOWED_ORIGINS });
});

const PORT = process.env.PORT || 7002;

if (!process.env.VERCEL) {
  ensureDb()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`ServHub API running on port ${PORT}`);
        console.log(`CORS allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
      });
    })
    .catch((error) => {
      console.error("Failed to start API:", error.message);
      process.exit(1);
    });
}

module.exports = app;
