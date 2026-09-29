const mongoose = require("mongoose");

const projectManagerSchema = new mongoose.Schema(
  {
    project: { type: String, required: true, trim: true },
    projectKey: { type: String, required: true, trim: true, lowercase: true },
    department: { type: String, required: true, trim: true, lowercase: true },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    managerName: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

projectManagerSchema.index({ projectKey: 1, department: 1 }, { unique: true });

module.exports = mongoose.model("ProjectManager", projectManagerSchema);
