import mongoose from 'mongoose';

const swarmSchema = new mongoose.Schema({
  swarmkey: { type: String, required: true },
  password: { type: String, required: true },
  isUsed: { type: Boolean, default: false },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Auth' }],
  bootstrapId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bootstrap',required: false },
});

const Swarm = mongoose.model('Swarm', swarmSchema);
export default Swarm;