import mongoose from "mongoose";

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "Auth", required: true, index: true },
  swarm:  { type: mongoose.Schema.Types.ObjectId, ref: "Swarm", required: true, index: true },
  day:    { type: String, required: true, index: true }, // "YYYY-MM-DD" (UTC)
  onlineSeconds:  { type: Number, default: 0 },
  offlineSeconds: { type: Number, default: 0 },
}, { timestamps: true });

schema.index({ userId: 1, swarm: 1, day: 1 }, { unique: true });

export default mongoose.model("ProviderUptimeDaily", schema);
