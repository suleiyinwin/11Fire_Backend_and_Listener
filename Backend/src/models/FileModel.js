import mongoose from 'mongoose';

const fileSchema = new mongoose.Schema({
  name: String,
  cid: { type: String, unique: true },
  size: Number,
  date: Date,
  isFile: Boolean,
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Auth' },
  storedId: { type: mongoose.Schema.Types.ObjectId, ref: 'Auth' },
  sharedIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Auth' }],
  swarm: { type: mongoose.Schema.Types.ObjectId, ref: 'Swarm' }
});

const FileModel = mongoose.model('File', fileSchema);
export default FileModel;
