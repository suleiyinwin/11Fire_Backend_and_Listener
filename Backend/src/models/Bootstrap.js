import mongoose from 'mongoose';

const bootstrapSchema = new mongoose.Schema({
  peerId: { type: String, default: null },
  swarm: { type: mongoose.Schema.Types.ObjectId, ref: 'Swarm', required: false },
  isUsed: { type: Boolean, default: false },
});

const Bootstrap = mongoose.model('Bootstrap', bootstrapSchema);
export default Bootstrap;