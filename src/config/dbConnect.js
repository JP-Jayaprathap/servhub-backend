const mongoose = require("mongoose");

const dbConnect = async () => {
  try {
    await mongoose.connect(process.env.CONNECTION_STRING);
    console.log(`Connected to MongoDB: ${mongoose.connection.host}, ${mongoose.connection.name}`);
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};

module.exports = dbConnect;
