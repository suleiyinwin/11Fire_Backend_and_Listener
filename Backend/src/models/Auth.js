import mongoose from 'mongoose';

const authSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'provider'], default: null }, 
  username: { type: String, required: true },
  peerId: { type: String, default: null },
  swarms: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Swarm' }],
});

const Auth = mongoose.model('Auth', authSchema);
export default Auth;