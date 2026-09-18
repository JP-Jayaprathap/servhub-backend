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

app.use(cors({ origin: ["http://localhost:3000"], credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/roles", roleRoutes);
app.use("/api/v1/delete-requests", deleteRequestRoutes);
app.use("/api/v1/departments", departmentRoutes);
app.use("/api/v1/material-requests", materialRequestRoutes);
app.use("/api/v1/audits", auditRoutes);

app.get("/api/v1/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 7002;

dbConnect().then(async () => {
  await seed();
  app.listen(PORT, () => {
    console.log(`ServHub API running on port ${PORT}`);
  });
});
