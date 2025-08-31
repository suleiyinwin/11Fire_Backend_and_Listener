import mongoose from "mongoose";

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "Auth", required: true, index: true },
  swarm:  { type: mongoose.Schema.Types.ObjectId, ref: "Swarm", required: true, index: true },
  peerId: { type: String, required: true },
  state:  { type: String, enum: ["online", "offline"], required: true },
  start:  { type: Date, required: true },
  end:    { type: Date, default: null, index: true },
}, { timestamps: true });

schema.index({ userId: 1, swarm: 1, start: 1 });

export default mongoose.model("ProviderUptimeEvent", schema);
