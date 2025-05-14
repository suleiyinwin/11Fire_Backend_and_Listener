import mongoose from 'mongoose';

const bootstrapSchema = new mongoose.Schema({
  peerId: { type: String, default: null },
  swarms: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Swarm', required: false }],
});

const Auth = mongoose.model('Bootstrap', bootstrapSchema);
export default Auth;