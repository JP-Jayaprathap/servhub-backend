const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    role: { type: String, required: true, default: "user" },
    department: { type: String, trim: true, lowercase: true, default: "" },
    privileges: {
      allow: { type: [String], default: [] },
      deny: { type: [String], default: [] },
    },
    /** How many users this account may create (admins with create privilege). Super Admin raises it. */
    userCreateLimit: { type: Number, default: 5, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
