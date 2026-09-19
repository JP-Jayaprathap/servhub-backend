const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: String, required: true, trim: true },
    unit: { type: String, trim: true, default: "" },
    amount: { type: Number, default: 0 },
  },
  { _id: false }
);

const materialRequestSchema = new mongoose.Schema(
  {
    mrNo: { type: String, required: true, unique: true, trim: true },
    project: { type: String, required: true, trim: true },
    requestedBy: { type: String, required: true, trim: true },
    requestedById: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    department: { type: String, trim: true, default: "" },
    justification: { type: String, trim: true, default: "" },
    products: { type: [productSchema], default: [] },
    quantity: { type: String, trim: true, default: "" },
    amount: { type: Number, default: 0 },
    supplier: { type: String, trim: true, default: "" },
    quotation: { type: String, trim: true, default: "" },
    status: { type: String, default: "Draft" },
    paymentStatus: { type: String, default: "Not started" },
    date: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MaterialRequest", materialRequestSchema);
