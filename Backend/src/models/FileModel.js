import mongoose from "mongoose";

const fileSchema = new mongoose.Schema({
  name: String,
  cid: { type: String, unique: true },
  size: Number,
  date: Date,
  isFile: Boolean,
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "Auth" },
  storedIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }], // updated to array
  sharedIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
  swarm: { type: mongoose.Schema.Types.ObjectId, ref: "Swarm" },
  enc: { type: Boolean, default: false },
  encAlgo: { type: String, default: null }, 
  encSize: { type: Number, default: null }, 
});

const FileModel = mongoose.model("File", fileSchema);
export default FileModel;
