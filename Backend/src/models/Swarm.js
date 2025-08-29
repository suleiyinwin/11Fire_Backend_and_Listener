import mongoose from 'mongoose';

const swarmSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  swarmkey: { type: String, required: true },
  password: { type: String, required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Auth' }],
  bootstrapId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bootstrap',required: false },
});

// enforce uniqueness
swarmSchema.index({ name: 1 }, { unique: true });

const Swarm = mongoose.model('Swarm', swarmSchema);
export default Swarm;