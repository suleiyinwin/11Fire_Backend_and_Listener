import mongoose from 'mongoose';

const fileSchema = new mongoose.Schema({
    name: { type: String, required: true },
    cid: { type: String, required: true, unique: true },
    size: { type: Number, required: true },
    date: { type: String, required: true },
    isFile: { type: Boolean, default: true },
});

const FileModel = mongoose.model('File', fileSchema);
export default FileModel;