import mongoose from "mongoose";

const encSchema = new mongoose.Schema(
  {
    // Wrapped per-swarm data key; wrapped with app master key (AES-256-GCM)
    alg: { type: String, default: "aes-256-gcm@kek-v1" }, // key wrapping algorithm
    version: { type: Number, default: 1 }, // for rotation later
    ivB64: { type: String, required: false },
    tagB64: { type: String, required: false },
    ctB64: { type: String, required: false }, // wrapped key bytes
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const swarmSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    swarmkey: { type: String, required: true },
    password: { type: String, required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
    bootstrapId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bootstrap",
      required: false,
    },

    // NEW: encrypted data key for file encryption (separate from swarmkey)
    enc: { type: encSchema, default: null },
    tenantId: { type: String, required: true },
  },
  { timestamps: true }
);

// enforce uniqueness
swarmSchema.index({ name: 1, tenantId: 1 }, { unique: true, name: 'uniq_name_per_tenant' });

const Swarm = mongoose.model("Swarm", swarmSchema);
export default Swarm;
