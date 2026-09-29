const dns = require("dns");
const mongoose = require("mongoose");
const { webcrypto } = require("crypto");

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

// Windows DNS often returns a bad SRV answer for mongodb+srv. Use public resolvers.
dns.setServers(["8.8.8.8", "1.1.1.1"]);

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
